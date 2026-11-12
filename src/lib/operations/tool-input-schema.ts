import { z } from 'zod'
import { ApiError } from '@/lib/api-errors'
import type {
  JsonObject,
  JsonValue,
  ProjectAgentToolInputSchema,
  RuntimeSchema,
} from './types'
import { isOperationEnvironmentInputKey } from './environment-input'

type UnknownRecord = Record<string, unknown>

function isRecord(value: unknown): value is UnknownRecord {
  return !!value && typeof value === 'object' && !Array.isArray(value)
}

function runtimeJsonSchema(schema: RuntimeSchema<unknown>, operationId: string): unknown {
  if (!(schema instanceof z.ZodType)) {
    throw new Error(`PROJECT_AGENT_TOOL_INPUT_SCHEMA_ZOD_REQUIRED:${operationId}`)
  }
  // The AI SDK's asSchema closes every object, including z.record values.
  // Convert the canonical input schema directly so document JSON keeps its
  // recursive value contract; this projector owns argument strictness.
  return z.toJSONSchema(schema, { target: 'draft-7', io: 'input' })
}

function toJsonValue(value: unknown): JsonValue {
  if (
    value === null
    || typeof value === 'string'
    || typeof value === 'number'
    || typeof value === 'boolean'
  ) {
    return value
  }
  if (Array.isArray(value)) {
    return value.map(toJsonValue)
  }
  if (isRecord(value)) {
    const out: JsonObject = {}
    for (const [key, child] of Object.entries(value)) {
      if (child !== undefined) out[key] = toJsonValue(child)
    }
    return out
  }
  return null
}

function toJsonObject(value: unknown, operationId: string): JsonObject {
  const json = toJsonValue(value)
  if (!isRecord(json) || Array.isArray(json)) {
    throw new Error(`PROJECT_AGENT_TOOL_INPUT_SCHEMA_NOT_OBJECT:${operationId}`)
  }
  return json
}

function readStringArray(value: unknown): string[] {
  if (!Array.isArray(value)) return []
  return value.flatMap((item) => typeof item === 'string' && item.trim() ? [item.trim()] : [])
}

/**
 * A `z.never()` input field serializes to `{ "not": {} }`. Such fields are
 * execution-layer guards that forbid a value entirely, so they must never be
 * exposed to the model: strict-mode normalization would otherwise publish them
 * as required-but-unsatisfiable parameters and bait the model into filling
 * them. Zod validation on the execute path still rejects any value that
 * bypasses the tool schema.
 */
function isNeverSchema(value: unknown): boolean {
  if (!isRecord(value)) return false
  const not = value.not
  return isRecord(not) && Object.keys(not).length === 0
}

function readProperties(schema: JsonObject): Record<string, JsonValue> {
  const value = schema.properties
  if (!isRecord(value) || Array.isArray(value)) return {}
  const out: Record<string, JsonValue> = {}
  for (const [key, property] of Object.entries(value)) {
    if (key === 'confirmed' || key === 'confirmedMaxCost') continue
    if (isOperationEnvironmentInputKey(key)) continue
    if (isNeverSchema(property)) continue
    out[key] = toJsonValue(property)
  }
  return out
}

function schemaAllowsNull(schema: JsonValue): boolean {
  if (!isRecord(schema)) return schema === null
  const type = schema.type
  if (type === 'null') return true
  if (Array.isArray(type) && type.includes('null')) return true
  const enumValues = schema.enum
  if (Array.isArray(enumValues) && enumValues.includes(null)) return true
  const anyOf = schema.anyOf
  if (Array.isArray(anyOf) && anyOf.some(schemaAllowsNull)) return true
  const oneOf = schema.oneOf
  return Array.isArray(oneOf) && oneOf.some(schemaAllowsNull)
}

const OMIT_NULLISH_MODEL_VALUE = Symbol('omit-nullish-model-value')

