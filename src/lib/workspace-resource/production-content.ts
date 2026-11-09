import type {
  WorkspaceResourceMediaType,
  WorkspaceResourceStatus,
} from './contracts'
import {
  WORKSPACE_RESOURCE_SCHEMA,
} from './schema-registry'
import type {
  ProductionContentGrouping,
  ProductionStageKey,
  ProductionStepStatus,
} from './production-stages'

/**
 * Content projection for a single production step.
 *
 * The project keeps one Resource tree. This module only groups a subset of that
 * tree for the step view; it never renames, copies, or persists anything. Folder
 * location is the primary ownership signal, schema is the fallback and the
 * display hint.
 */
export const PRODUCTION_ASSET_TYPE_KEYS = [
  'character',
  'location',
  'prop',
  'other',
] as const

export type ProductionAssetTypeKey = typeof PRODUCTION_ASSET_TYPE_KEYS[number]

/** Asset categories always visible in the asset step, even when empty. */
const VISIBLE_ASSET_TYPE_KEYS: readonly ProductionAssetTypeKey[] = [
  'character',
  'location',
  'prop',
]

export interface ProductionContentResourceRow {
  readonly id: string
  readonly name: string
  readonly workspacePath: string
  readonly status: WorkspaceResourceStatus
  readonly schemaId: string
  readonly mediaType: WorkspaceResourceMediaType | null
  readonly currentVersion: number
  readonly updatedAt: Date
  readonly previewUrl: string | null
}

export interface ProductionContentCounts {
  readonly total: number
  readonly ready: number
  readonly pending: number
  readonly failed: number
  readonly canceled: number
}

export interface ProductionContentItemView {
  readonly resourceId: string
  readonly name: string
  readonly workspacePath: string
  readonly status: WorkspaceResourceStatus
  readonly schemaId: string
  readonly mediaType: WorkspaceResourceMediaType | null
  readonly contentVersion: number
  readonly updatedAt: string
  readonly previewUrl: string | null
}

export interface ProductionContentGroupView {
  readonly groupKey: string
  /** Episode number for `episode` grouping; null means "unassigned". */
  readonly episodeNumber: number | null
  /** Asset category for `asset_type` grouping. */
  readonly assetTypeKey: ProductionAssetTypeKey | null
  readonly counts: ProductionContentCounts
  readonly status: ProductionStepStatus
  readonly primaryResourceId: string | null
  readonly items: readonly ProductionContentItemView[]
}

export interface ProductionStepContentView {
  readonly stepKey: ProductionStageKey
  readonly folderPath: string
  readonly grouping: ProductionContentGrouping
  readonly revision: number
  readonly counts: ProductionContentCounts
  readonly groups: readonly ProductionContentGroupView[]
}

export const EMPTY_PRODUCTION_CONTENT_COUNTS: ProductionContentCounts = {
  total: 0,
  ready: 0,
  pending: 0,
  failed: 0,
  canceled: 0,
}

function addStatus(
  counts: ProductionContentCounts,
  status: WorkspaceResourceStatus,
): ProductionContentCounts {
  if (status === 'ready') return { ...counts, ready: counts.ready + 1 }
  if (status === 'pending') return { ...counts, pending: counts.pending + 1 }
  if (status === 'failed') return { ...counts, failed: counts.failed + 1 }
  return { ...counts, canceled: counts.canceled + 1 }
}

export function countProductionContentRows(
  rows: readonly Pick<ProductionContentResourceRow, 'status'>[],
): ProductionContentCounts {
  let counts = EMPTY_PRODUCTION_CONTENT_COUNTS
  for (const row of rows) {
    counts = addStatus({ ...counts, total: counts.total + 1 }, row.status)
  }
  return counts
}

/**
 * Group-level status mirrors the step-level vocabulary but stays local: an
 * empty group is "not started", a group with usable output and failures is
 * "needs review". It never represents an approval.
 */
export function productionContentGroupStatus(
  counts: ProductionContentCounts,
): ProductionStepStatus {
  if (counts.pending > 0) return 'in_progress'
  if (counts.total === 0) return 'empty'
  if (counts.failed > 0) return counts.ready > 0 ? 'needs_review' : 'failed'
  if (counts.ready > 0) return 'ready'
  // Only canceled work remains: nothing is running or usable, so the group is
  // effectively untouched rather than "in progress".
  return 'empty'
}

const FILE_EXTENSION_PATTERN = /\.(?:json|txt|md|markdown|mp4|mov|webm|mkv|png|jpe?g|webp|gif|avif|mp3|wav|m4a|aac|flac|ogg)$/iu

