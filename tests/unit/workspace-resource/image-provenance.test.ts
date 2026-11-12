import { describe, expect, it } from 'vitest'
import { imageGenerationItemSchema } from '@/lib/workspace-resource/generation-request'
import { imageItemReferences, imageProvenance, readImageProvenance, recommendShotImageReferences } from '@/lib/workspace-resource/image-provenance'
import { workspaceResourceGenerationOptionsSchema } from '@/lib/workspace-resource/generation-contract'
import { projectWorkspaceResourceRegenerationAction } from '@/lib/workspace-resource/regeneration-projection'
import { readWorkspaceResourceRegenerationTemplate, applyWorkspaceResourceRegenerationEdits } from '@/lib/workspace-resource/regeneration'
import { projectOrderedReferenceInputs } from '@/lib/workspace-resource/reference-projection'

const identity = { resourceId: 'character', contentVersion: 2, role: 'z_identity', channel: 'image' as const, purpose: 'identity' as const }
const context = { resourceId: 'context-picture', contentVersion: 1, role: 'context', channel: 'context' as const }
const scene = { resourceId: 'scene', contentVersion: 3, role: 'a_scene', channel: 'image' as const, purpose: 'scene' as const }
const image = (value: object = {}) => imageGenerationItemSchema.parse({
  itemId: 'K02', name: 'K02', mediaType: 'image', schemaId: 'generic.image', prompt: '@图片1 identity; @图片2 scene', ...value,
})

describe('persistent image reference recipes', () => {
  it('automatically attaches an ordered recipe and pins direction/plan documents as context', () => {
    const item = image({ shotId: 'K02', referencePlan: { shotId: 'K02', references: [
      { ...identity, role: 'reference_image' }, { ...scene, role: 'reference_image' },
    ], direction: { resourceId: 'direction', contentVersion: 4 }, sourcePlan: { resourceId: 'storyboard', contentVersion: 2 } } })
    const references = imageItemReferences(item)
    expect(references.map((reference) => reference.resourceId)).toEqual(['character', 'scene', 'direction', 'storyboard'])
    expect(references.map((reference) => reference.channel)).toEqual(['image', 'image', 'context', 'context'])
    const metadata = imageProvenance(item, references)
    expect(readImageProvenance({ imageProvenance: JSON.parse(JSON.stringify(metadata)) })).toEqual(metadata)
    expect(metadata.references[0].contentVersion).toBe(2)
  })

  it('blocks conflicting recipes, duplicate images, shot mismatches and silently discarded references', () => {
    const recipe = { shotId: 'K02', references: [{ ...identity, role: 'reference_image' }] }
    expect(() => imageItemReferences(image({ references: [scene], referencePlan: recipe }))).toThrow()
    expect(() => imageItemReferences(image({ shotId: 'K03', referencePlan: recipe }))).toThrow()
    expect(() => imageItemReferences(image({ references: [identity, identity] }))).toThrow()
    expect(() => imageItemReferences(image({ references: [identity], referenceMode: 'text_only' }))).toThrow()
  })

  it('persists asset identity facts as JSON without optional undefined values and recommends only explicit shot bindings', () => {
    const asset = image({ schemaId: 'project.character_image', assetKind: 'character', aliases: ['小林'], stableDescription: '黑发，棕色眼睛，蓝外套，黑色鞋。', consumedByShots: ['K02'] })
    const provenance = imageProvenance(asset, [])
    const options = workspaceResourceGenerationOptionsSchema.parse({ imageProvenance: provenance })
    const candidates = recommendShotImageReferences('K02', [
      { resourceId: 'right-person', contentVersion: 2, generationOptions: options },
      { resourceId: 'same-name-but-unbound', contentVersion: 9, generationOptions: {} },
    ])
    expect(candidates).toEqual([{ resourceId: 'right-person', contentVersion: 2, role: 'reference_image', channel: 'image', purpose: 'identity', stableDescription: asset.stableDescription }])
    expect(recommendShotImageReferences('K03', [{ resourceId: 'right-person', contentVersion: 2, generationOptions: options }])).toEqual([])
    expect(() => workspaceResourceGenerationOptionsSchema.parse({ imageProvenance: imageProvenance(image({ schemaId: 'project.character_image', assetKind: 'character' }), []) })).not.toThrow()
  })

  it('regenerates mixed roles in the original order and restores context channels from frozen Task positions', () => {
    const references = [identity, context, scene]
    const options = { imageProvenance: imageProvenance(image({ shotId: 'K02', references }), references) }
    const frozenInputs = references.map(({ resourceId, contentVersion, role }, position) => ({ resourceId, contentVersion, role, position }))
    const action = projectWorkspaceResourceRegenerationAction({
      resourceId: 'frame', workspacePath: '分镜/K02', mediaType: 'image', schemaId: 'generic.image', status: 'ready',
      prompt: '@图片1 identity; @图片2 scene', modelKey: 'google::gemini-3-pro-image-preview', generationOptions: options,
      inputs: [2, 1, 0].map((index) => ({ ...frozenInputs[index], mediaType: 'image' })),
      taskPayload: { resource: { inputs: frozenInputs, imageInputPositions: [0, 2], audioInputPositions: [], videoInputPositions: [] } },
    })!
    const template = readWorkspaceResourceRegenerationTemplate(action.input)
    expect(template.references).toEqual(references)
    const edited = applyWorkspaceResourceRegenerationEdits(action.input, { ...template, name: 'K02新版', references: [context] }, 'current')
    const item = imageGenerationItemSchema.parse((edited.request as { items: unknown[] }).items[0])
    expect(imageItemReferences(item)).toEqual([context])
    expect(item.referenceMode).toBe('text_only')
    expect(item.shotId).toBe('K02')
  })

  it('restores purposes from frozen inputs when provenance metadata is unavailable', () => {
    const inputs = [{ ...identity, position: 0 }, { ...scene, position: 1 }]
    const projected = projectOrderedReferenceInputs(inputs.map(({ resourceId, contentVersion, role, channel, position }) => ({ resourceId, contentVersion, role, channel, position, mediaType: 'image' as const })), {
      resource: { inputs, imageInputPositions: [0, 1], audioInputPositions: [], videoInputPositions: [] },
    }, null)
    expect(projected.map(({ resourceId, purpose }) => ({ resourceId, purpose }))).toEqual([
      { resourceId: 'character', purpose: 'identity' }, { resourceId: 'scene', purpose: 'scene' },
    ])
  })
})