/** 单条纠错里回显 schema 的上限;超过则只给字段路径与 issue 文案。 */
const MAX_CORRECTION_SCHEMA_CHARS = 1_200

function schemaMatchesDiscriminator(value: unknown, schema: JsonValue): boolean {
  if (!isRecord(schema)) return true
  if (Object.prototype.hasOwnProperty.call(schema, 'const')) return value === schema.const
  if (!isRecord(value)) return true
  const properties = readProperties(schema)
  const required = readStringArray(schema.required)
  if (required.some((key) => !Object.prototype.hasOwnProperty.call(value, key))) {
    return false
  }
  if (
    schema.additionalProperties === false
    && Object.keys(value).some((key) => !Object.prototype.hasOwnProperty.call(properties, key))
  ) {
    return false
  }
  for (const [key, propertySchema] of Object.entries(properties)) {
    if (!isRecord(propertySchema) || !Object.prototype.hasOwnProperty.call(propertySchema, 'const')) continue
    if (!Object.prototype.hasOwnProperty.call(value, key)) continue
    // A null in strict-dialect input may encode absence, so it can never veto
    // a branch through a const discriminator; the normalizer resolves it later.
    if (value[key] === null) continue
    if (!schemaMatchesDiscriminator(value[key], propertySchema)) return false
  }
  return true
}

function readUnionBranches(schema: JsonValue): JsonValue[] {
  if (!isRecord(schema)) return []
  const branches = Array.isArray(schema.oneOf)
    ? schema.oneOf
    : Array.isArray(schema.anyOf)
      ? schema.anyOf
      : []
  return branches.map(toJsonValue)
}

function selectUnionBranchIndex(value: unknown, branches: readonly JsonValue[]): number {
  const matches = branches.flatMap((branch, index) => (
    schemaMatchesDiscriminator(value, branch) ? [index] : []
  ))
  if (matches.length === 1) return matches[0] ?? -1
  if (!isRecord(value)) return -1
  const discriminatorMatches = branches.flatMap((branch, index) => {
    if (!isRecord(branch)) return []
    const properties = readProperties(branch)
    let hasDiscriminator = false
    for (const [key, propertySchema] of Object.entries(properties)) {
      if (!isRecord(propertySchema) || !Object.prototype.hasOwnProperty.call(propertySchema, 'const')) continue
      if (!Object.prototype.hasOwnProperty.call(value, key)) continue
      hasDiscriminator = true
      if (value[key] !== propertySchema.const) return []
    }
    return hasDiscriminator ? [index] : []
  })
  if (discriminatorMatches.length === 1) return discriminatorMatches[0] ?? -1
  // A malformed envelope can contain extra keys and still unambiguously
  // identify its branch, e.g. { request: {...}, folderPath: ... }. Prefer a
  // required key exclusive to one branch over errors from unrelated shapes.
  const shapeMatches = branches.flatMap((branch, index) => {
    if (!isRecord(branch)) return []
    const exclusiveKeyPresent = readStringArray(branch.required).some((key) => (
      Object.prototype.hasOwnProperty.call(value, key)
      && branches.every((other, otherIndex) => (
        otherIndex === index || !isRecord(other) || readProperties(other)[key] === undefined
      ))
    ))
    return exclusiveKeyPresent ? [index] : []
  })
  return shapeMatches.length === 1 ? shapeMatches[0] ?? -1 : -1
}

function selectUnionBranch(value: unknown, schema: JsonObject): JsonValue | null {
  const branches = readUnionBranches(schema)
  if (branches.length === 0) return null
  const index = selectUnionBranchIndex(value, branches)
  return index >= 0 ? branches[index] ?? null : null
}

/**
 * Picks the union branch a strict-dialect value belongs to. The canonical
 * runtime schema is the only required-key authority: strict projection marks
 * every key required, so tool-side required lists carry no discrimination
 * evidence. The tool projection preserves union order, so once the canonical
 * branch is known the matching tool branch is the same index.
 */
