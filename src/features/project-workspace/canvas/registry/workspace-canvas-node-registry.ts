import type { AppIconName } from '@/components/ui/icons'
import { TASK_TYPE, type TaskType } from '@/lib/task/types'
import type { WorkspaceCanvasNodeKind } from '../node-canvas-types'
import type { WorkspaceCanvasNodeActionKey } from '../contracts/workspace-canvas-interactions'
import type { WorkspaceResourceMediaType } from '@/lib/workspace-resource/contracts'

interface WorkspaceCanvasNodeDefinition<K extends WorkspaceCanvasNodeKind = WorkspaceCanvasNodeKind> {
  readonly kind: K
  readonly identityScope: 'resource' | 'folder'
  readonly taskTargetType: 'WorkspaceResource' | null
  readonly taskTypes: readonly TaskType[]
  readonly rendererKey: K
  readonly actionKeysByMediaType: Readonly<Record<
    WorkspaceResourceMediaType,
    readonly WorkspaceCanvasNodeActionKey[]
  >>
  /**
   * Card chrome declaration. Domain identifiers (schemaId, resource IDs)
   * never appear as card copy (CN-05); category naming, when needed, must be
   * an i18n declaration here — never a raw registry/schema value.
   */
  readonly presentation: {
    readonly iconName: AppIconName
    readonly hasTargetHandle: boolean
    readonly hasSourceHandle: boolean
  }
  readonly conformanceFixture: K
}

export const WORKSPACE_CANVAS_NODE_DEFINITIONS = {
  resourceCard: {
    kind: 'resourceCard',
    identityScope: 'resource',
    taskTargetType: 'WorkspaceResource',
    taskTypes: [
      TASK_TYPE.WORKSPACE_RESOURCE_IMAGE,
      TASK_TYPE.WORKSPACE_RESOURCE_AUDIO,
      TASK_TYPE.WORKSPACE_RESOURCE_VOICE,
      TASK_TYPE.WORKSPACE_RESOURCE_VIDEO,
      TASK_TYPE.WORKSPACE_RESOURCE_VIDEO_MERGE,
    ],
    rendererKey: 'resourceCard',
    actionKeysByMediaType: {
      text: [
        'discuss', 'preview_alternatives', 'use_as_reference',
        'retry', 'toggle_workflow', 'delete',
      ],
      image: [
        'regenerate', 'animate', 'discuss', 'preview_alternatives', 'download', 'use_as_reference',
        'retry', 'toggle_workflow', 'delete',
      ],
      audio: [
        'discuss', 'preview_alternatives', 'download', 'use_as_reference',
        'retry', 'toggle_workflow', 'delete',
      ],
      video: [
        'regenerate', 'discuss', 'preview_alternatives', 'download', 'use_as_reference',
        'retry', 'toggle_workflow', 'delete',
      ],
    },
    presentation: {
      iconName: 'package',
      hasTargetHandle: true,
      hasSourceHandle: true,
    },
    conformanceFixture: 'resourceCard',
  },
  folder: {
    kind: 'folder',
    identityScope: 'folder',
    taskTargetType: null,
    taskTypes: [],
    rendererKey: 'folder',
    actionKeysByMediaType: {
      text: [],
      image: [],
      audio: [],
      video: [],
    },
    presentation: {
      iconName: 'folder',
      hasTargetHandle: false,
      hasSourceHandle: false,
    },
    conformanceFixture: 'folder',
  },
} as const satisfies Record<WorkspaceCanvasNodeKind, WorkspaceCanvasNodeDefinition>

export function getWorkspaceCanvasNodeDefinition<K extends WorkspaceCanvasNodeKind>(
  kind: K,
): (typeof WORKSPACE_CANVAS_NODE_DEFINITIONS)[K] {
  return WORKSPACE_CANVAS_NODE_DEFINITIONS[kind]
}
