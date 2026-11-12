import { Server } from '@modelcontextprotocol/sdk/server/index.js'
import {
  CallToolRequestSchema,
  ElicitResultSchema,
  ListToolsRequestSchema,
  type CallToolResult,
  type ListToolsResult,
} from '@modelcontextprotocol/sdk/types.js'
import { normalizeOperationExecutionToolError } from '@/lib/adapters/operation-error-normalizer'
import type { JsonObject } from '@/lib/operations/types'
import type { ProjectProductionContext } from '@/lib/project-production-context'
import type {
  WaoMcpCallContextResolver,
  WaoMcpElicitationRequest,
  WaoMcpElicitationResult,
  WaoMcpOperationExecutor,
  WaoMcpOperationExecutorResult,
} from './contracts'
import { WAO_RUNTIME_TOKEN_MAX_TTL_SECONDS } from './runtime-token'
import { createWaoMcpToolRegistry } from './tool-registry'
import {
  buildWaoMcpUserDecisionElicitation,
  parseWaoMcpUserDecisionInput,
  projectWaoMcpUserDecisionResult,
  WaoMcpUserDecisionInputError,
} from './user-decision'

// MCP server-to-client requests have their own 60 second SDK default, separate
// from Codex's per-tool timeout. A Wao approval or product decision belongs to
// the user, so keep it alive within (but safely below) the capability token
// lifetime.
const WAO_MCP_ELICITATION_TIMEOUT_MS = (
  WAO_RUNTIME_TOKEN_MAX_TTL_SECONDS - 5 * 60
) * 1_000

export interface CreateWaoMcpServerParams {
  readonly executor: WaoMcpOperationExecutor
  readonly contextResolver: WaoMcpCallContextResolver
  readonly name?: string
  readonly version?: string
  readonly productionContext: ProjectProductionContext
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === 'object' && !Array.isArray(value)
}

function toJsonObject(value: unknown): JsonObject {
  const serialized = JSON.stringify(value)
  if (serialized === undefined) throw new Error('WAO_MCP_ERROR_RESULT_NOT_JSON')
  const parsed: unknown = JSON.parse(serialized)
  if (!isRecord(parsed)) throw new Error('WAO_MCP_ERROR_RESULT_NOT_OBJECT')
  return parsed as JsonObject
}

function errorResult(code: string, message: string): CallToolResult {
  return {
    isError: true,
    content: [{ type: 'text', text: message }],
    structuredContent: {
      ok: false,
      error: { code, message },
    },
  }
}

function projectExecutorResult(
  result: WaoMcpOperationExecutorResult,
): CallToolResult {
  const text = result.text.trim()
  if (!text) {
    return errorResult(
      'WAO_MCP_EXECUTOR_RESULT_INVALID',
      'The operation executor returned an invalid result.',
    )
  }
  return {
    ...(result.isError ? { isError: true } : {}),
    content: [{ type: 'text', text }],
    structuredContent: result.structuredContent,
  }
}

/**
 * Creates the transport-independent MCP protocol server. The context resolver
 * binds each request to trusted Wao scope and stable Turn/call identity. The
 * executor owns canonical Operation validation, approvals and execution. This
 * layer only advertises registry-derived tools and forwards calls; it never
 * reads or writes DB, Task, billing, or provider state.
 */
export function createWaoMcpServer(
  params: CreateWaoMcpServerParams,
): Server {
  const catalog = createWaoMcpToolRegistry(params.productionContext)
  const entryByName = new Map(
    catalog.map((entry) => [entry.name, entry] as const),
  )
  const server = new Server(
    {
      name: params.name?.trim() || 'wao-mcp',
      version: params.version?.trim() || '0.1.0',
    },
    {
      capabilities: { tools: {} },
      instructions:
        'Wao project tools. Production schemas come from the canonical Operation registry; user decisions use the single Wao interaction contract.',
    },
  )

  server.setRequestHandler(
    ListToolsRequestSchema,
    async (): Promise<ListToolsResult> => {
      return {
        tools: catalog.map((entry) => entry.tool),
      }
    },
  )

  server.setRequestHandler(
    CallToolRequestSchema,
    async (request, extra): Promise<CallToolResult> => {
      const entry = entryByName.get(request.params.name)
      if (!entry) {
        return errorResult(
          'WAO_MCP_TOOL_NOT_ALLOWED',
          'This tool is not available through Wao MCP.',
        )
      }
      try {
        const context = await params.contextResolver.resolve({
          toolName: entry.name,
          requestId: extra.requestId,
          sessionId: extra.sessionId?.trim() || null,
          signal: extra.signal,
        })
        if (!context) {
          return errorResult(
            'WAO_MCP_TRUSTED_CONTEXT_REQUIRED',
            'This tool call is not bound to an active Wao turn.',
          )
        }
        const elicit = async (
          elicitation: WaoMcpElicitationRequest,
        ): Promise<WaoMcpElicitationResult> => {
          // Keep the server request related to this tools/call request.
          // Streamable HTTP routes related requests over the active POST
          // response; Server.elicitInput has no parent request identity here
          // and therefore targets a standalone SSE stream that the Codex MCP
          // client does not keep open.
          const result = await extra.sendRequest({
            method: 'elicitation/create',
            params: {
              ...elicitation,
              mode: 'form',
            },
          }, ElicitResultSchema, {
            signal: extra.signal,
            timeout: WAO_MCP_ELICITATION_TIMEOUT_MS,
            maxTotalTimeout: WAO_MCP_ELICITATION_TIMEOUT_MS,
          })
          return {
            action: result.action,
            ...(isRecord(result.content)
              ? { content: result.content }
              : {}),
          }
        }
        if (entry.kind === 'user_decision') {
          const input = parseWaoMcpUserDecisionInput(request.params.arguments ?? {})
          return projectExecutorResult(projectWaoMcpUserDecisionResult(
            input,
            await elicit(buildWaoMcpUserDecisionElicitation(input)),
          ))
        }
        return projectExecutorResult(
          await params.executor.execute({
            operationId: entry.operation.operationId,
            input: request.params.arguments ?? {},
            context: {
              ...context,
              productionConfigurationVersion: params.productionContext.version,
            },
            signal: extra.signal,
            elicit,
          }),
        )
      } catch (error) {
        extra.signal.throwIfAborted()
        if (entry.kind === 'user_decision') {
          const inputError = error instanceof WaoMcpUserDecisionInputError ? error : null
          return errorResult(
            inputError?.message ?? 'WAO_MCP_USER_DECISION_FAILED',
            inputError
              ? `The user decision request is invalid. ${inputError.details} Pass header, question, and optional otherLabel as separate top-level fields; pass options as an array of 2-4 objects with unique ids and labels. Correct the reported fields and call the tool again.`
              : 'The user decision could not be completed.',
          )
        }
        const projected = normalizeOperationExecutionToolError({
          error,
          operationId: entry.operation.operationId,
        })
        return projectExecutorResult({
          structuredContent: {
            ok: false,
            error: toJsonObject(projected),
          },
          text: projected.message,
          isError: true,
        })
      }
    },
  )

  return server
}