function selectUnionBranchPair(params: {
  value: unknown
  toolSchema: JsonObject
  runtimeSchema: JsonValue | undefined
}): { tool: JsonValue | null; runtime: JsonValue | null } {
  const toolBranches = readUnionBranches(params.toolSchema)
  const runtimeBranches = readUnionBranches(
    params.runtimeSchema === undefined ? null : params.runtimeSchema,
  )
  if (runtimeBranches.length > 0) {
    const runtimeIndex = selectUnionBranchIndex(params.value, runtimeBranches)
    if (runtimeIndex >= 0) {
      return {
        tool: toolBranches.length === runtimeBranches.length
          ? toolBranches[runtimeIndex] ?? null
          : selectUnionBranch(params.value, params.toolSchema),
        runtime: runtimeBranches[runtimeIndex] ?? null,
      }
    }
  }
  return {
    tool: selectUnionBranch(params.value, params.toolSchema),
    runtime: null,
  }
}

function normalizeNullableModelValue(
  value: unknown,
  toolSchema: JsonValue,
  runtimeSchema: JsonValue | undefined,
): unknown | typeof OMIT_NULLISH_MODEL_VALUE {
  if (value === null) {
    return schemaAllowsNull(toolSchema)
      && runtimeSchema !== undefined
      && !schemaAllowsNull(runtimeSchema)
      ? OMIT_NULLISH_MODEL_VALUE
      : value
  }
  if (Array.isArray(value)) {
    return value.map((item) => {
      if (!isRecord(toolSchema) || toolSchema.items === undefined) return item
      const runtimeItems = isRecord(runtimeSchema) && runtimeSchema.items !== undefined
        ? toJsonValue(runtimeSchema.items)
        : undefined
      const normalized = normalizeNullableModelValue(
        item,
        toJsonValue(toolSchema.items),
        runtimeItems,
      )
      return normalized === OMIT_NULLISH_MODEL_VALUE ? item : normalized
    })
  }
  if (!isRecord(value) || !isRecord(toolSchema)) return value
  const selectedBranches = selectUnionBranchPair({
    value,
    toolSchema,
    runtimeSchema,
  })
  if (selectedBranches.tool || selectedBranches.runtime) {
    return normalizeNullableModelValue(
      value,
      selectedBranches.tool ?? toolSchema,
      selectedBranches.runtime ?? runtimeSchema,
    )
  }
  const properties = readProperties(toolSchema)
  const runtimeProperties = isRecord(runtimeSchema) ? readProperties(runtimeSchema) : {}
  const normalized: UnknownRecord = {}
  for (const [key, child] of Object.entries(value)) {
    const propertySchema = properties[key]
    if (propertySchema === undefined) {
      normalized[key] = child
      continue
    }
    const next = normalizeNullableModelValue(child, propertySchema, runtimeProperties[key])
    if (next !== OMIT_NULLISH_MODEL_VALUE) normalized[key] = next
  }
  return normalized
}

/**
 * Strict tool schemas must list every property. Optional runtime fields of
 * legacy tools are therefore exposed to the model as nullable, but the
 * canonical Zod runtime schema still models absence as undefined. Preserve
 * real null values when Zod accepts them; otherwise, and only for a
 * tool-schema property that explicitly permits null, normalize null to
 * absence before the same Zod parser validates the request.
 *
 * When neither the raw input nor its normalization satisfies the canonical
 * schema this fails loudly with the same typed OPERATION_INPUT_INVALID error
 * the invocation authority raises: silently forwarding the raw input would
 * let half-translated payloads reach planning and surface as unrelated
 * downstream failures.
 */
