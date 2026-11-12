import { describe, expect, it } from 'vitest'
import { WORKSPACE_CANVAS_CONFORMANCE_FIXTURES } from '@/features/project-workspace/canvas/conformance/workspace-canvas-conformance-fixtures'
import { WORKSPACE_CANVAS_NODE_RENDERERS } from '@/features/project-workspace/canvas/nodes/workspace-node-renderer-registry'
import {
  getWorkspaceCanvasNodePresentationProfile,
  resolveWorkspaceCanvasMediaShell,
  resolveWorkspaceCanvasNodeSize,
} from '@/features/project-workspace/canvas/node-presentation-profiles'
import { WORKSPACE_CANVAS_NODE_DEFINITIONS } from '@/features/project-workspace/canvas/registry/workspace-canvas-node-registry'
import { WORKSPACE_RESOURCE_MEDIA_TYPES } from '@/lib/workspace-resource/contracts'
import { WORKSPACE_RESOURCE_SCHEMA } from '@/lib/workspace-resource/schema-registry'

describe('workspace Canvas node registry conformance', () => {
  it('gives every production node kind exactly one renderer and conformance fixture', () => {
    const registeredKinds = Object.keys(WORKSPACE_CANVAS_NODE_DEFINITIONS).sort()
    expect(Object.keys(WORKSPACE_CANVAS_NODE_RENDERERS).sort()).toEqual(registeredKinds)
    expect(Object.keys(WORKSPACE_CANVAS_CONFORMANCE_FIXTURES).sort()).toEqual(registeredKinds)

    for (const kind of registeredKinds) {
      const typedKind = kind as keyof typeof WORKSPACE_CANVAS_NODE_DEFINITIONS
      const definition = WORKSPACE_CANVAS_NODE_DEFINITIONS[typedKind]
      const fixture = WORKSPACE_CANVAS_CONFORMANCE_FIXTURES[typedKind]
      expect(definition.kind).toBe(typedKind)
      expect(definition.rendererKey).toBe(typedKind)
      expect(definition.conformanceFixture).toBe(typedKind)
      expect(fixture.kind).toBe(typedKind)
      if (fixture.taskTarget === null) {
        expect(definition.taskTargetType).toBeNull()
        expect(definition.taskTypes).toEqual([])
      } else {
        expect(definition.taskTargetType).toBe(fixture.taskTarget.targetType)
        expect(definition.taskTypes).toContain(fixture.taskTarget.taskType)
      }
    }
  })

  it('declares a media presentation for every WorkspaceResource media type', () => {
    const profile = getWorkspaceCanvasNodePresentationProfile('resourceCard')
    expect(Object.keys(profile.media).sort()).toEqual([...WORKSPACE_RESOURCE_MEDIA_TYPES].sort())

    const schemaByMedia = {
      text: WORKSPACE_RESOURCE_SCHEMA.GENERIC_TEXT,
      image: WORKSPACE_RESOURCE_SCHEMA.GENERIC_IMAGE,
      audio: WORKSPACE_RESOURCE_SCHEMA.BGM_AUDIO,
      video: WORKSPACE_RESOURCE_SCHEMA.GENERIC_VIDEO,
    } as const
    for (const mediaType of WORKSPACE_RESOURCE_MEDIA_TYPES) {
      const shell = resolveWorkspaceCanvasMediaShell({
        kind: 'resourceCard',
        mediaType,
        schemaId: schemaByMedia[mediaType],
        projectAspectRatio: '16:9',
      })
      const size = resolveWorkspaceCanvasNodeSize({
        kind: 'resourceCard',
        mediaType,
        schemaId: schemaByMedia[mediaType],
        projectAspectRatio: '16:9',
      })
      expect(shell.width).toBeGreaterThan(0)
      expect(shell.height).toBeGreaterThan(0)
      expect(size.width).toBeGreaterThan(shell.width)
      expect(size.height).toBeGreaterThan(shell.height)
    }
  })

  it('preserves frozen media frames and otherwise uses the project frame before a legacy fallback', () => {
    const frozen = resolveWorkspaceCanvasMediaShell({
      kind: 'resourceCard',
      mediaType: 'image',
      schemaId: WORKSPACE_RESOURCE_SCHEMA.GENERIC_IMAGE,
      generationOptions: { aspectRatio: '1:1' },
      mediaWidth: 1600,
      mediaHeight: 900,
      projectAspectRatio: '9:16',
    })
    expect(frozen.width / frozen.height).toBeCloseTo(1, 1)

    const media = resolveWorkspaceCanvasMediaShell({
      kind: 'resourceCard',
      mediaType: 'image',
      schemaId: WORKSPACE_RESOURCE_SCHEMA.GENERIC_IMAGE,
      mediaWidth: 1600,
      mediaHeight: 900,
      projectAspectRatio: '9:16',
    })
    expect(media.width / media.height).toBeCloseTo(16 / 9, 1)

    const asset = resolveWorkspaceCanvasMediaShell({
      kind: 'resourceCard',
      mediaType: 'image',
      schemaId: WORKSPACE_RESOURCE_SCHEMA.CHARACTER_IMAGE,
      projectAspectRatio: '16:9',
    })
    expect(asset.width / asset.height).toBeCloseTo(16 / 9, 1)
    expect(asset.fit).toBe('contain')

    const fallback = resolveWorkspaceCanvasMediaShell({
      kind: 'resourceCard',
      mediaType: 'video',
      schemaId: WORKSPACE_RESOURCE_SCHEMA.GENERIC_VIDEO,
      projectAspectRatio: null,
    })
    expect(fallback.width / fallback.height).toBeCloseTo(16 / 9, 1)
  })
})
