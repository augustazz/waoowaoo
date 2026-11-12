import assert from 'node:assert/strict'
import { createServer } from 'node:http'
import { once } from 'node:events'
import { mkdtemp, mkdir, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js'
import { createWaoMcpServer } from '@/lib/wao-mcp/server'
import { createWaoMcpToolRegistry } from '@/lib/wao-mcp/tool-registry'
import { ensureAiCatalogsRegistered } from '@/lib/ai-exec/catalog-bootstrap'
import { listBuiltinCapabilityCatalog } from '@/lib/ai-registry/capabilities-catalog'
import { projectProductionCapabilities, type ProjectProductionContext } from '@/lib/project-production-context'
import { RuntimeSessionManager, type RuntimeSessionThreadConfiguration } from '@/lib/codex-runtime/runtime-session-manager'
import { LocalProcessRuntimeContainerAdapter } from '@/lib/codex-runtime/local-process-runtime-container'
import { PRODUCTION_CODEX_INITIALIZE_CAPABILITIES } from '@/lib/codex-runtime/runtime-config'
import { ASSISTANT_RUNTIME_CODEX_VERSION, ASSISTANT_RUNTIME_STATIC_CONTRACT } from '@/lib/assistant-runtime/runtime-access'
import { execFileSync } from 'node:child_process'

async function main() {
  assert.match(execFileSync('codex', ['--version'], { encoding: 'utf8' }), new RegExp(ASSISTANT_RUNTIME_CODEX_VERSION.replaceAll('.', '\\.')))
  ensureAiCatalogsRegistered()
  const entry = listBuiltinCapabilityCatalog().find((row) => row.modelType === 'video' && row.capabilities?.video?.resolutionOptions?.length)
  assert(entry)
  const model = `${entry.provider}::${entry.modelId}`
  const capabilities = projectProductionCapabilities({ videoRatio: '16:9', models: [{ ...entry, type: entry.modelType, modelKey: model, name: entry.modelId, price: 0 }] })
  let context: ProjectProductionContext = {
    schemaVersion: 8, version: 'unfixed', fixedParameters: {}, productionCapabilities: capabilities,
    project: { projectId: 'probe', name: 'Probe', description: null, videoRatio: '16:9', videoResolution: '1080p', imageResolution: '2K' },
  }
  const transports: StreamableHTTPServerTransport[] = []
  const captures: unknown[] = []
  let discoveries = 0
  const http = createServer(async (request, response) => {
    try {
      if (request.url === '/responses') {
        let body = ''
        for await (const chunk of request) body += String(chunk)
        captures.push(JSON.parse(body))
        response.writeHead(400, { 'content-type': 'application/json' })
        response.end(JSON.stringify({ error: { message: 'Intentional offline probe termination', type: 'invalid_request_error' } }))
        return
      }
      if (request.url?.startsWith('/mcp')) {
        const sessionId = request.headers['mcp-session-id']
        let transport = transports.find((candidate) => candidate.sessionId === sessionId)
        if (!transport) {
          discoveries++
          transport = new StreamableHTTPServerTransport({ sessionIdGenerator: () => `probe-${discoveries}` })
          transports.push(transport)
          await createWaoMcpServer({
            productionContext: context,
            contextResolver: { resolve: async () => null },
            executor: { execute: async () => { throw new Error('No operation may execute in protocol probe') } },
          }).connect(transport)
        }
        await transport.handleRequest(request, response)
        return
      }
      response.writeHead(404).end()
    } catch (error) { response.writeHead(500).end(String(error)) }
  })
  http.listen(0, '127.0.0.1')
  await once(http, 'listening')
  const address = http.address()
  assert(address && typeof address !== 'string')
  const base = `http://127.0.0.1:${address.port}`
  const root = await mkdtemp(path.join(tmpdir(), 'wao-fixed-runtime-probe-'))
  const nativeHome = path.join(root, 'native-home')
  await mkdir(nativeHome)
  const scope = { userId: 'probe', projectId: 'probe' }
  const manager = new RuntimeSessionManager({
    container: new LocalProcessRuntimeContainerAdapter({
      clientInfo: { name: 'wao-fixed-probe', title: 'Fixed parameter protocol probe', version: '1' },
      initializeCapabilities: PRODUCTION_CODEX_INITIALIZE_CAPABILITIES,
    }),
    persistence: {
      reconcileBeforeStart: async () => {},
      materialize: async () => ({ hostWorkspaceDirectory: await mkdtemp(path.join(root, 'scratch-')), hostCodexHomeDirectory: nativeHome }),
      destroyMaterialization: async (materialization) => { await rm(materialization.hostWorkspaceDirectory, { recursive: true }) },
      clearScope: async () => { throw new Error('Probe never clears native history') },
    },
    ownership: { acquire: async (_scope, ownerToken) => ({ ownerToken, lost: new Promise<void>(() => {}), assertCurrent: async () => {}, release: async () => {} }) },
    idleTimeoutMs: 60_000,
    waitForTurnSettlement: async () => {},
    onError: ({ error }) => { console.error(error) },
  })
  const configuration = (): RuntimeSessionThreadConfiguration => {
    const common = {
      model: 'gpt-5.6-sol', modelProvider: 'probe', approvalPolicy: 'never' as const, sandbox: 'read-only' as const,
      config: {
        web_search: 'disabled',
        features: {
          code_mode: { enabled: ASSISTANT_RUNTIME_STATIC_CONTRACT.tools.features.codeMode.enabled, direct_only_tool_namespaces: [...ASSISTANT_RUNTIME_STATIC_CONTRACT.tools.features.codeMode.directOnlyToolNamespaces] },
          code_mode_host: { enabled: ASSISTANT_RUNTIME_STATIC_CONTRACT.tools.features.codeModeHost.enabled, disable_in_process_fallback: ASSISTANT_RUNTIME_STATIC_CONTRACT.tools.features.codeModeHost.disableInProcessFallback },
        },
        mcp_servers: { wao: { url: `${base}/mcp?version=${context.version}`, required: true } },
        model_providers: { probe: { name: 'Offline probe', base_url: base, env_key: 'WAO_MCP_PROBE_TOKEN', wire_api: 'responses', requires_openai_auth: false, request_max_retries: 0, stream_max_retries: 0 } },
      },
    }
    return { start: { ...common, ephemeral: false }, resume: common }
  }
  async function probe(marker: string) {
    let unsubscribe = () => {}
    const completion = new Promise<void>((resolve, reject) => {
      const timeout = setTimeout(() => { unsubscribe(); reject(new Error('Probe timeout')) }, 30_000)
      unsubscribe = manager.subscribe(scope, (event) => {
        if (event.type === 'runtime' && event.event.type === 'notification' && event.event.method === 'turn/completed') {
          clearTimeout(timeout); unsubscribe(); resolve()
        }
      })
    })
    await manager.startTurn(scope, 'product-probe', { input: [{ type: 'text', text: marker }], approvalPolicy: 'never' }, async () => {})
    await completion
    return captures.at(-1)
  }
  try {
    await manager.ensure(scope, { ownerToken: 'probe', environment: { WAO_MCP_PROBE_TOKEN: 'not-a-provider-key' } })
    const initial = await manager.ensureThread(scope, { productThreadId: 'product-probe', runtimeThreadId: null, configuration: configuration() })
    const firstCapture = await probe('FIRST_NATIVE_HISTORY_MARKER')
    const assertMergeDeclaration = (capture: unknown) => {
      function find(value: unknown): Record<string, unknown> | null {
        if (Array.isArray(value)) return value.map(find).find(Boolean) ?? null
        if (!value || typeof value !== 'object') return null
        const record = value as Record<string, unknown>
        if (record.name === 'merge_videos' && record.parameters) return record
        return Object.values(record).map(find).find(Boolean) ?? null
      }
      const declaration = find(capture)
      assert(declaration, 'Actual direct merge_videos declaration required')
      const parameters = declaration.parameters as { properties?: Record<string, unknown> }
      assert.deepEqual(Object.keys(parameters.properties ?? {}), ['request'], 'Actual merge parameters must never be empty')
      const marker = 'Canonical input JSON Schema (complete; use it if the runtime projection omits nested fields):\n'
      const description = String(declaration.description ?? '')
      assert(description.includes(marker), 'All assembly branches must survive the runtime array projection')
      const canonical = JSON.parse(description.slice(description.indexOf(marker) + marker.length))
      assert.deepEqual(canonical, createWaoMcpToolRegistry(context).find((tool) => tool.name === 'merge_videos')!.tool.inputSchema)
      for (const field of ['new', 'retry', 'revise_failed', 'videos', 'resourceId', 'cover', 'videoIndex', 'offsetSeconds']) assert(JSON.stringify(canonical).includes(`"${field}"`))
    }
    assertMergeDeclaration(firstCapture)
    const metadata = (firstCapture as { client_metadata: Record<string, string> }).client_metadata
    const routing = JSON.parse(metadata['x-codex-turn-metadata']) as { code_mode_tool_names: Record<string, unknown> }
    assert(!Object.keys(routing.code_mode_tool_names).some((name) => name.includes('mcp__wao')), 'Direct-only Wao tools must stay outside the exec index')
    const firstCanonicalSchema = createWaoMcpToolRegistry(context).find((tool) => tool.name === 'create_video')!.tool.inputSchema
    const before = JSON.stringify(firstCapture)
    assert(before.includes('create_video'))
    assert(before.includes('resolution'))
    context = { ...context, version: 'fixed', fixedParameters: { [model]: Object.fromEntries(capabilities.video.models[0].parameters.map(({ field, options }) => [field, options[0]])) } }
    await manager.refreshConfiguration(scope, configuration())
    const resumed = await manager.ensureThread(scope, { productThreadId: 'product-probe', runtimeThreadId: initial.runtimeThreadId, configuration: configuration() })
    assert.equal(resumed.runtimeThreadId, initial.runtimeThreadId)
    const secondCapture = await probe('SECOND_NATIVE_HISTORY_MARKER')
    assertMergeDeclaration(secondCapture)
    const after = JSON.stringify(secondCapture)
    assert(after.includes('create_video'))
    const toolsOnly = (value: unknown): unknown => {
      assert(value !== null && typeof value === 'object' && !Array.isArray(value))
      const record = value as Record<string, unknown>
      function find(candidate: unknown): unknown {
        if (Array.isArray(candidate)) return candidate.map(find).find(Boolean)
        if (!candidate || typeof candidate !== 'object') return null
        const entry = candidate as Record<string, unknown>
        if (entry.name === 'create_video' && entry.parameters) {
          const marker = 'Canonical input JSON Schema (complete; use it if the runtime projection omits nested fields):\n'
          const description = typeof entry.description === 'string' ? entry.description : ''
          assert(description.includes(marker), 'The actual direct declaration must retain the complete canonical input contract')
          return JSON.parse(description.slice(description.indexOf(marker) + marker.length))
        }
        return Object.values(entry).map(find).find(Boolean)
      }
      const result = find(record.input)
      assert(result, 'Actual create_video schema required; metadata name mapping is not tool visibility')
      return result
    }
    const firstTools = JSON.stringify(toolsOnly(firstCapture))
    const secondTools = JSON.stringify(toolsOnly(secondCapture))
    assert.deepEqual(toolsOnly(firstCapture), firstCanonicalSchema)
    assert.deepEqual(toolsOnly(secondCapture), createWaoMcpToolRegistry(context).find((tool) => tool.name === 'create_video')!.tool.inputSchema)
    assert(firstTools.includes('resolution'))
    assert(!secondTools.includes('resolution'), 'Fixed field must be absent in the real second Responses tool payload')
    const native = await manager.readThread(scope, 'product-probe', true)
    assert(JSON.stringify(native.raw).includes('FIRST_NATIVE_HISTORY_MARKER'))
    assert(JSON.stringify(native.raw).includes('SECOND_NATIVE_HISTORY_MARKER'))
    assert(discoveries >= 2)
    console.log(JSON.stringify({ codex: ASSISTANT_RUNTIME_CODEX_VERSION, actualDiscoveryRefresh: true, directWaoToolsOutsideExecIndex: true, completeCanonicalSchemaInDirectDeclaration: true, mergeRequestBranchesPreserved: true, fixedFieldHiddenInResponses: true, nativeThreadAndHistoryPreserved: true, externalProviderCalls: 0 }))
  } finally {
    await manager.shutdownAll()
    await Promise.all(transports.map((transport) => transport.close()))
    http.closeAllConnections(); http.close()
    await rm(root, { recursive: true })
  }
}
main().catch((error) => { console.error(error); process.exitCode = 1 })