export function normalizeProjectAgentToolInput(params: {
  operationId: string
  input: unknown
  inputSchema: RuntimeSchema<unknown>
  toolInputSchema: ProjectAgentToolInputSchema
}): unknown {
  const rawParse = params.inputSchema.safeParse(params.input)
  if (rawParse.success) return params.input
  const rawRuntimeSchema = runtimeJsonSchema(params.inputSchema, params.operationId)
  const runtimeSchema = toJsonObject(rawRuntimeSchema, params.operationId)
  const normalized = normalizeNullableModelValue(params.input, {
    type: params.toolInputSchema.type,
    properties: params.toolInputSchema.properties,
    required: params.toolInputSchema.required,
    additionalProperties: params.toolInputSchema.additionalProperties,
  }, runtimeSchema)
  const normalizedParse = normalized === OMIT_NULLISH_MODEL_VALUE
    ? null
    : params.inputSchema.safeParse(normalized)
  if (normalizedParse?.success) return normalized
  const correctionInput = normalized === OMIT_NULLISH_MODEL_VALUE ? params.input : normalized
  const rawIssues = normalizedParse && !normalizedParse.success
    ? normalizedParse.error.issues
    : rawParse.error.issues
  const issues = expandProjectAgentToolInputIssues({
    input: correctionInput,
    toolInputSchema: params.toolInputSchema,
    runtimeInputSchema: runtimeSchema,
    issues: rawIssues,
  })
  throw new ApiError('INVALID_PARAMS', {
    code: 'OPERATION_INPUT_INVALID',
    operationId: params.operationId,
    message: 'PROJECT_AGENT_INVALID_OPERATION_INPUT',
    issues,
    corrections: buildProjectAgentToolInputCorrections({
      input: correctionInput,
      toolInputSchema: params.toolInputSchema,
      issues,
    }),
  })
}

export type ProjectAgentToolInputCorrectionAction =
  | 'add_required_field'
  | 'move_unknown_field'
  | 'remove_unknown_field'
  | 'fix_invalid_value'

export interface ProjectAgentToolInputCorrection {
  action: ProjectAgentToolInputCorrectionAction
  fieldPath: string
  message: string
  targetPath?: string
  allowedKeys?: string[]
  allowedValues?: Array<string | number | boolean | null>
  expectedSchema?: JsonValue
  issueCode?: string
  reason?: string
}

function readIssuePath(issue: UnknownRecord): Array<string | number> {
  if (!Array.isArray(issue.path)) return []
  return issue.path.flatMap((part) => (
    typeof part === 'string' || typeof part === 'number' ? [part] : []
  ))
}

function formatInputPath(path: readonly (string | number)[]): string {
  return path.reduce<string>((result, part) => (
    typeof part === 'number'
      ? `${result}[${String(part)}]`
      : `${result}.${part}`
  ), '$input')
}

function readInputAtPath(input: unknown, path: readonly (string | number)[]): unknown {
  let current = input
  for (const part of path) {
    if (typeof part === 'number') {
      if (!Array.isArray(current)) return undefined
      current = current[part]
      continue
    }
    if (!isRecord(current)) return undefined
    current = current[part]
  }
  return current
}

function readSchemaAtPath(params: {
  schema: JsonValue
  input: unknown
  path: readonly (string | number)[]
}): JsonValue | undefined {
  let currentSchema = params.schema
  let currentInput = params.input
  for (const part of params.path) {
    if (!isRecord(currentSchema)) return undefined
    const selectedBranch = selectUnionBranch(currentInput, currentSchema)
    if (selectedBranch !== null) currentSchema = selectedBranch
    if (!isRecord(currentSchema)) return undefined
    if (typeof part === 'number') {
      if (currentSchema.items === undefined) return undefined
      currentSchema = toJsonValue(currentSchema.items)
      currentInput = Array.isArray(currentInput) ? currentInput[part] : undefined
      continue
    }
    const property = readProperties(currentSchema)[part]
    if (property === undefined) return undefined
    currentSchema = property
    currentInput = isRecord(currentInput) ? currentInput[part] : undefined
  }
  if (isRecord(currentSchema)) {
    return selectUnionBranch(currentInput, currentSchema) ?? currentSchema
  }
  return currentSchema
}

