import type { CanvasGenerationIntent } from '@/lib/workspace-resource/canvas-generation-intent'
import type { RuntimeJsonObject } from '@/lib/codex-runtime/runtime-adapter'
import { resolveReasoningEffort } from '@/lib/ai-exec/reasoning-effort'
import type { ReasoningEffort } from '@/lib/ai-registry/reasoning-effort'
import type {
  RuntimeSessionScope,
  RuntimeSessionThreadConfiguration,
} from '@/lib/codex-runtime/runtime-session-manager'
import {
  issueWaoRuntimeToken,
  WAO_RUNTIME_TOKEN_MAX_TTL_SECONDS,
} from '@/lib/wao-mcp/runtime-token'
import {
  CODEX_RUNTIME_BEARER_ENV_KEY,
  resolveCodexModelGatewayRuntimeConfig,
} from '@/lib/codex-model-gateway'
import {
  CREATIVE_RUNTIME_SKILLS,
  CREATIVE_SKILL_REGISTRY,
  PRIMARY_AGENT_DISABLED_NATIVE_SKILL_IDS,
  creativeSkillRoutingInstructions,
  creativeOutputJsonSchema,
} from '@/lib/creative-skills'
import {
  buildProjectAgentBasePrompt,
  buildProjectAgentSystemPrompt,
} from '@/lib/ai-prompts/project-agent-system'
import {
  formatProjectProductionContext,
  readProjectProductionContext,
  type ProjectProductionContext,
} from '@/lib/project-production-context'

const MCP_PATH = '/api/internal/codex-runtime/mcp'
// Codex defaults MCP tool calls to 60 seconds. Wao production calls can spend
// most of that time planning before they suspend on a user-owned billing
// decision, so the default races the approval UI. Keep the call alive for the
// same bounded lifetime as its project capability token; Wao still owns plan
// validity, idempotency, cancellation, and execution state.
const WAO_MCP_TOOL_TIMEOUT_SECONDS = WAO_RUNTIME_TOKEN_MAX_TTL_SECONDS

export const ASSISTANT_RUNTIME_DEVELOPER_INSTRUCTIONS = buildProjectAgentSystemPrompt(
  creativeSkillRoutingInstructions(),
)

// The custom base replaces Codex's built-in coding-agent base prompt. It keeps
// the load-bearing channel, formatting, update, and autonomy contract verbatim
// and drops the Codex identity plus coding-only rules (apply_patch/git editing
// constraints, review mindset, frontend design).
export const ASSISTANT_RUNTIME_BASE_INSTRUCTIONS = buildProjectAgentBasePrompt()

export const ASSISTANT_RUNTIME_CODEX_VERSION = '0.146.0' as const

export const ASSISTANT_RUNTIME_STATIC_CONTRACT = {
  thread: {
    // Shell, rule, Skill, and permission escalation have no product-owned UI,
    // so denied commands must fail in place. Wao billable/destructive actions
    // are MCP elicitations with authenticated browser proof and remain the one
    // interactive approval class.
    approvalPolicy: {
      granular: {
        sandbox_approval: false,
        rules: false,
        skill_approval: false,
        request_permissions: false,
        mcp_elicitations: true,
      },
    },
    sandbox: 'workspace-write',
    serviceName: 'wao-creative-agent',
    // 'none': the pragmatic preset injects a software-engineer persona into the
    // Codex base prompt; tone is owned solely by our developer instructions.
    personality: 'none',
    ephemeral: false,
  },
  tools: {
    webSearch: 'live',
    features: {
      skillSearch: false,
      imageGeneration: false,
      standaloneWebSearch: true,
      remoteCompactionV2: false,
      codeMode: {
        enabled: true,
        // These tools are declared directly to the model and intentionally
        // absent from exec's ALL_TOOLS. Keep turn guidance explicit so absence
        // from that partial index is never diagnosed as a missing generator.
        directOnlyToolNamespaces: ['mcp__wao'],
      },
      codeModeHost: {
        enabled: true,
        disableInProcessFallback: true,
      },
    },
    waoMcp: {
      required: true,
      defaultToolsApprovalMode: 'approve',
    },
    modelProvider: {
      wireApi: 'responses',
      requiresOpenAiAuth: false,
      supportsStandaloneWebSearch: true,
    },
  },
  creativeRuntime: {
    agentsEnabled: false,
    primaryAgentGlobalInstructions: ASSISTANT_RUNTIME_DEVELOPER_INSTRUCTIONS,
    disabledNativeSkillIds: PRIMARY_AGENT_DISABLED_NATIVE_SKILL_IDS,
    skills: CREATIVE_SKILL_REGISTRY,
    runtimeSkills: CREATIVE_RUNTIME_SKILLS,
    outputSchemas: Object.fromEntries(CREATIVE_RUNTIME_SKILLS.map((skill) => [
      skill.outputKind,
      creativeOutputJsonSchema(skill.outputKind),
    ])),
  },
} as const

