import { z } from 'zod'
import type {
  ElicitRequestFormParams,
  ElicitResult,
  Tool,
} from '@modelcontextprotocol/sdk/types.js'
import type { JsonObject } from '@/lib/operations/types'

export const WAO_MCP_USER_DECISION_TOOL_NAME = 'request_user_decision' as const
export const WAO_MCP_USER_DECISION_OPTION_FIELD = 'optionId' as const
export const WAO_MCP_USER_DECISION_OTHER_FIELD = 'otherText' as const
export const WAO_MCP_USER_DECISION_OTHER_OPTION_ID = '__wao_other__' as const
export const WAO_MCP_USER_DECISION_META_KEY = 'wao.dev/user-decision-presentation' as const

const optionIdSchema = z.string().trim().min(1).max(64).regex(/^[A-Za-z0-9][A-Za-z0-9_-]*$/u)
const optionDescriptionSchema = z.string().trim().min(1).max(240)
const optionSchema = z.object({
  id: optionIdSchema,
  label: z.string().trim().min(1).max(80),
  description: optionDescriptionSchema,
}).strict()

const presentationSchema = z.object({
  protocol: z.literal('wao_user_decision_presentation_v1'),
  options: z.array(z.object({
    id: optionIdSchema,
    description: optionDescriptionSchema,
  }).strict()).min(2).max(4),
}).strict()

const inputSchema = z.object({
  header: z.string().trim().min(1).max(80),
  question: z.string().trim().min(1).max(500),
  options: z.array(optionSchema).min(2).max(4),
  otherLabel: z.string().trim().min(1).max(80).optional(),
}).strict().superRefine((input, context) => {
  const ids = new Set<string>()
  const labels = new Set<string>()
  for (const [index, option] of input.options.entries()) {
    if (option.id === WAO_MCP_USER_DECISION_OTHER_OPTION_ID || ids.has(option.id)) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['options', index, 'id'],
        message: 'WAO_MCP_USER_DECISION_OPTION_ID_INVALID',
      })
    }
    if (labels.has(option.label)) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['options', index, 'label'],
        message: 'WAO_MCP_USER_DECISION_OPTION_LABEL_DUPLICATE',
      })
    }
    ids.add(option.id)
    labels.add(option.label)
  }
})

export type WaoMcpUserDecisionInput = z.infer<typeof inputSchema>
export type WaoMcpUserDecisionPresentation = z.infer<typeof presentationSchema>

export const WAO_MCP_USER_DECISION_TOOL: Tool = {
  name: WAO_MCP_USER_DECISION_TOOL_NAME,
  description: [
    'Ask the current Wao user one necessary, non-sensitive product decision and wait for a structured answer.',
    'Use when an explicit creative checkpoint requires the user\'s choice, including image-style selection before generation, or when a missing choice would materially change the result and cannot be inferred safely.',
    'Do not use for credentials, secrets, billing approval, permissions, destructive confirmation, or information already supplied by the user.',
    'Always include header, question, and options. The question is required even when the header names the decision; pass it as a separate top-level string.',
    'Provide 2-4 mutually exclusive options with stable ids. Pass options as a JSON array, not a serialized string. Set otherLabel in the user\'s language only when a free-form answer is useful.',
  ].join(' '),
  inputSchema: {
    type: 'object',
    properties: {
      header: {
        type: 'string',
        minLength: 1,
        maxLength: 80,
        description: 'Short localized heading for the decision card.',
      },
      question: {
        type: 'string',
        minLength: 1,
        maxLength: 500,
        description: 'One localized question explaining the decision needed.',
      },
      options: {
        type: 'array',
        minItems: 2,
        maxItems: 4,
        items: {
          type: 'object',
          properties: {
            id: {
              type: 'string',
              minLength: 1,
              maxLength: 64,
              pattern: '^[A-Za-z0-9][A-Za-z0-9_-]*$',
              description: 'Stable machine-readable option id.',
            },
            label: {
              type: 'string',
              minLength: 1,
              maxLength: 80,
              description: 'Short localized option label.',
            },
            description: {
              type: 'string',
              minLength: 1,
              maxLength: 240,
              description: 'Localized impact or tradeoff of this option.',
            },
          },
          required: ['id', 'label', 'description'],
          additionalProperties: false,
        },
      },
      otherLabel: {
        type: 'string',
        minLength: 1,
        maxLength: 80,
        description: 'Optional localized label that enables a free-form answer.',
      },
    },
    required: ['header', 'question', 'options'],
    additionalProperties: false,
  },
  annotations: {
    readOnlyHint: true,
    destructiveHint: false,
    openWorldHint: false,
  },
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value)
}