function readSchemaNodeAtPath(params: {
  schema: JsonValue
  input: unknown
  path: readonly (string | number)[]
}): JsonValue | undefined {
  let currentSchema = params.schema
  let currentInput = params.input
  for (const part of params.path) {
    if (!isRecord(currentSchema)) return undefined
    const selectedBranch = selectUnionBranch(currentInput, currentSchema)
    if (selectedBranch !== null) currentSchema = selectedBranch
    if (!isRecord(currentSchema)) return undefined
    if (typeof part === 'number') {
      if (currentSchema.items === undefined) return undefined
      currentSchema = toJsonValue(currentSchema.items)
      currentInput = Array.isArray(currentInput) ? currentInput[part] : undefined
      continue
    }
    const property = readProperties(currentSchema)[part]
    if (property === undefined) return undefined
    currentSchema = property
    currentInput = isRecord(currentInput) ? currentInput[part] : undefined
  }
  return currentSchema
}

/**
 * Zod represents a failed union as one parent `invalid_union` issue whose
 * useful field errors live in branch-local arrays. Keep only a uniquely
 * discriminated branch when possible; otherwise expose every real branch
 * issue. The returned paths are absolute input paths and the union wrapper is
 * removed, so downstream logging, model correction, and UI projection all
 * consume the same leaf reasons.
 */
export function expandProjectAgentToolInputIssues(params: {
  input: unknown
  toolInputSchema: ProjectAgentToolInputSchema
  /** Canonicalizer unions can accept durable forms omitted from the declaration. */
  runtimeInputSchema?: JsonObject
  issues: unknown
}): UnknownRecord[] {
  const rootSchema = params.runtimeInputSchema ?? serializeToolInputSchema(params.toolInputSchema)
  const expanded: UnknownRecord[] = []

  const visit = (issues: unknown, parentPath: readonly (string | number)[]): void => {
    if (!Array.isArray(issues)) return
    for (const rawIssue of issues) {
      if (!isRecord(rawIssue)) continue
      const path = [...parentPath, ...readIssuePath(rawIssue)]
      if (rawIssue.code === 'invalid_union' && Array.isArray(rawIssue.errors)) {
        const schema = readSchemaNodeAtPath({
          schema: rootSchema,
          input: params.input,
          path,
        })
        const branches = schema === undefined ? [] : readUnionBranches(schema)
        const value = readInputAtPath(params.input, path)
        const selectedIndex = selectUnionBranchIndex(value, branches)
        const branchErrors = selectedIndex >= 0
          ? [rawIssue.errors[selectedIndex]]
          : rawIssue.errors
        const before = expanded.length
        for (const errors of branchErrors) visit(errors, path)
        if (expanded.length > before) continue
      }
      const leaf: UnknownRecord = { ...rawIssue, path }
      delete leaf.errors
      expanded.push(leaf)
    }
  }

  visit(params.issues, [])
  return expanded
}

function readAllowedKeys(schema: JsonValue | undefined): string[] | undefined {
  if (!isRecord(schema)) return undefined
  const keys = Object.keys(readProperties(schema))
  return keys.length > 0 ? keys : undefined
}

function readAllowedValues(schema: JsonValue | undefined): Array<string | number | boolean | null> | undefined {
  if (!isRecord(schema)) return undefined
  const direct = Array.isArray(schema.enum)
    ? schema.enum
    : Object.prototype.hasOwnProperty.call(schema, 'const')
      ? [schema.const]
      : []
  const branches = [...readUnionBranches(schema), ...(Array.isArray(schema.allOf) ? schema.allOf.map(toJsonValue) : [])]
  const values = [
    ...direct,
    ...branches.flatMap((branch) => readAllowedValues(branch) ?? []),
  ].filter((value): value is string | number | boolean | null => (
    value === null
    || typeof value === 'string'
    || typeof value === 'number'
    || typeof value === 'boolean'
  ))
  const unique = Array.from(new Map(values.map((value) => [JSON.stringify(value), value])).values())
  return unique.length > 0 && unique.length <= 20 ? unique : undefined
}

