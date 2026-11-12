import { describe, expect, it } from 'vitest'
import { z } from 'zod'
import { ApiError } from '@/lib/api-errors'
import { normalizeOperationExecutionToolError } from '@/lib/adapters/operation-error-normalizer'
import {
  createProjectAgentToolInputSchema,
  normalizeProjectAgentToolInput,
} from '@/lib/operations/tool-input-schema'

const requestSchema = z.object({
  request: z.union([
    z.object({
      kind: z.literal('new'),
      mode: z.enum(['reference']),
      maxBudgetCredits: z.number().positive().optional(),
    }).strict(),
    z.object({
      kind: z.literal('retry'),
      resourceIds: z.array(z.string()).min(1),
    }).strict(),
  ]),
}).strict()

const toolInputSchema = createProjectAgentToolInputSchema({
  operationId: 'test_operation',
  inputSchema: requestSchema,
})

describe('Project Agent Tool input error projection', () => {
  it('rejects a root union instead of silently publishing an empty parameter object', () => {
    expect(() => createProjectAgentToolInputSchema({
      operationId: 'root_union',
      inputSchema: z.union([
        z.object({ name: z.string() }).strict(),
        z.object({ request: z.object({ kind: z.literal('retry'), resourceId: z.string() }).strict() }).strict(),
      ]),
    })).toThrow('PROJECT_AGENT_TOOL_INPUT_SCHEMA_ROOT_OBJECT_REQUIRED:root_union')
    expect(createProjectAgentToolInputSchema({ operationId: 'empty', inputSchema: z.object({}).strict() }))
      .toEqual({ type: 'object', properties: {}, required: [], additionalProperties: false })
  })
  it('normalizes nullable transport fields before reporting the canonical leaf error', () => {
    try {
      normalizeProjectAgentToolInput({
        operationId: 'test_operation',
        input: {
          request: {
            kind: 'new',
            mode: 'frame',
            maxBudgetCredits: null,
          },
        },
        inputSchema: requestSchema,
        toolInputSchema,
      })
      throw new Error('expected normalization to reject the invalid mode')
    } catch (error) {
      expect(error).toBeInstanceOf(ApiError)
      if (!(error instanceof ApiError)) return
      expect(error.details?.issues).toEqual([
        expect.objectContaining({
          code: 'invalid_value',
          path: ['request', 'mode'],
        }),
      ])
      expect(error.details?.corrections).toEqual([
        expect.objectContaining({
          fieldPath: '$input.request.mode',
          issueCode: 'invalid_value',
          allowedValues: ['reference'],
          reason: expect.stringContaining('reference'),
        }),
      ])
    }
  })

  it('removes accepted null-as-absence without retaining a second input shape', () => {
    const normalized = normalizeProjectAgentToolInput({
      operationId: 'test_operation',
      input: {
        request: {
          kind: 'new',
          mode: 'reference',
          maxBudgetCredits: null,
        },
      },
      inputSchema: requestSchema,
      toolInputSchema,
    })
    expect(normalized).toEqual({ request: { kind: 'new', mode: 'reference' } })
    expect(requestSchema.safeParse(normalized).success).toBe(true)
  })

  it('preserves a safe domain reason code through the model error boundary', () => {
    const projected = normalizeOperationExecutionToolError({
      operationId: 'create_video',
      error: new ApiError('INVALID_PARAMS', {
        code: 'VIDEO_MODEL_TOTAL_REFERENCE_LIMIT_EXCEEDED',
        field: 'references',
        limit: 12,
      }),
    })
    expect(projected.details).toMatchObject({
      reasonCode: 'VIDEO_MODEL_TOTAL_REFERENCE_LIMIT_EXCEEDED',
      field: 'references',
      limit: 12,
    })
  })
})
