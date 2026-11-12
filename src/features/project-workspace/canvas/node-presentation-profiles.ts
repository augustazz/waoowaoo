import {
  getAssetImageFormatPolicy,
  resolveAssetImageKindForSchemaId,
} from '@/lib/asset-generation'
import type {
  WorkspaceResourceJsonValue,
  WorkspaceResourceMediaType,
} from '@/lib/workspace-resource/contracts'
import type {
  WorkspaceCanvasMediaShell,
  WorkspaceCanvasMediaShellForm,
  WorkspaceCanvasNodeKind,
} from './node-canvas-types'

export interface WorkspaceCanvasNodeSize {
  readonly width: number
  readonly height: number
}

interface WorkspaceCanvasMediaPresentation {
  readonly form: WorkspaceCanvasMediaShellForm
  /** Bounding box the media area must fit; `frame` fits the aspect ratio inside it. */
  readonly maxMediaWidth: number
  readonly maxMediaHeight: number
}

export interface WorkspaceCanvasNodePresentationProfile {
  readonly media: Record<WorkspaceResourceMediaType, WorkspaceCanvasMediaPresentation>
}

/** Card chrome around the media area: horizontal padding (14px × 2) + border. */
const NODE_CHROME_WIDTH = 30
/**
 * Header block + content vertical padding + border for the compact card
 * chrome: 10 (header top) + 24 (fixed header row) + 6 (header bottom)
 * + 2 (content top) + 14 (content bottom) + 2 (borders).
 */
const NODE_CHROME_HEIGHT = 58

/**
 * Project video ratios are `W:H` strings validated by the project settings
 * policy; an unset or malformed value falls back to the same 16:9 default as
 * `getAspectRatioConfig`.
 */
const DEFAULT_FRAME_ASPECT = { width: 16, height: 9 } as const

const WORKSPACE_CANVAS_NODE_PRESENTATION_PROFILES = {
  resourceCard: {
    media: {
      image: { form: 'frame', maxMediaWidth: 360, maxMediaHeight: 460 },
      video: { form: 'frame', maxMediaWidth: 360, maxMediaHeight: 460 },
      audio: { form: 'bar', maxMediaWidth: 360, maxMediaHeight: 64 },
      text: { form: 'card', maxMediaWidth: 360, maxMediaHeight: 220 },
    },
  },
} as const satisfies Record<Extract<WorkspaceCanvasNodeKind, 'resourceCard'>, WorkspaceCanvasNodePresentationProfile>

export function getWorkspaceCanvasNodePresentationProfile(
  kind: Extract<WorkspaceCanvasNodeKind, 'resourceCard'>,
): WorkspaceCanvasNodePresentationProfile {
  return WORKSPACE_CANVAS_NODE_PRESENTATION_PROFILES[kind]
}

function parseFrameAspect(value: string | null | undefined): {
  readonly width: number
  readonly height: number
} | null {
  const match = value?.trim().match(/^(\d+):(\d+)$/)
  if (!match) return null
  const width = Number(match[1])
  const height = Number(match[2])
  if (!Number.isFinite(width) || !Number.isFinite(height) || width <= 0 || height <= 0) {
    return null
  }
  return { width, height }
}

function frozenAspectRatio(generationOptions: WorkspaceResourceJsonValue | null | undefined): string | null {
  if (!generationOptions || typeof generationOptions !== 'object' || Array.isArray(generationOptions)) {
    return null
  }
  const value = generationOptions.aspectRatio
  return typeof value === 'string' && parseFrameAspect(value) ? value : null
}

function resolvedFrameAspect(input: {
  readonly schemaId: string
  readonly generationOptions?: WorkspaceResourceJsonValue | null
  readonly mediaWidth?: number | null
  readonly mediaHeight?: number | null
  readonly projectAspectRatio: string | null | undefined
}): { readonly width: number; readonly height: number } {
  const frozen = parseFrameAspect(frozenAspectRatio(input.generationOptions))
  if (frozen) return frozen
  if (
    typeof input.mediaWidth === 'number'
    && Number.isFinite(input.mediaWidth)
    && input.mediaWidth > 0
    && typeof input.mediaHeight === 'number'
    && Number.isFinite(input.mediaHeight)
    && input.mediaHeight > 0
  ) {
    return { width: input.mediaWidth, height: input.mediaHeight }
  }
  const assetKind = resolveAssetImageKindForSchemaId(input.schemaId)
  const assetAspect = assetKind
    ? parseFrameAspect(getAssetImageFormatPolicy(assetKind).aspectRatio)
    : null
  return parseFrameAspect(input.projectAspectRatio)
    ?? assetAspect
    ?? DEFAULT_FRAME_ASPECT
}

/**
 * Resolves the media area for a node. Pending and ready states share this
 * exact shell, so a card never jumps in size when generation completes.
 */
export function resolveWorkspaceCanvasMediaShell(input: {
  readonly kind: Extract<WorkspaceCanvasNodeKind, 'resourceCard'>
  readonly mediaType: WorkspaceResourceMediaType
  readonly schemaId: string
  readonly generationOptions?: WorkspaceResourceJsonValue | null
  readonly mediaWidth?: number | null
  readonly mediaHeight?: number | null
  readonly projectAspectRatio: string | null | undefined
}): WorkspaceCanvasMediaShell {
  const presentation = getWorkspaceCanvasNodePresentationProfile(input.kind).media[input.mediaType]
  if (presentation.form !== 'frame') {
    return {
      form: presentation.form,
      width: presentation.maxMediaWidth,
      height: presentation.maxMediaHeight,
      fit: 'contain',
    }
  }
  const aspect = resolvedFrameAspect(input)
  const scale = Math.min(
    presentation.maxMediaWidth / aspect.width,
    presentation.maxMediaHeight / aspect.height,
  )
  return {
    form: 'frame',
    width: Math.round(aspect.width * scale),
    height: Math.round(aspect.height * scale),
    fit: input.mediaType === 'video' || resolveAssetImageKindForSchemaId(input.schemaId)
      ? 'contain'
      : 'cover',
  }
}

export function resolveWorkspaceCanvasNodeSize(input: {
  readonly kind: Extract<WorkspaceCanvasNodeKind, 'resourceCard'>
  readonly mediaType: WorkspaceResourceMediaType
  readonly schemaId: string
  readonly generationOptions?: WorkspaceResourceJsonValue | null
  readonly mediaWidth?: number | null
  readonly mediaHeight?: number | null
  readonly projectAspectRatio: string | null | undefined
}): WorkspaceCanvasNodeSize {
  const shell = resolveWorkspaceCanvasMediaShell(input)
  return {
    width: shell.width + NODE_CHROME_WIDTH,
    height: shell.height + NODE_CHROME_HEIGHT,
  }
}