/**
 * Converts canonical Zod issues into model-correctable instructions without
 * creating a second validation contract. Paths and expected shapes are always
 * projected from the same model-facing schema that accepted the tool call.
 */
export function buildProjectAgentToolInputCorrections(params: {
  input: unknown
  toolInputSchema: ProjectAgentToolInputSchema
  issues: unknown
}): ProjectAgentToolInputCorrection[] {
  const rootSchema = serializeToolInputSchema(params.toolInputSchema)
  const rootProperties = readProperties(rootSchema)
  const corrections: ProjectAgentToolInputCorrection[] = []
  const moveTargets = new Set<string>()
  const issues = expandProjectAgentToolInputIssues(params)

  for (const rawIssue of issues) {
    if (!isRecord(rawIssue) || rawIssue.code !== 'unrecognized_keys') continue
    const parentPath = readIssuePath(rawIssue)
    const parentSchema = readSchemaAtPath({
      schema: rootSchema,
      input: params.input,
      path: parentPath,
    })
    for (const key of readStringArray(rawIssue.keys)) {
      const fieldPath = formatInputPath([...parentPath, key])
      const targetPath = `$input.${key}`
      if (
        parentPath.length > 0
        && rootProperties[key] !== undefined
        && readInputAtPath(params.input, [key]) === undefined
      ) {
        moveTargets.add(targetPath)
        corrections.push({
          action: 'move_unknown_field',
          fieldPath,
          targetPath,
          message: `Move ${fieldPath} to ${targetPath}; "${key}" is a top-level sibling of ${Object.keys(rootProperties).filter((rootKey) => rootKey !== key).map((rootKey) => `$input.${rootKey}`).join(' and ')}.`,
          allowedKeys: readAllowedKeys(parentSchema),
          expectedSchema: rootProperties[key],
          issueCode: 'unrecognized_keys',
          reason: `Field "${key}" is not allowed at ${formatInputPath(parentPath)}.`,
        })
      } else {
        corrections.push({
          action: 'remove_unknown_field',
          fieldPath,
          message: `Remove ${fieldPath}; it is not allowed at ${formatInputPath(parentPath)}.`,
          allowedKeys: readAllowedKeys(parentSchema),
          issueCode: 'unrecognized_keys',
          reason: `Field "${key}" is not allowed at ${formatInputPath(parentPath)}.`,
        })
      }
    }
  }

  for (const rawIssue of issues) {
    if (!isRecord(rawIssue) || rawIssue.code === 'unrecognized_keys') continue
    const path = readIssuePath(rawIssue)
    const fieldPath = formatInputPath(path)
    const expectedSchema = readSchemaAtPath({
      schema: rootSchema,
      input: params.input,
      path,
    })
    const missing = path.length > 0 && readInputAtPath(params.input, path) === undefined
    if (missing && moveTargets.has(fieldPath)) continue
    const parentPath = path.slice(0, -1)
    const parentSchema = readSchemaAtPath({
      schema: rootSchema,
      input: params.input,
      path: parentPath,
    })
    const issueMessage = typeof rawIssue.message === 'string'
      ? rawIssue.message
      : 'Value does not match the operation input schema.'
    // 顶层/大分支失败时把整棵 schema 回贴给模型只会淹没有效指令(实测单条可达 8KB)。
    // 超限时省略 schema 回显,保留精确的字段路径与 issue 文案。
    const serializedSchemaSize = expectedSchema === undefined
      ? 0
      : JSON.stringify(expectedSchema).length
    const includeSchema = expectedSchema !== undefined
      && serializedSchemaSize <= MAX_CORRECTION_SCHEMA_CHARS
    corrections.push({
      action: missing ? 'add_required_field' : 'fix_invalid_value',
      fieldPath,
      message: missing
        ? `Add required field ${fieldPath} at this exact path.`
        : `Fix ${fieldPath}: ${issueMessage}`,
      allowedKeys: readAllowedKeys(parentSchema),
      allowedValues: readAllowedValues(expectedSchema),
      issueCode: typeof rawIssue.code === 'string' ? rawIssue.code : undefined,
      reason: issueMessage,
      ...(includeSchema ? { expectedSchema } : {}),
    })
  }

  return corrections
}