function stripExtension(segment: string): string {
  return segment.replace(FILE_EXTENSION_PATTERN, '')
}

function normalizeDigits(value: string): string {
  return value.replace(/[０-９]/gu, (char) => (
    String.fromCharCode(char.charCodeAt(0) - 0xFEE0)
  ))
}

const CHINESE_DIGITS: Readonly<Record<string, number>> = {
  零: 0,
  一: 1,
  二: 2,
  两: 2,
  三: 3,
  四: 4,
  五: 5,
  六: 6,
  七: 7,
  八: 8,
  九: 9,
}

const CHINESE_UNITS: Readonly<Record<string, number>> = {
  十: 10,
  百: 100,
  千: 1000,
}

function parseChineseNumber(value: string): number | null {
  let total = 0
  let current = 0
  let sawDigit = false
  for (const char of value) {
    const digit = CHINESE_DIGITS[char]
    if (digit !== undefined) {
      current = digit
      sawDigit = true
      continue
    }
    const unit = CHINESE_UNITS[char]
    if (unit !== undefined) {
      total += (current || 1) * unit
      current = 0
      sawDigit = true
      continue
    }
    return null
  }
  if (!sawDigit) return null
  return total + current
}

function parseEpisodeDigits(value: string): number | null {
  const normalized = normalizeDigits(value).trim()
  if (/^\d{1,4}$/u.test(normalized)) {
    const parsed = Number(normalized)
    return Number.isSafeInteger(parsed) && parsed > 0 ? parsed : null
  }
  return parseChineseNumber(normalized)
}

/**
 * Episode is a file-level unit. It is read from any path segment or the file
 * name (`第01集`, `第1集.json`, `EP02`, `episode-3`, `01.json`). Scenes are not
 * considered here: they stay inside one episode document.
 */
export function productionEpisodeNumberFromPath(workspacePath: string): number | null {
  const segments = workspacePath.split('/').filter(Boolean)
  for (let index = segments.length - 1; index >= 0; index -= 1) {
    const raw = segments[index] ?? ''
    const isFile = index === segments.length - 1
    const segment = stripExtension(raw).trim()
    if (!segment) continue

    const explicit = /^(?:第\s*)?([0-9０-９零一二三四五六七八九十百千两]+)\s*[集话話]/u.exec(segment)
      ?? /^(?:episode|ep|e)[\s._-]*([0-9０-９]+)$/iu.exec(segment)
    if (explicit?.[1]) {
      const parsed = parseEpisodeDigits(explicit[1])
      if (parsed !== null) return parsed
    }

    // Bare numbers are only trusted as episodes when short (`01`, not `2024`).
    if (/^[0-9０-９]{1,3}$/u.test(segment)) {
      const parsed = parseEpisodeDigits(segment)
      if (parsed !== null && parsed <= 200) return parsed
    }

    // A leading number in a file name (`01-开场.json`) is an episode hint too.
    if (isFile) {
      const leading = /^([0-9０-９]{1,3})(?:[\s._-]+|$)/u.exec(segment)
      if (leading?.[1]) {
        const parsed = parseEpisodeDigits(leading[1])
        if (parsed !== null && parsed <= 200) return parsed
      }
    }
  }
  return null
}

function assetTypeFromSegment(segment: string): ProductionAssetTypeKey | null {
  const normalized = segment.trim().toLowerCase()
  if (normalized === '角色' || normalized === '人物' || normalized === 'character' || normalized === 'characters') {
    return 'character'
  }
  if (normalized === '场景' || normalized === '地点' || normalized === 'location' || normalized === 'locations') {
    return 'location'
  }
  if (normalized === '道具' || normalized === 'prop' || normalized === 'props') {
    return 'prop'
  }
  return null
}

function assetTypeFromSchema(schemaId: string): ProductionAssetTypeKey | null {
  if (schemaId === WORKSPACE_RESOURCE_SCHEMA.CHARACTER_IMAGE) return 'character'
  if (schemaId === WORKSPACE_RESOURCE_SCHEMA.LOCATION_IMAGE) return 'location'
  if (schemaId === WORKSPACE_RESOURCE_SCHEMA.PROP_IMAGE) return 'prop'
  return null
}

export function productionAssetTypeForRow(
  row: Pick<ProductionContentResourceRow, 'workspacePath' | 'schemaId'>,
): ProductionAssetTypeKey {
  const segments = row.workspacePath.split('/').filter(Boolean)
  // Directory is the primary ownership signal: a file inside `资产/场景`
  // stays a location even if its name mentions another category.
  for (const segment of [...segments.slice(0, -1)].reverse()) {
    const fromFolder = assetTypeFromSegment(segment)
    if (fromFolder) return fromFolder
  }
  const fromSchema = assetTypeFromSchema(row.schemaId)
  if (fromSchema) return fromSchema
  const fileName = segments.at(-1)
  return (fileName ? assetTypeFromSegment(stripExtension(fileName)) : null) ?? 'other'
}

