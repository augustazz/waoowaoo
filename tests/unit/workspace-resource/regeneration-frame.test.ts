import { describe, expect, it } from 'vitest'
import { ASSET_IMAGE_FORMAT_POLICIES } from '@/lib/asset-generation'
import { imageGenerationItemSchema } from '@/lib/workspace-resource/generation-request'
import { applyWorkspaceResourceRegenerationEdits, readWorkspaceResourceRegenerationTemplate } from '@/lib/workspace-resource/regeneration'
import { projectWorkspaceResourceRegenerationAction } from '@/lib/workspace-resource/regeneration-projection'
import { WORKSPACE_RESOURCE_SCHEMA } from '@/lib/workspace-resource/schema-registry'
import { canvasGenerationFormIssues } from '@/features/project-workspace/canvas/create/canvas-generation-form'
import type { CanvasGenerationCapability } from '@/features/project-workspace/canvas/create/canvas-draft'
import { resolveGenerationAspectRatio, resolveGenerationAspectRatioOwner } from '@/lib/workspace-resource/generation-aspect-ratio'

const capability: CanvasGenerationCapability = {
  mediaType: 'image',
  view: {
    modelName: 'Image model', configurationVersion: 'current', fixedParameters: {},
    unavailableReason: null, maxReferenceImages: 4, aspectRatios: ['1:1', '4:3'], parameters: [],
  },
}

function actionFor(schemaId: string) {
  return projectWorkspaceResourceRegenerationAction({
    resourceId: 'source', workspacePath: '资产/原图', schemaId, mediaType: 'image', status: 'ready',
    prompt: 'Natural portrait', modelKey: 'configured-model', generationOptions: { aspectRatio: '4:3' },
    inputs: [], taskPayload: null,
  })!
}

describe('regeneration frame ownership', () => {
  it.each(Object.values(ASSET_IMAGE_FORMAT_POLICIES))('regenerates $kind images with the current project frame instead of the historical frame', (policy) => {
    const action = actionFor(policy.schemaId)
    const template = readWorkspaceResourceRegenerationTemplate(action.input)
    expect(template.aspectRatio).toBe('4:3')
    const edits = { ...template, name: '新版', aspectRatio: '1:1' }
    expect(canvasGenerationFormIssues(capability, { ...template, configurationVersion: 'current' })).toEqual([])
    const input = applyWorkspaceResourceRegenerationEdits(action.input, edits, 'current')
    const item = (input.request as { items: unknown[] }).items[0]
    const parsed = imageGenerationItemSchema.parse(item)
    expect(parsed.assetKind).toBe(policy.kind)
    expect(parsed.options?.aspectRatio).toBeUndefined()
    expect(resolveGenerationAspectRatio(parsed, '9:16')).toBe('9:16')
    expect(resolveGenerationAspectRatioOwner(parsed)).toBe('project')
    const inherited = imageGenerationItemSchema.parse({ ...parsed, options: {} })
    expect(resolveGenerationAspectRatio(inherited, '9:16')).toBe('9:16')
    expect(resolveGenerationAspectRatioOwner(inherited)).toBe('project')
    expect(resolveGenerationAspectRatio(inherited, '16:9')).toBe('16:9')
    expect(() => resolveGenerationAspectRatio(inherited, null)).toThrow('PROJECT_VIDEO_RATIO_SNAPSHOT_REQUIRED')
    // Neither a project change nor regeneration edits rewrite historical media.
    expect(readWorkspaceResourceRegenerationTemplate(action.input).aspectRatio).toBe('4:3')
  })

  it('blocks unsupported project frames without substituting another model frame', () => {
    const template = readWorkspaceResourceRegenerationTemplate(actionFor(WORKSPACE_RESOURCE_SCHEMA.CHARACTER_IMAGE).input)
    const unsupported = { ...capability, view: { ...capability.view, aspectRatios: ['1:1'] } }
    expect(canvasGenerationFormIssues(unsupported, { ...template, configurationVersion: 'current' }))
      .toEqual(['ASPECT_RATIO_REQUIRED'])
  })

  it('removes historical and edited frame overrides from ordinary image requests', () => {
    const action = actionFor(WORKSPACE_RESOURCE_SCHEMA.GENERIC_IMAGE)
    const template = readWorkspaceResourceRegenerationTemplate(action.input)
    expect(canvasGenerationFormIssues(capability, { ...template, aspectRatio: null, configurationVersion: 'current' }))
      .toEqual(['ASPECT_RATIO_REQUIRED'])
    const input = applyWorkspaceResourceRegenerationEdits(action.input, { ...template, name: '新版', aspectRatio: '1:1' }, 'current')
    expect(readWorkspaceResourceRegenerationTemplate(input).aspectRatio).toBeNull()
    expect(resolveGenerationAspectRatio(imageGenerationItemSchema.parse((input.request as {items:unknown[]}).items[0]), '9:16')).toBe('9:16')
  })

  it('prevents stale frame parameters and legacy requests from bypassing the project frame', () => {
    const action = actionFor(WORKSPACE_RESOURCE_SCHEMA.CHARACTER_IMAGE)
    const template = readWorkspaceResourceRegenerationTemplate(action.input)
    const input = applyWorkspaceResourceRegenerationEdits(action.input, { ...template, name: '新版', aspectRatio: '1:1', parameters: {aspectRatio:'4:3'} }, 'current')
    const parsed = imageGenerationItemSchema.parse((input.request as { items: unknown[] }).items[0])
    expect(parsed.options?.aspectRatio).toBeUndefined()
    expect(resolveGenerationAspectRatio(parsed, '9:16')).toBe('9:16')
    const legacy = imageGenerationItemSchema.parse({...parsed,options:{aspectRatio:'4:3'}})
    expect(resolveGenerationAspectRatio(legacy, '9:16')).toBe('9:16')
    expect(resolveGenerationAspectRatioOwner(legacy)).toBe('project')
    expect(() => resolveGenerationAspectRatio(legacy, null)).toThrow('PROJECT_VIDEO_RATIO_SNAPSHOT_REQUIRED')
  })

  it('does not require a frame for a model with no frame parameter', () => {
    const noFrame = { ...capability, view: { ...capability.view, aspectRatios: [] } }
    const input = { configurationVersion: 'current', aspectRatio: null, durationSeconds: null, parameters: {}, references: [] }
    expect(canvasGenerationFormIssues(noFrame, input)).toEqual([])
  })

  it('applies the same frame inheritance to videos and leaves audio unframed', () => {
    expect(resolveGenerationAspectRatio({ mediaType: 'video' }, '9:16')).toBe('9:16')
    expect(resolveGenerationAspectRatio({ mediaType: 'video', options: { aspectRatio: '16:9' } }, '9:16')).toBe('9:16')
    expect(resolveGenerationAspectRatio({ mediaType: 'audio' }, '9:16')).toBeNull()
  })
})
