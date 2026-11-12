import { describe, expect, it } from 'vitest'
import {
  buildWaoMcpUserDecisionElicitation,
  parseWaoMcpUserDecisionInput,
  projectWaoMcpUserDecisionResult,
  WaoMcpUserDecisionInputError,
} from '@/lib/wao-mcp/user-decision'

const options = [
  {
    id: 'save-her',
    label: '救林小满',
    description: '唯一目标是让她不用转学。',
  },
  {
    id: 'save-self',
    label: '救当年的自己',
    description: '他要修的是那个没敢开口的少年。',
  },
]

describe('Wao MCP user decision input', () => {
  it('accepts options as a native array', () => {
    const input = parseWaoMcpUserDecisionInput({
      header: '核心动机',
      question: '陈默回来，真正想救的是谁？',
      options,
    })
    expect(input.options).toEqual(options)
  })

  it('accepts options serialized as a JSON string by the runtime', () => {
    const input = parseWaoMcpUserDecisionInput({
      header: '核心动机',
      question: '陈默回来，真正想救的是谁？',
      options: JSON.stringify(options),
    })
    expect(input.options).toEqual(options)
  })

  it('accepts the whole arguments payload serialized as a JSON string', () => {
    const input = parseWaoMcpUserDecisionInput(JSON.stringify({
      header: '核心动机',
      question: '陈默回来，真正想救的是谁？',
      options,
    }))
    expect(input.options).toEqual(options)
  })

  it.each([false, true])('recovers sibling fields swallowed into an escaped options fragment (closing brace: %s)', (closingBrace) => {
    const fragment = `${JSON.stringify(options)}, "otherLabel": "我说", "question": "男主年龄按哪种？"${closingBrace ? '}' : ''}`
    const input = parseWaoMcpUserDecisionInput({
      header: '年龄设定',
      options: JSON.stringify(fragment).slice(1, -1),
    })
    expect(input).toEqual({
      header: '年龄设定',
      question: '男主年龄按哪种？',
      options,
      otherLabel: '我说',
    })
  })

  it('recovers the question while preserving a separate free-form label', () => {
    const fragment = `${JSON.stringify(options)}, "question": "首集用哪种画面语言？"`
    const input = parseWaoMcpUserDecisionInput({
      header: '画面风格',
      options: JSON.stringify(fragment).slice(1, -1),
      otherLabel: '自己描述',
    })
    expect(input.question).toBe('首集用哪种画面语言？')
    expect(input.otherLabel).toBe('自己描述')
    expect(input.options).toEqual(options)
  })

  it('rejects conflicting sibling fields instead of overwriting the question', () => {
    expect(() => parseWaoMcpUserDecisionInput({
      header: '年龄设定',
      question: '原来的问题？',
      options: `${JSON.stringify(options)}, "question": "不同的问题？"}`,
    })).toThrow('WAO_MCP_USER_DECISION_INPUT_INVALID')
  })

  it('requires the missing music question and accepts the repaired four-option card', () => {
    const musicOptions = [
      { id: 'two_cues_sparse', label: '两处单音，其余留白', description: '纸条展开时钢琴单音，合盖时一记鼓点。' },
      { id: 'one_arc_piano', label: '一段极简钢琴贯穿结尾', description: '钢琴与低频持续音延续到黑屏。' },
      { id: 'period_texture', label: '加入年代音色', description: '教室段落轻用口风琴与磁带底噪。' },
      { id: 'no_music', label: '不做配乐', description: '只保留对白、环境声与拟音。' },
    ]
    const escapedFragment = (sibling: string) => JSON.stringify(
      `${JSON.stringify(musicOptions)}, ${sibling}`,
    ).slice(1, -1)
    try {
      parseWaoMcpUserDecisionInput({
        header: '第一集配乐',
        options: escapedFragment('"otherLabel": "其他配乐想法"'),
      })
      expect.fail('A heading cannot replace the missing question')
    } catch (error) {
      expect(error).toBeInstanceOf(WaoMcpUserDecisionInputError)
      expect((error as WaoMcpUserDecisionInputError).details).toMatch(/^question:/u)
    }

    const repaired = parseWaoMcpUserDecisionInput({
      header: '第一集配乐',
      options: escapedFragment('"question": "第一集的配乐走哪个方向？"'),
      otherLabel: '其他配乐想法',
    })
    const elicitation = buildWaoMcpUserDecisionElicitation(repaired)
    expect(elicitation.message).toBe('第一集的配乐走哪个方向？')
    expect(repaired.options).toEqual(musicOptions)
    expect(repaired.otherLabel).toBe('其他配乐想法')
    expect(projectWaoMcpUserDecisionResult(repaired, {
      action: 'accept', content: { optionId: 'two_cues_sparse' },
    }).structuredContent).toMatchObject({
      ok: true,
      data: { outcome: 'selected', selection: { optionId: 'two_cues_sparse' } },
    })
  })

  it('rejects unknown fields inside a serialized fragment', () => {
    expect(() => parseWaoMcpUserDecisionInput({
      header: '年龄设定',
      options: `${JSON.stringify(options)}, "question": "男主年龄？", "unknown": true}`,
    })).toThrow('WAO_MCP_USER_DECISION_INPUT_INVALID')
  })

  it('rejects a decision without enough options', () => {
    expect(() => parseWaoMcpUserDecisionInput({
      header: '核心动机',
      question: '陈默回来，真正想救的是谁？',
      options: [options[0]],
    })).toThrow('WAO_MCP_USER_DECISION_INPUT_INVALID')
  })

  it('projects a selected option back to the model', () => {
    const input = parseWaoMcpUserDecisionInput({
      header: '核心动机',
      question: '陈默回来，真正想救的是谁？',
      options,
    })
    const elicitation = buildWaoMcpUserDecisionElicitation(input)
    expect(elicitation.requestedSchema.properties?.optionId).toBeTruthy()
    const result = projectWaoMcpUserDecisionResult(input, {
      action: 'accept',
      content: { optionId: 'save-her' },
    })
    expect(result.structuredContent).toMatchObject({
      ok: true,
      data: {
        outcome: 'selected',
        selection: { kind: 'option', optionId: 'save-her', label: '救林小满' },
      },
    })
  })
})
