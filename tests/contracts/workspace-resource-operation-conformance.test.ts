import { describe, expect, it } from 'vitest'
import { createProjectAgentOperationRegistryForApi } from '@/lib/operations/registry'
import { OPERATION_EXECUTION_MAX_TASKS } from '@/lib/temporal/operation-execution/contracts'
import { parseWorkspaceResourceGenerationTaskPayload } from '@/lib/workspace-resource/generation-contract'
import {
  assetGenerationBatchOutputSchema,
  videoGenerationBatchSchema,
} from '@/lib/workspace-resource/generation-request'
import {
  requireWorkspaceResourceSchema,
  WORKSPACE_RESOURCE_SCHEMA,
} from '@/lib/workspace-resource/schema-registry'
import { defaultProductionFolderPathForSchemaId } from '@/lib/workspace-resource/production-stages'

describe('WorkspaceResource Operation registry conformance', () => {
  it('aligns every declared producer with the canonical Resource schema registry', () => {
    const registry = createProjectAgentOperationRegistryForApi()
    for (const [operationId, operation] of Object.entries(registry)) {
      if (operation.confirmation.kind === 'billable_media') {
        expect(operation.plan, operationId).toBeTypeOf('function')
        expect(operation.commit, operationId).toBeTypeOf('function')
      }
      if (operation.resourceContract.kind !== 'resource') continue
      expect(operation.resourceContract.placement, operationId).toBe('required')
      for (const schemaId of operation.resourceContract.outputSchemaIds) {
        const schema = requireWorkspaceResourceSchema(schemaId)
        expect(operation.resourceContract.outputResourceKinds, operationId).toContain(schema.resourceKind)
        if (schema.mediaType !== null) {
          expect(operation.resourceContract.outputMediaTypes, operationId).toContain(schema.mediaType)
        }
      }
    }
  })

  it('produces the final-cut schema and defaults it to the final step folder', () => {
    const merge = createProjectAgentOperationRegistryForApi().merge_videos
    if (!merge) throw new Error('merge_videos missing')
    if (merge.resourceContract.kind !== 'resource') throw new Error('merge_videos has no resource contract')
    expect(merge.resourceContract.outputSchemaIds).toEqual([
      WORKSPACE_RESOURCE_SCHEMA.COMPOSITE_VIDEO,
    ])
    expect(defaultProductionFolderPathForSchemaId(WORKSPACE_RESOURCE_SCHEMA.COMPOSITE_VIDEO))
      .toBe('成片')
  })

  it('publishes every media generator directly to MCP and exposes no manifest operation', () => {
    const registry = createProjectAgentOperationRegistryForApi()
    expect(registry.submit_production_manifest).toBeUndefined()
    for (const operationId of ['create_image', 'create_audio', 'create_video', 'generate_voice']) {
      const operation = registry[operationId]
      if (!operation) throw new Error(`Required media operation missing: ${operationId}`)
      expect(operation.channels, operationId).toEqual({ tool: true, api: true, mcp: true })
      expect(operation.confirmation).toMatchObject({ kind: 'billable_media', required: true })
      const published = JSON.stringify(operation.toolInputSchema)
      expect(published, operationId).toContain('folderPath')
      expect(published, operationId).not.toContain('parentFolderId')
      expect(published, operationId).not.toContain('outputPath')
      expect(published, operationId).not.toContain('modelKey')
      expect(published, operationId).not.toContain('"position"')
      if (operationId === 'create_image') expect(published).not.toContain('project.style')
      expect(published, operationId).not.toContain('generationOptions')
      if (operationId === 'create_image' || operationId === 'create_video') {
        // The frame ratio is an optional per-item option (WR-16); the project
        // frame stays server-owned and never appears as a top-level field.
        expect(published, operationId).toContain('"aspectRatio"')
        expect(published, operationId).not.toContain('videoRatio')
        expect(published, operationId).not.toContain('projectVideoRatio')
      }
    }
    const saveDocument = registry.save_project_document
    if (!saveDocument) throw new Error('save_project_document missing')
    expect(JSON.stringify(saveDocument.toolInputSchema)).not.toContain('"position"')
    const getResource = registry.get_resource
    if (!getResource) throw new Error('Required Resource read operation missing')
    const getResourceInput = JSON.stringify(getResource.toolInputSchema)
    expect(getResourceInput).toContain('path')
    expect(getResourceInput).not.toContain('resourceId')
    const pathFieldByOperation = {
      create_folder: 'path',
      move_resource: 'sourcePath',
      delete_resource: 'path',
    } as const
    for (const [operationId, pathField] of Object.entries(pathFieldByOperation)) {
      const operation = registry[operationId]
      if (!operation) throw new Error(`Required path operation missing: ${operationId}`)
      expect(operation.channels, operationId).toEqual({ tool: true, api: true, mcp: true })
      const toolInput = JSON.stringify(operation.toolInputSchema)
      expect(toolInput, operationId).toContain(`\"${pathField}\"`)
      expect(toolInput, operationId).not.toContain('parentFolderId')
      expect(toolInput, operationId).not.toContain('resourceId')
    }
    const deleteResource = registry.delete_resource
    if (!deleteResource) throw new Error('delete_resource missing')
    expect(deleteResource.inputSchema.safeParse({
      resourceId: 'resource_approved',
      workspacePath: '分集/第001集',
    }).success).toBe(true)
    expect(deleteResource.inputSchema.safeParse({ path: '分集/第001集' }).success).toBe(false)
  })

  it('revises an existing document in place without exposing path or placement', () => {
    const registry = createProjectAgentOperationRegistryForApi()
    const revise = registry.revise_project_document
    if (!revise) throw new Error('revise_project_document missing')
    expect(revise.channels).toEqual({ tool: true, api: true, mcp: true })
    expect(revise.confirmation).toMatchObject({ kind: 'none', required: false })
    expect(revise.resourceContract).toMatchObject({
      kind: 'resource',
      assistantPresentation: 'none',
      placement: 'required',
    })
    const toolInput = JSON.stringify(revise.toolInputSchema)
    expect(toolInput).toContain('resourceId')
    expect(toolInput).toContain('expectedContentVersion')
    expect(toolInput).not.toContain('workspacePath')
    expect(toolInput).not.toContain('outputPath')
    expect(toolInput).not.toContain('schemaId')
  })

  it('accepts independent video items and caps their expanded Task count', () => {
    const item = (index: number, count = 1) => ({
      itemId: `shot-${String(index)}`,
      name: `Shot ${String(index)}`,
      mediaType: 'video' as const,
      schemaId: 'project.video_segment' as const,
      prompt: `Generate shot ${String(index)}.`,
      durationSeconds: 15,
      count,
    })
    expect(videoGenerationBatchSchema.safeParse({
      kind: 'new',
      items: Array.from({ length: OPERATION_EXECUTION_MAX_TASKS }, (_, index) => item(index)),
    }).success).toBe(true)
    expect(videoGenerationBatchSchema.safeParse({
      kind: 'new',
      items: [item(0, 6), ...Array.from({ length: OPERATION_EXECUTION_MAX_TASKS - 5 }, (_, index) => item(index + 1))],
    }).success).toBe(false)
  })

  it('requires complete reusable-asset identity and allows an explicit frame override in options', () => {
    const batch = {
      schemaVersion: 2 as const,
      outputKind: 'asset_generation_batch' as const,
      batchId: 'assets-v1',
      decision: 'produce' as const,
      overview: 'One reusable character asset.',
      items: [{
        itemId: 'character-one',
        name: 'Character One',
        mediaType: 'image' as const,
        schemaId: 'project.character_image' as const,
        assetKind: 'character' as const,
        aliases: [],
        stableDescription: 'A stable visible character design.',
        consumedByShots: ['scene-1'],
        prompt: 'Complete final character asset prompt.',
        count: 1,
      }],
      assumptions: [],
      warnings: [],
    }
    expect(assetGenerationBatchOutputSchema.safeParse(batch).success).toBe(true)
    expect(assetGenerationBatchOutputSchema.safeParse({
      ...batch,
      items: [{ ...batch.items[0], options: { aspectRatio: '9:16' } }],
    }).success).toBe(true)
    expect(assetGenerationBatchOutputSchema.safeParse({
      ...batch,
      items: [{ ...batch.items[0], aspectRatio: '4:3' }],
    }).success).toBe(false)
  })

  it('rejects cross-modality schemas, internal reference positions, paths, and duplicate retry identities', () => {
    const registry = createProjectAgentOperationRegistryForApi()
    const image = registry.create_image
    const video = registry.create_video
    if (!image || !video) throw new Error('Required media operation missing')
    expect(image.inputSchema.safeParse({
      request: { kind: 'new', items: [{
        itemId: 'wrong', name: 'Wrong', mediaType: 'image', schemaId: 'project.video_segment', prompt: 'Wrong.',
      }] },
    }).success).toBe(false)
    expect(video.inputSchema.safeParse({
      request: { kind: 'new', items: [{
        itemId: 'shot', name: 'Shot', mediaType: 'video', schemaId: 'project.video_segment',
        prompt: 'A shot.', durationSeconds: 15,
        references: [
          { resourceId: 'res_a', contentVersion: 1, role: 'reference_image', position: 0, channel: 'image' },
        ],
      }] },
    }).success).toBe(false)
    expect(video.inputSchema.safeParse({
      request: { kind: 'new', items: [{
        itemId: 'shot', name: 'Shot', mediaType: 'video', schemaId: 'project.video_segment',
        prompt: 'A shot.', durationSeconds: 15, outputPath: 'forbidden',
      }] },
    }).success).toBe(false)
    expect(image.inputSchema.safeParse({ request: { kind: 'retry', resourceIds: ['res_a', 'res_a'] } }).success).toBe(false)
  })

  it('requires explicit video input roles and exposes reference video conditioning', () => {
    const video = createProjectAgentOperationRegistryForApi().create_video
    if (!video) throw new Error('create_video missing')
    const item = {
      itemId: 'shot',
      name: 'Shot',
      mediaType: 'video' as const,
      schemaId: 'project.video_segment' as const,
      prompt: 'A controlled movement reference.',
      durationSeconds: 6,
      count: 1,
    }
    expect(video.inputSchema.safeParse({
      request: {
        kind: 'new',
        items: [{
          ...item,
          references: [
            {
              resourceId: 'res_image',
              contentVersion: 1,
              role: 'reference_image',
              channel: 'image',
            },
            {
              resourceId: 'res_audio',
              contentVersion: 1,
              role: 'reference_audio',
              channel: 'audio',
            },
            {
              resourceId: 'res_video',
              contentVersion: 1,
              role: 'reference_video',
              channel: 'video',
            },
          ],
        }],
      },
    }).success).toBe(true)
    expect(video.inputSchema.safeParse({
      request: {
        kind: 'new',
        items: [{
          ...item,
          references: [{
            resourceId: 'res_image',
            contentVersion: 1,
            role: 'reference',
            channel: 'image',
          }],
        }],
      },
    }).success).toBe(false)
  })

  it('keeps the public 16-image reference boundary representable in the frozen Task envelope', () => {
    const references = Array.from({ length: 16 }, (_, index) => ({
      resourceId: `res_${String(index)}`,
      contentVersion: 1,
      role: 'reference',
      channel: 'image' as const,
    }))
    const image = createProjectAgentOperationRegistryForApi().create_image
    if (!image) throw new Error('create_image missing')
    expect(image.inputSchema.safeParse({ request: { kind: 'new', items: [{
      itemId: 'derived', name: 'Derived', mediaType: 'image', schemaId: 'generic.image',
      assetKind: null, prompt: 'Use every reference.', references,
    }] } }).success).toBe(true)
    expect(() => parseWorkspaceResourceGenerationTaskPayload({
      lifecycleProjection: { resources: [{ resourceId: 'res_output', mediaType: 'image', schemaId: 'generic.image', name: 'Derived' }] },
      protocol: 'workspace_resource_generation_v2',
      resource: {
        resourceId: 'res_output', workspacePath: 'Derived-res_output', mediaType: 'image', schemaId: 'generic.image',
        inputHash: 'a'.repeat(64), prompt: 'Use every reference.', modelKey: 'openrouter::openai/gpt-image-2',
        inputs: references.map((reference, position) => ({
          resourceId: reference.resourceId,
          contentVersion: reference.contentVersion,
          role: reference.role,
          position,
          workspacePath: `ref-${String(position)}`,
        })),
        imageInputPositions: references.map((_, position) => position), audioInputPositions: [], videoInputPositions: [],
        toolCallId: null, sourceTurnId: null,
      },
      imageModel: 'openrouter::openai/gpt-image-2', count: 1, generationOptions: {},
    })).not.toThrow()
  })
})