function addNullable(schema: JsonValue): JsonValue {
  if (schemaAllowsNull(schema)) return schema
  if (!isRecord(schema)) {
    return {
      anyOf: [
        { const: schema },
        { type: 'null' },
      ],
    }
  }

  if (Array.isArray(schema.enum)) {
    const type = schema.type
    return {
      ...schema,
      ...(typeof type === 'string'
        ? { type: [type, 'null'] }
        : Array.isArray(type)
          ? { type: Array.from(new Set([...type.filter((item): item is string => typeof item === 'string'), 'null'])) }
          : {}),
      enum: [...schema.enum, null].map(toJsonValue),
    }
  }

  if (Object.prototype.hasOwnProperty.call(schema, 'const')) {
    return {
      anyOf: [
        schema,
        { type: 'null' },
      ],
    }
  }

  if (typeof schema.type === 'string') {
    return {
      ...schema,
      type: [schema.type, 'null'],
    }
  }

  if (Array.isArray(schema.type)) {
    return {
      ...schema,
      type: Array.from(new Set([...schema.type.filter((item): item is string => typeof item === 'string'), 'null'])),
    }
  }

  return {
    anyOf: [
      schema,
      { type: 'null' },
    ],
  }
}

function normalizeSchemaNode(value: JsonValue, optional: boolean): JsonValue {
  if (Array.isArray(value)) {
    return value.map((item) => normalizeSchemaNode(item, false))
  }
  if (!isRecord(value)) return optional ? addNullable(value) : value

  const node: JsonObject = {}
  for (const [key, child] of Object.entries(value)) {
    if (key === 'properties' || key === 'required' || key === 'additionalProperties') continue
    node[key] = normalizeSchemaNode(child, false)
  }

  const properties = readProperties(value)
  const propertyKeys = Object.keys(properties)
  const originallyRequired = new Set(readStringArray(value.required))
  if (propertyKeys.length > 0 || value.type === 'object' || isRecord(value.properties)) {
    const normalizedProperties: Record<string, JsonValue> = {}
    for (const [key, child] of Object.entries(properties)) {
      normalizedProperties[key] = normalizeSchemaNode(child, !originallyRequired.has(key))
    }
    node.type = 'object'
    node.properties = normalizedProperties
    node.required = propertyKeys
    // Record values (for example a saved JSON document) are data, not extra
    // operation arguments. Preserve their value schema instead of erasing all
    // user-defined keys from the tool contract.
    node.additionalProperties = isRecord(value.additionalProperties)
      ? normalizeSchemaNode(toJsonValue(value.additionalProperties), false)
      : value.additionalProperties === true ? true : false
  }

  if (Array.isArray(value.anyOf)) {
    node.anyOf = value.anyOf.map((item) => normalizeSchemaNode(toJsonValue(item), false))
  }
  if (Array.isArray(value.oneOf)) {
    node.oneOf = value.oneOf.map((item) => normalizeSchemaNode(toJsonValue(item), false))
  }
  if (Array.isArray(value.allOf)) {
    node.allOf = value.allOf.map((item) => normalizeSchemaNode(toJsonValue(item), false))
  }
  if (value.items !== undefined) {
    node.items = normalizeSchemaNode(toJsonValue(value.items), false)
  }

  return optional ? addNullable(node) : node
}

