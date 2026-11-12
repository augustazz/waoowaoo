import { describe, expect, it, vi } from 'vitest'
import { randomUUID } from 'node:crypto'
import { Client } from '@modelcontextprotocol/sdk/client/index.js'
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js'
import { WebStandardStreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/webStandardStreamableHttp.js'
import { ElicitRequestSchema, ElicitResultSchema } from '@modelcontextprotocol/sdk/types.js'
import { productionContextFixture } from '../../../scripts/lib/production-context-fixture'
import { createWaoMcpServer } from '@/lib/wao-mcp/server'
import type { RuntimeJsonValue } from '@/lib/codex-runtime/runtime-adapter'
import {
  readWaoMcpUserDecisionPresentation,
} from '@/lib/wao-mcp/user-decision'
import {
  buildAssistantRuntimeServerResponse,
  readAssistantRuntimeMcpElicitation,
  type AssistantRuntimePendingInteractionView,
} from '@/lib/assistant-runtime/view-contract'

const options = [
  { id: 'nian2017', label: '二十六岁', description: '现在改到二〇一七。' },
  { id: 'nian35', label: '三十五岁', description: '剧本完全不动。' },
  { id: 'nian2013', label: '〇〇后版', description: '初中改到二〇一三。' },
]
const input = { header: '年龄设定', question: '男主年龄按哪种？', options, otherLabel: '我说' }
// Exact encoding seen in the failed live chat: sibling fields and their quotes
// were swallowed into options, including the final argument object's brace.
const malformedInput = {
  header: input.header,
  options: JSON.stringify(`${JSON.stringify(options)}, "otherLabel": "我说", "question": "男主年龄按哪种？"}`).slice(1, -1),
}

async function withMcpClient(run: (client: Client) => Promise<void>): Promise<void> {
  const server = createWaoMcpServer({
    productionContext: productionContextFixture(),
    contextResolver: {
      resolve: async () => ({
        threadId: 'test-thread', turnId: 'test-turn', callId: 'test-call',
        requestId: 'test-request', executionOwnerId: 'test-owner',
        userId: 'test-user', projectId: 'test-project', source: 'test',
      }),
    },
    executor: { execute: async () => { throw new Error('Unexpected production operation') } },
  })
  const serverTransport = new WebStandardStreamableHTTPServerTransport({ sessionIdGenerator: randomUUID })
  const client = new Client(
    { name: 'decision-test', version: '1' },
    { capabilities: { elicitation: { form: {} } } },
  )
  const transport = new StreamableHTTPClientTransport(new URL('http://localhost/mcp'), {
    fetch: async (url, init) => await serverTransport.handleRequest(new Request(url, init)),
  })
  try {
    await server.connect(serverTransport)
    await client.connect(transport)
    await run(client)
  } finally {
    await Promise.allSettled([client.close(), server.close()])
  }
}

describe('Wao user decisions over MCP HTTP', () => {
  it.each([
    { name: 'native options', args: input, action: 'option' },
    { name: 'escaped fragment', args: malformedInput, action: 'option' },
    { name: 'free-form answer', args: malformedInput, action: 'other' },
    { name: 'cancellation', args: malformedInput, action: 'cancel' },
  ])('shows the card and waits for $name', async ({ args, action }) => {
    await withMcpClient(async (client) => {
      let showCard!: (interaction: AssistantRuntimePendingInteractionView) => void
      const card = new Promise<AssistantRuntimePendingInteractionView>((resolve) => { showCard = resolve })
      let answer!: (value: RuntimeJsonValue) => void
      client.setRequestHandler(ElicitRequestSchema, async (request) => {
        const response = new Promise<RuntimeJsonValue>((resolve) => { answer = resolve })
        showCard({
          kind: 'runtime_request', interactionId: 'test-interaction', turnId: 'test-turn',
          version: 1, runtimeRequestId: 'test-runtime-request', requestId: 'test-request',
          method: 'mcpServer/elicitation/request', params: JSON.parse(JSON.stringify(request.params)),
          response: null, status: 'pending', createdAt: '2026-11-09T14:07:50.000Z',
        })
        const result = await response
        if (!result || typeof result !== 'object' || Array.isArray(result)) {
          throw new Error('Unexpected runtime response')
        }
        // Codex's app-server protocol uses null for absent optional fields;
        // its MCP bridge omits them from the wire result.
        return ElicitResultSchema.parse({
          action: result.action,
          ...(result.content === null ? {} : { content: result.content }),
          ...(result._meta === null ? {} : { _meta: result._meta }),
        })
      })
      let settled = false
      const pending = client.callTool(
        { name: 'request_user_decision', arguments: args }, undefined, { timeout: 2_000 },
      ).finally(() => { settled = true })
      const interaction = await Promise.race([
        card,
        pending.then((result) => { throw new Error(`Decision ended before showing a card: ${JSON.stringify(result)}`) }),
      ])
      expect(settled).toBe(false)
      const elicitation = readAssistantRuntimeMcpElicitation(interaction)
      expect(elicitation.message).toBe(input.question)
      expect(readWaoMcpUserDecisionPresentation(elicitation)?.options).toEqual(
        options.map(({ id, description }) => ({ id, description })),
      )
      const result = action === 'cancel'
        ? { action: 'cancel', content: null, _meta: null }
        : {
            action: 'accept', _meta: null,
            content: action === 'other'
              ? { optionId: '__wao_other__', otherText: '保留26岁，另行调整时间线。' }
              : { optionId: 'nian2017' },
          }
      const response = buildAssistantRuntimeServerResponse({ interaction, result })
      if (!('result' in response)) throw new Error('Unexpected runtime error response')
      answer(response.result)
      const completed = await pending
      expect(completed.isError, JSON.stringify(completed)).toBeUndefined()
      expect(completed.structuredContent).toMatchObject({
        ok: true,
        data: action === 'cancel'
          ? { outcome: 'cancelled', action: 'cancel' }
          : {
              outcome: 'selected',
              selection: action === 'other'
                ? { kind: 'other', text: '保留26岁，另行调整时间线。' }
                : { kind: 'option', optionId: 'nian2017', label: '二十六岁' },
            },
      })
    })
  })

  it.each([
    { name: 'native array', options },
    { name: 'escaped fragment', options: JSON.stringify(`${JSON.stringify(options)}, "otherLabel": "我说"`).slice(1, -1) },
  ])('reports a missing question and allows a corrected retry ($name)', async ({ options: missingQuestionOptions }) => {
    await withMcpClient(async (client) => {
      const elicit = vi.fn(async () => ({
        action: 'accept' as const, content: { optionId: 'nian2017' },
      }))
      client.setRequestHandler(ElicitRequestSchema, elicit)
      const result = await client.callTool({
        name: 'request_user_decision', arguments: { header: input.header, options: missingQuestionOptions },
      })
      expect(elicit).not.toHaveBeenCalled()
      const retry = await client.callTool({
        name: 'request_user_decision', arguments: input,
      })
      expect(elicit).toHaveBeenCalledTimes(1)
      expect(retry.isError).toBeUndefined()
      expect(retry.structuredContent).toMatchObject({
        ok: true,
        data: { outcome: 'selected', selection: { optionId: 'nian2017' } },
      })
      expect(result.isError).toBe(true)
      expect(result.structuredContent).toMatchObject({
        ok: false,
        error: {
          code: 'WAO_MCP_USER_DECISION_INPUT_INVALID',
          message: expect.stringContaining('question:'),
        },
      })
    })
  })
})