function itemView(row: ProductionContentResourceRow): ProductionContentItemView {
  return {
    resourceId: row.id,
    name: row.name,
    workspacePath: row.workspacePath,
    status: row.status,
    schemaId: row.schemaId,
    mediaType: row.mediaType,
    contentVersion: row.currentVersion,
    updatedAt: row.updatedAt.toISOString(),
    previewUrl: row.previewUrl,
  }
}

function primaryResourceId(rows: readonly ProductionContentResourceRow[]): string | null {
  return (rows.find((row) => row.status === 'ready') ?? rows[0])?.id ?? null
}

function groupView(input: {
  readonly groupKey: string
  readonly episodeNumber: number | null
  readonly assetTypeKey: ProductionAssetTypeKey | null
  readonly rows: readonly ProductionContentResourceRow[]
}): ProductionContentGroupView {
  const counts = countProductionContentRows(input.rows)
  return {
    groupKey: input.groupKey,
    episodeNumber: input.episodeNumber,
    assetTypeKey: input.assetTypeKey,
    counts,
    status: productionContentGroupStatus(counts),
    primaryResourceId: primaryResourceId(input.rows),
    items: input.rows.map(itemView),
  }
}

function episodeGroupKey(episodeNumber: number | null): string {
  return episodeNumber === null ? 'episode:none' : `episode:${String(episodeNumber)}`
}

function summarizeEpisodeGroups(input: {
  readonly rows: readonly ProductionContentResourceRow[]
  readonly knownEpisodeNumbers: readonly number[]
}): ProductionContentGroupView[] {
  const rowsByEpisode = new Map<number | null, ProductionContentResourceRow[]>()
  for (const row of input.rows) {
    const episode = productionEpisodeNumberFromPath(row.workspacePath)
    const bucket = rowsByEpisode.get(episode)
    if (bucket) bucket.push(row)
    else rowsByEpisode.set(episode, [row])
  }

  const episodeNumbers = new Set<number>(input.knownEpisodeNumbers)
  for (const episode of rowsByEpisode.keys()) {
    if (episode !== null) episodeNumbers.add(episode)
  }

  const groups = [...episodeNumbers]
    .sort((left, right) => left - right)
    .map((episode) => groupView({
      groupKey: episodeGroupKey(episode),
      episodeNumber: episode,
      assetTypeKey: null,
      rows: rowsByEpisode.get(episode) ?? [],
    }))

  const unassigned = rowsByEpisode.get(null)
  if (unassigned && unassigned.length > 0) {
    groups.push(groupView({
      groupKey: episodeGroupKey(null),
      episodeNumber: null,
      assetTypeKey: null,
      rows: unassigned,
    }))
  }
  return groups
}

function summarizeAssetTypeGroups(
  rows: readonly ProductionContentResourceRow[],
): ProductionContentGroupView[] {
  const rowsByType = new Map<ProductionAssetTypeKey, ProductionContentResourceRow[]>()
  for (const row of rows) {
    const type = productionAssetTypeForRow(row)
    const bucket = rowsByType.get(type)
    if (bucket) bucket.push(row)
    else rowsByType.set(type, [row])
  }

  const visibleKeys = [...PRODUCTION_ASSET_TYPE_KEYS].filter((key) => (
    VISIBLE_ASSET_TYPE_KEYS.includes(key) || rowsByType.has(key)
  ))
  return visibleKeys.map((key) => groupView({
    groupKey: `asset:${key}`,
    episodeNumber: null,
    assetTypeKey: key,
    rows: rowsByType.get(key) ?? [],
  }))
}

/**
 * Pure grouping for the step content view. Rows are expected to be ordered
 * newest-first; the function preserves that order inside each group.
 */
export function summarizeProductionStepContent(input: {
  readonly grouping: ProductionContentGrouping
  readonly rows: readonly ProductionContentResourceRow[]
  readonly knownEpisodeNumbers?: readonly number[]
}): ProductionContentGroupView[] {
  if (input.grouping === 'asset_type') {
    return summarizeAssetTypeGroups(input.rows)
  }
  return summarizeEpisodeGroups({
    rows: input.rows,
    knownEpisodeNumbers: input.knownEpisodeNumbers ?? [],
  })
}