function parseJsonValue(value: string): unknown {
  try {
    return JSON.parse(value)
  } catch {
    return undefined
  }
}

/**
 * Some model runtimes serialize nested arrays of objects as JSON strings when
 * bridging MCP tool arguments. Accept that representation so a valid decision
 * card still reaches the user instead of failing before the elicitation.
 */
function normalizeUserDecisionOptions(value: unknown): unknown {
  const parsed = typeof value === 'string' ? parseJsonValue(value) : value
  if (!Array.isArray(parsed)) return parsed
  return parsed.map((entry) => {
    if (typeof entry !== 'string') return entry
    const candidate = parseJsonValue(entry)
    return isRecord(candidate) ? candidate : entry
  })
}

function normalizeUserDecisionInput(value: unknown): unknown {
  const parsed = typeof value === 'string' ? parseJsonValue(value) : value
  if (!isRecord(parsed)) return parsed
  const options = normalizeUserDecisionOptions(parsed.options)
  if (!Array.isArray(options) && typeof parsed.options === 'string') {
    // Some runtimes leave the remaining argument fields inside the options
    // string, with JSON quotes still escaped. Re-wrap only a complete JSON
    // fragment; never infer missing content or overwrite conflicting fields.
    const decoded = parseJsonValue(`"${parsed.options}"`)
    const candidates = [parsed.options, ...(typeof decoded === 'string' ? [decoded] : [])]
    for (const candidate of candidates) {
      for (const suffix of ['', '}']) {
        const fields = parseJsonValue(`{"options":${candidate}${suffix}`)
        if (!isRecord(fields) || !Array.isArray(fields.options)) continue
        if (Object.keys(fields).some((key) => (
          key !== 'options' && key !== 'question' && key !== 'otherLabel'
        ))) continue
        if (Object.entries(fields).some(([key, field]) => (
          key !== 'options' && Object.hasOwn(parsed, key) && parsed[key] !== field
        ))) continue
        return { ...parsed, ...fields, options: normalizeUserDecisionOptions(fields.options) }
      }
    }
  }
  return {
    ...parsed,
    options,
  }
}

export class WaoMcpUserDecisionInputError extends Error {
  readonly details: string

  constructor(error: z.ZodError) {
    super('WAO_MCP_USER_DECISION_INPUT_INVALID')
    this.name = 'WaoMcpUserDecisionInputError'
    this.details = error.issues.map((issue) => (
      `${issue.path.join('.') || 'arguments'}: ${issue.message}`
    )).join('; ')
  }
}

export function parseWaoMcpUserDecisionInput(
  value: unknown,
): WaoMcpUserDecisionInput {
  const parsed = inputSchema.safeParse(normalizeUserDecisionInput(value))
  if (!parsed.success) throw new WaoMcpUserDecisionInputError(parsed.error)
  return parsed.data
}

export function buildWaoMcpUserDecisionElicitation(
  input: WaoMcpUserDecisionInput,
): ElicitRequestFormParams {
  const oneOf = [
    ...input.options.map((option) => ({
      const: option.id,
      title: option.label,
    })),
    ...(input.otherLabel
      ? [{
          const: WAO_MCP_USER_DECISION_OTHER_OPTION_ID,
          title: input.otherLabel,
        }]
      : []),
  ]
  return {
    mode: 'form',
    message: input.question,
    _meta: {
      [WAO_MCP_USER_DECISION_META_KEY]: {
        protocol: 'wao_user_decision_presentation_v1',
        options: input.options.map((option) => ({
          id: option.id,
          description: option.description,
        })),
      },
    },
    requestedSchema: {
      type: 'object',
      properties: {
        [WAO_MCP_USER_DECISION_OPTION_FIELD]: {
          type: 'string',
          title: input.header,
          oneOf,
        },
        ...(input.otherLabel
          ? {
              [WAO_MCP_USER_DECISION_OTHER_FIELD]: {
                type: 'string' as const,
                title: input.otherLabel,
                minLength: 1,
                maxLength: 1_000,
              },
            }
          : {}),
      },
      required: [WAO_MCP_USER_DECISION_OPTION_FIELD],
    },
  }
}

export type WaoMcpUserDecisionProjection = {
  readonly structuredContent: JsonObject
  readonly text: string
}

