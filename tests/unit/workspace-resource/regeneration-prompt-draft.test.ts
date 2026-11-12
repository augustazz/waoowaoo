import { describe, expect, it } from 'vitest'
import { projectWorkspaceResourceRegenerationAction, type WorkspaceResourceRegenerationSource } from '@/lib/workspace-resource/regeneration-projection'
import { readWorkspaceResourceRegenerationTemplate } from '@/lib/workspace-resource/regeneration'
import { WORKSPACE_RESOURCE_SCHEMA } from '@/lib/workspace-resource/schema-registry'

function source(): WorkspaceResourceRegenerationSource {
  return {
    resourceId: 'character-source',
    workspacePath: '资产/角色/陈默-15岁',
    mediaType: 'image',
    schemaId: WORKSPACE_RESOURCE_SCHEMA.CHARACTER_IMAGE,
    status: 'ready',
    currentVersion: 1,
    prompt: '2D 赛璐璐平涂动画风格',
    modelKey: 'configured-image-model',
    generationOptions: {
      aspectRatio: '4:3',
      regenerationDraft: {
        schemaVersion: 1,
        sourceContentVersion: 1,
        prompt: '真人摄影，自然肤色与放松的眼神',
      },
    },
    inputs: [],
    taskPayload: { resource: { prompt: '2D 赛璐璐平涂动画风格' } },
  }
}

describe('saved next-generation prompt', () => {
  it('projects the saved prompt without rewriting the original generation or leaking draft metadata', () => {
    const row = source()
    const before = structuredClone(row)
    const action = projectWorkspaceResourceRegenerationAction(row)!
    expect(readWorkspaceResourceRegenerationTemplate(action.input)).toMatchObject({
      prompt: '真人摄影，自然肤色与放松的眼神',
      aspectRatio: '4:3',
    })
    expect(JSON.stringify(action.input)).not.toContain('regenerationDraft')
    expect(row).toEqual(before)
  })

  it('does not carry a prompt draft to a different media version', () => {
    const row = { ...source(), currentVersion: 2, prompt: '当前版本的原始提示词' }
    const action = projectWorkspaceResourceRegenerationAction(row)!
    expect(readWorkspaceResourceRegenerationTemplate(action.input).prompt).toBe(row.prompt)
  })

  it.each([
    { schemaVersion: 1, sourceContentVersion: 1, prompt: '   ' },
    { schemaVersion: 2, sourceContentVersion: 1, prompt: '未知版本' },
    { schemaVersion: 1, sourceContentVersion: 1, prompt: 123 },
  ])('ignores unsupported or invalid draft metadata', (draft) => {
    const row = { ...source(), generationOptions: { regenerationDraft: draft } }
    const action = projectWorkspaceResourceRegenerationAction(row)!
    expect(readWorkspaceResourceRegenerationTemplate(action.input).prompt).toBe(row.prompt)
  })
})