export type AssistantRuntimeAccess = {
  readonly environment: Readonly<Record<string, string>>
  readonly bearerToken: string
  readonly ownerToken: string
  readonly expiresAtMs: number
}

export type AssistantRuntimeModelConfiguration = {
  readonly modelKey: string
  readonly runtimeModel: string
  readonly reasoningEffort: ReasoningEffort
  readonly projectProductionContext: ProjectProductionContext
  readonly thread: RuntimeSessionThreadConfiguration
}

function requireAbsoluteHttpUrl(value: string | undefined, code: string): string {
  if (!value || value !== value.trim()) throw new Error(code)
  const url = new URL(value)
  if (url.protocol !== 'http:' && url.protocol !== 'https:') throw new Error(code)
  if (url.username || url.password || url.hash || url.search) throw new Error(code)
  return url.toString().replace(/\/$/u, '')
}

function runtimeSandboxMode(): 'workspace-write' {
  const driver = process.env.CODEX_RUNTIME_DRIVER
  if (driver === 'local' || driver === 'docker') return 'workspace-write'
  throw new Error('ASSISTANT_RUNTIME_DRIVER_REQUIRED')
}

function runtimeConfig(input: {
  readonly mcpUrl: string
  readonly modelGatewayUrl: string
  readonly modelProviderId: string
  readonly bearerTokenEnvironmentKey: string
  readonly requestMaxRetries: number
  readonly streamMaxRetries: number
}): RuntimeJsonObject {
  const tools = ASSISTANT_RUNTIME_STATIC_CONTRACT.tools
  return {
    // Codex owns the search tool the model sees, and that ownership is what
    // makes a search legible: Codex creates one `webSearch` item per call with
    // the model's own query, so three searches render as three rows. The
    // provider behind it is Wao's gateway, which delegates to OpenAI hosted
    // research — the tool is native, the capability is not OpenRouter's.
    web_search: tools.webSearch,
    features: {
      // Wao installs only its six registry-bound domain Skills. Built-in image
      // generation stays disabled; paid media crosses Wao's direct Operations.
      skill_search: tools.features.skillSearch,
      image_generation: tools.features.imageGeneration,
      // The custom provider answers search itself through /alpha/search. This
      // third switch is what installs the tool; provider capability and live
      // mode alone do not.
      standalone_web_search: tools.features.standaloneWebSearch,
      // Keep compaction local: Wao proxies Responses and standalone search,
      // not OpenAI's private remote-compaction endpoint.
      remote_compaction_v2: tools.features.remoteCompactionV2,
      // GPT-5.6 Sol/Terra select Codex's code-mode-only tool contract in their
      // official model metadata. The bundled process host must therefore be
      // available or those models fail closed without shell or Web Search.
      // Wao stays direct-model-only so business approval never crosses the
      // nested executor and still has one visible, product-owned protocol.
      code_mode: {
        enabled: tools.features.codeMode.enabled,
        direct_only_tool_namespaces: [...tools.features.codeMode.directOnlyToolNamespaces],
      },
      code_mode_host: {
        enabled: tools.features.codeModeHost.enabled,
        disable_in_process_fallback: tools.features.codeModeHost.disableInProcessFallback,
      },
    },
    mcp_servers: {
      wao: {
        url: input.mcpUrl,
        bearer_token_env_var: input.bearerTokenEnvironmentKey,
        required: tools.waoMcp.required,
        // Wao owns approval for its immutable production plan and quoted
        // budget. Codex approval remains enabled for shell/file permissions,
        // but must not add a second prompt in front of Wao MCP tools.
        default_tools_approval_mode: tools.waoMcp.defaultToolsApprovalMode,
        tool_timeout_sec: WAO_MCP_TOOL_TIMEOUT_SECONDS,
      },
    },
    model_providers: {
      [input.modelProviderId]: {
        name: 'Wao Responses Gateway',
        base_url: input.modelGatewayUrl,
        env_key: input.bearerTokenEnvironmentKey,
        wire_api: tools.modelProvider.wireApi,
        requires_openai_auth: tools.modelProvider.requiresOpenAiAuth,
        supports_standalone_web_search: tools.modelProvider.supportsStandaloneWebSearch,
        request_max_retries: input.requestMaxRetries,
        stream_max_retries: input.streamMaxRetries,
      },
    },
  }
}

export function issueAssistantRuntimeAccess(scope: RuntimeSessionScope): AssistantRuntimeAccess {
  const issued = issueWaoRuntimeToken({
    scope: {
      userId: scope.userId,
      projectId: scope.projectId,
      assistantId: 'workspace-command',
    },
    ttlSeconds: WAO_RUNTIME_TOKEN_MAX_TTL_SECONDS,
  })
  return {
    environment: Object.freeze({
      [CODEX_RUNTIME_BEARER_ENV_KEY]: issued.token,
    }),
    bearerToken: issued.token,
    ownerToken: issued.payload.nonce,
    expiresAtMs: issued.payload.expiry * 1_000,
  }
}