export function projectWaoMcpUserDecisionResult(
  input: WaoMcpUserDecisionInput,
  result: ElicitResult,
): WaoMcpUserDecisionProjection {
  if (result.action !== 'accept') {
    return {
      structuredContent: {
        ok: true,
        data: {
          outcome: 'cancelled',
          action: result.action,
        },
      },
      text: 'USER_DECISION_CANCELLED',
    }
  }
  if (!isRecord(result.content)) {
    throw new Error('WAO_MCP_USER_DECISION_RESULT_INVALID')
  }
  const optionId = result.content[WAO_MCP_USER_DECISION_OPTION_FIELD]
  if (optionId === WAO_MCP_USER_DECISION_OTHER_OPTION_ID) {
    const otherText = result.content[WAO_MCP_USER_DECISION_OTHER_FIELD]
    if (typeof otherText !== 'string' || !otherText.trim() || otherText.length > 1_000) {
      throw new Error('WAO_MCP_USER_DECISION_RESULT_INVALID')
    }
    return {
      structuredContent: {
        ok: true,
        data: {
          outcome: 'selected',
          selection: {
            kind: 'other',
            text: otherText.trim(),
          },
        },
      },
      text: otherText.trim(),
    }
  }
  if (typeof optionId !== 'string') {
    throw new Error('WAO_MCP_USER_DECISION_RESULT_INVALID')
  }
  const option = input.options.find((candidate) => candidate.id === optionId)
  if (!option) throw new Error('WAO_MCP_USER_DECISION_RESULT_INVALID')
  return {
    structuredContent: {
      ok: true,
      data: {
        outcome: 'selected',
        selection: {
          kind: 'option',
          optionId: option.id,
          label: option.label,
        },
      },
    },
    text: option.label,
  }
}

export function isWaoMcpUserDecisionRequestedSchema(
  schema: Record<string, unknown> | null,
): boolean {
  if (!schema || schema.type !== 'object' || !isRecord(schema.properties)) return false
  const propertyKeys = Object.keys(schema.properties)
  if (
    propertyKeys.some((key) => (
      key !== WAO_MCP_USER_DECISION_OPTION_FIELD
      && key !== WAO_MCP_USER_DECISION_OTHER_FIELD
    ))
  ) return false
  const optionProperty = schema.properties[WAO_MCP_USER_DECISION_OPTION_FIELD]
  if (!isRecord(optionProperty) || optionProperty.type !== 'string') return false
  if (!Array.isArray(optionProperty.oneOf) || optionProperty.oneOf.length < 2) return false
  const optionsValid = optionProperty.oneOf.every((entry) => (
    isRecord(entry)
    && typeof entry.const === 'string'
    && Boolean(entry.const.trim())
    && typeof entry.title === 'string'
    && Boolean(entry.title.trim())
  ))
  if (!optionsValid) return false
  const otherProperty = schema.properties[WAO_MCP_USER_DECISION_OTHER_FIELD]
  const hasOtherOption = optionProperty.oneOf.some((entry) => (
    isRecord(entry) && entry.const === WAO_MCP_USER_DECISION_OTHER_OPTION_ID
  ))
  return otherProperty === undefined
    ? !hasOtherOption
    : hasOtherOption && isRecord(otherProperty) && otherProperty.type === 'string'
}

export function readWaoMcpUserDecisionPresentation(input: {
  readonly requestedSchema: Record<string, unknown> | null
  readonly meta: Record<string, unknown> | null
}): WaoMcpUserDecisionPresentation | null {
  if (!isWaoMcpUserDecisionRequestedSchema(input.requestedSchema)) return null
  const parsed = presentationSchema.safeParse(
    input.meta?.[WAO_MCP_USER_DECISION_META_KEY],
  )
  if (!parsed.success || !input.requestedSchema || !isRecord(input.requestedSchema.properties)) {
    throw new Error('WAO_MCP_USER_DECISION_PRESENTATION_INVALID')
  }
  const optionProperty = input.requestedSchema.properties[WAO_MCP_USER_DECISION_OPTION_FIELD]
  if (!isRecord(optionProperty) || !Array.isArray(optionProperty.oneOf)) {
    throw new Error('WAO_MCP_USER_DECISION_PRESENTATION_INVALID')
  }
  const optionIds = optionProperty.oneOf.flatMap((entry) => (
    isRecord(entry)
    && typeof entry.const === 'string'
    && entry.const !== WAO_MCP_USER_DECISION_OTHER_OPTION_ID
      ? [entry.const]
      : []
  ))
  const presentationIds = parsed.data.options.map((option) => option.id)
  if (
    new Set(optionIds).size !== optionIds.length
    || new Set(presentationIds).size !== presentationIds.length
    || optionIds.length !== presentationIds.length
    || optionIds.some((optionId) => !presentationIds.includes(optionId))
  ) {
    throw new Error('WAO_MCP_USER_DECISION_PRESENTATION_INVALID')
  }
  return parsed.data
}