function assertNoForbiddenToolSchemaSurface(params: {
  operationId: string
  path: string
  value: JsonValue
}): void {
  const { operationId, path, value } = params
  if (Array.isArray(value)) {
    value.forEach((item, index) => assertNoForbiddenToolSchemaSurface({
      operationId,
      path: `${path}/${String(index)}`,
      value: item,
    }))
    return
  }
  if (!isRecord(value)) return

  const properties = value.properties
  if (
    isRecord(properties)
    && (
      Object.prototype.hasOwnProperty.call(properties, 'confirmed')
      || Object.prototype.hasOwnProperty.call(properties, 'confirmedMaxCost')
      || Object.keys(properties).some(isOperationEnvironmentInputKey)
    )
  ) {
    throw new Error(`PROJECT_AGENT_TOOL_INPUT_SCHEMA_INTERNAL_FIELD_EXPOSED:${operationId}:${path}`)
  }
  if (isRecord(properties)) {
    for (const [propertyKey, propertySchema] of Object.entries(properties)) {
      if (isNeverSchema(propertySchema)) {
        throw new Error(`PROJECT_AGENT_TOOL_INPUT_SCHEMA_NEVER_EXPOSED:${operationId}:${path}/${propertyKey}`)
      }
    }
  }

  const required = readStringArray(value.required)
  const propertyKeys = isRecord(properties) ? Object.keys(properties) : []
  for (const key of propertyKeys) {
    if (!required.includes(key)) {
      throw new Error(`PROJECT_AGENT_TOOL_INPUT_SCHEMA_OPTIONAL_PROPERTY:${operationId}:${path}/${key}`)
    }
  }

  for (const [key, child] of Object.entries(value)) {
    assertNoForbiddenToolSchemaSurface({
      operationId,
      path: `${path}/${key}`,
      value: toJsonValue(child),
    })
  }
}

function serializeToolInputSchema(schema: ProjectAgentToolInputSchema): JsonObject {
  return {
    type: schema.type,
    properties: schema.properties,
    required: schema.required,
    additionalProperties: schema.additionalProperties,
    ...(schema.definitions === undefined ? {} : { definitions: schema.definitions }),
    ...(schema.$defs === undefined ? {} : { $defs: schema.$defs }),
    ...(typeof schema.description === 'string' ? { description: schema.description } : {}),
  }
}

export function createProjectAgentToolInputSchema(params: {
  operationId: string
  inputSchema: RuntimeSchema<unknown>
  explicitToolInputSchema?: ProjectAgentToolInputSchema
}): ProjectAgentToolInputSchema {
  if (params.explicitToolInputSchema) {
    assertNoForbiddenToolSchemaSurface({
      operationId: params.operationId,
      path: '#',
      value: serializeToolInputSchema(params.explicitToolInputSchema),
    })
    return params.explicitToolInputSchema
  }

  const rawJsonSchema = runtimeJsonSchema(params.inputSchema, params.operationId)
  const root = toJsonObject(rawJsonSchema, params.operationId)
  // A top-level union has no root properties. Projecting only properties
  // would silently publish {}, causing runtimes to discard every argument.
  // Use an object envelope with a nested union in a tool canonicalizer.
  if (root.type !== 'object' || !isRecord(root.properties)
    || root.anyOf !== undefined || root.oneOf !== undefined || root.allOf !== undefined) {
    throw new Error(`PROJECT_AGENT_TOOL_INPUT_SCHEMA_ROOT_OBJECT_REQUIRED:${params.operationId}`)
  }
  const normalized = normalizeSchemaNode(root, false)
  const normalizedRoot = toJsonObject(normalized, params.operationId)
  const properties = readProperties(normalizedRoot)
  const result: ProjectAgentToolInputSchema = {
    type: 'object',
    properties,
    required: Object.keys(properties),
    additionalProperties: false,
    ...(normalizedRoot.definitions === undefined ? {} : { definitions: normalizedRoot.definitions }),
    ...(normalizedRoot.$defs === undefined ? {} : { $defs: normalizedRoot.$defs }),
    ...(typeof normalizedRoot.description === 'string' ? { description: normalizedRoot.description } : {}),
  }
  assertNoForbiddenToolSchemaSurface({
    operationId: params.operationId,
    path: '#',
    value: serializeToolInputSchema(result),
  })
  return result
}