export async function resolveAssistantRuntimeModelConfiguration(
  input: {
    readonly scope: RuntimeSessionScope
    readonly access: AssistantRuntimeAccess
  },
): Promise<AssistantRuntimeModelConfiguration> {
  const waoBaseUrl = requireAbsoluteHttpUrl(
    process.env.CODEX_RUNTIME_WAO_BASE_URL,
    'ASSISTANT_RUNTIME_WAO_BASE_URL_REQUIRED',
  )
  const [gateway, projectProductionContext] = await Promise.all([
    resolveCodexModelGatewayRuntimeConfig({
      scope: {
        ...input.scope,
        assistantId: 'workspace-command',
      },
      runtimeReachableWaoBaseUrl: waoBaseUrl,
      runtimeBearerToken: input.access.bearerToken,
    }),
    readProjectProductionContext(input.scope),
  ])
  const sandbox = runtimeSandboxMode()
  const reasoningEffort = await resolveReasoningEffort({
    userId: input.scope.userId,
    modelKey: gateway.modelKey,
    purpose: 'assistant',
  })
  const config = runtimeConfig({
    mcpUrl: `${waoBaseUrl}${MCP_PATH}?productionVersion=${projectProductionContext.version}`,
    modelGatewayUrl: gateway.baseUrl,
    modelProviderId: gateway.modelProviderId,
    bearerTokenEnvironmentKey: gateway.bearerTokenEnvironmentKey,
    requestMaxRetries: gateway.requestMaxRetries,
    streamMaxRetries: gateway.streamMaxRetries,
  })
  const threadContract = ASSISTANT_RUNTIME_STATIC_CONTRACT.thread
  const start = {
    model: gateway.runtimeModelId,
    modelProvider: gateway.modelProviderId,
    approvalPolicy: threadContract.approvalPolicy,
    sandbox,
    config,
    serviceName: threadContract.serviceName,
    baseInstructions: ASSISTANT_RUNTIME_BASE_INSTRUCTIONS,
    developerInstructions: ASSISTANT_RUNTIME_DEVELOPER_INSTRUCTIONS,
    personality: threadContract.personality,
    ephemeral: threadContract.ephemeral,
  }
  return {
    modelKey: gateway.modelKey,
    runtimeModel: gateway.runtimeModelId,
    reasoningEffort,
    projectProductionContext,
    thread: {
      start,
      resume: {
        model: gateway.runtimeModelId,
        modelProvider: gateway.modelProviderId,
        approvalPolicy: threadContract.approvalPolicy,
        sandbox,
        config,
        baseInstructions: ASSISTANT_RUNTIME_BASE_INSTRUCTIONS,
        developerInstructions: ASSISTANT_RUNTIME_DEVELOPER_INSTRUCTIONS,
        personality: threadContract.personality,
      },
    },
  }
}

export function buildAssistantRuntimeTurnContext(
  locale: string,
  projectProductionContext: ProjectProductionContext,
  canvasGenerationIntent?: CanvasGenerationIntent,
): string {
  const normalized = locale.trim()
  if (!normalized || normalized.length > 64) {
    throw new Error('ASSISTANT_RUNTIME_LOCALE_INVALID')
  }
  return [
    '<wao_turn_context>',
    `locale: ${JSON.stringify(normalized)}`,
    'Write every user-visible response, progress update, plan explanation, and reasoning summary in this locale unless the user explicitly requests another language.',
    'Use this same working language for every user-visible project folder, document, and Resource name unless the user explicitly requests another language.',
    '<wao_project_production_context>',
    formatProjectProductionContext(projectProductionContext),
    '</wao_project_production_context>',
    'Wao business tools are direct-only MCP tools in mcp__wao. Use their current direct Schema outside functions.exec; exec ALL_TOOLS does not index them. An empty ALL_TOOLS search is not evidence of a missing Wao generator. Check the current direct declarations and unavailableProductionTools; never use a paid submission as a tool-discovery probe.',
    'Use the currently available production tools. Their model branches declare model keys, capabilities and allowed parameters in user preference order. Prefer earlier models unless the task needs a later model’s capability or cost profile, and briefly explain that choice. Fill all exposed parameters; fixed parameters are applied by the server and are not input fields. Never invent a model or fallback outside those branches.',
    ...(canvasGenerationIntent ? [
      '<canvas_generation_intent>',
      JSON.stringify(canvasGenerationIntent),
      'These explicit user selections are enforced for this Turn. Produce one ordinary image or video, count 1, preserving destination, ordered references, duration and every selected parameter. For image use assetKind null and a non-asset image schema even if the subject is a character. Author the final prompt without changing these selections. This constraint does not extend to future turns.',
      '</canvas_generation_intent>',
    ] : []),
    '</wao_turn_context>',
  ].join('\n')
}
