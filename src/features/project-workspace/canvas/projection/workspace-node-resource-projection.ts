import { vacantCanvasPosition, type CanvasRectangle } from '../layout/vacant-position'
import type {
  WorkspaceResourceAlternativeMemberView,
  WorkspaceResourceContent,
  WorkspaceResourceMediaType,
  WorkspaceResourceView,
} from '@/lib/workspace-resource/contracts'
import type {
  WorkspaceCanvasDeleteOperationView,
  WorkspaceCanvasResourceFileView,
  WorkspaceCanvasResourceSummaryView,
  WorkspaceResourceCardMemberView,
  WorkspaceResourceCardView,
} from '../contracts/workspace-canvas-interactions'
import {
  workspaceCanvasFailedResourcePresentation,
  workspaceCanvasPendingResourcePresentation,
  workspaceCanvasResourcePresentation,
  workspaceCanvasSucceededResourcePresentation,
} from '../lifecycle/workspace-canvas-resource-lifecycle'
import { workspaceNodeId } from '../workspace-canvas-node-ids'
import {
  resolveWorkspaceCanvasMediaShell,
  resolveWorkspaceCanvasNodeSize,
} from '../node-presentation-profiles'
import { getWorkspaceCanvasNodeDefinition } from '../registry/workspace-canvas-node-registry'
import {
  WORKSPACE_CANVAS_EXPANSION_BUDGET,
  buildWorkspaceCanvasFolderTree,
  computeCollapsedWorkspaceFolders,
  countWorkspaceFolderFiles,
  type WorkspaceCanvasFolderTreeNode,
} from './workspace-canvas-expansion-policy'
import type { WorkspaceNodeProjectionContext } from './workspace-node-projection-shared'
import { createEdge, createNode } from './workspace-node-projection-shared'

const ELEMENT_GAP_X = 64
const ELEMENT_GAP_Y = 96
const SECTION_PADDING_X = 16
const SECTION_HEADER_HEIGHT = 64
const SECTION_PADDING_BOTTOM = 8
const SECTION_MIN_CONTENT_WIDTH = 280
const TOP_LEVEL_ORIGIN_X = 260
const TOP_LEVEL_ORIGIN_Y = 180
const FOLDER_WIDTH = 320
const FOLDER_HEIGHT = 174
const RESOURCE_CARD_DEFINITION = getWorkspaceCanvasNodeDefinition('resourceCard')

function resourcePresentation(resource: WorkspaceResourceView) {
  if (resource.status === 'ready') return workspaceCanvasSucceededResourcePresentation()
  if (resource.status === 'failed') return workspaceCanvasFailedResourcePresentation()
  if (resource.status === 'canceled') return workspaceCanvasResourcePresentation('canceled')
  return workspaceCanvasPendingResourcePresentation()
}

function requireFileResource(resource: WorkspaceResourceView): WorkspaceCanvasResourceFileView {
  if (resource.resourceKind !== 'file' || resource.mediaType === null) {
    throw new Error(`WORKSPACE_CANVAS_FILE_RESOURCE_INVALID:${resource.resourceId}`)
  }
  return resource as WorkspaceCanvasResourceFileView
}

function structuredEntryCount(content: WorkspaceResourceContent): number | null {
  if (content.kind !== 'structured') return null
  if (Array.isArray(content.data)) return content.data.length
  if (content.data && typeof content.data === 'object') return Object.keys(content.data).length
  return null
}

function resourceSummary(resource: WorkspaceCanvasResourceFileView): WorkspaceCanvasResourceSummaryView {
  const content = resource.current?.content
  if (content?.kind === 'text') return { kind: 'text', text: content.text }
  if (content?.kind === 'structured') {
    return { kind: 'structured', entryCount: structuredEntryCount(content), preview: null }
  }
  if (content?.kind === 'media') {
    return {
      kind: 'media',
      mediaType: resource.mediaType,
      url: content.url,
      mimeType: content.mimeType,
      width: content.width,
      height: content.height,
      durationMs: content.durationMs,
    }
  }
  if (resource.summary.kind === 'text') {
    return resource.summary.preview ? { kind: 'text', text: resource.summary.preview } : { kind: 'empty' }
  }
  if (resource.summary.kind === 'structured') {
    return {
      kind: 'structured',
      entryCount: null,
      preview: resource.summary.preview,
    }
  }
  if (resource.summary.kind === 'media') {
    return {
      kind: 'media',
      mediaType: resource.mediaType,
      url: resource.summary.url,
      mimeType: resource.summary.mimeType,
      width: resource.summary.width,
      height: resource.summary.height,
      durationMs: resource.summary.durationMs,
    }
  }
  return { kind: 'empty' }
}

function memberName(member: WorkspaceResourceAlternativeMemberView): string {
  return member.name
}

function alternativeMember(
  member: WorkspaceResourceAlternativeMemberView,
  fallbackMediaType: WorkspaceResourceMediaType,
): WorkspaceResourceCardMemberView | null {
  const mediaType = member.mediaType ?? fallbackMediaType
  if (mediaType === 'text' && member.previewUrl === null) return null
  return {
    resource: {
      resourceId: member.resourceId,
      name: memberName(member),
      status: member.status,
      mediaType,
      schemaId: member.schemaId,
      error: null,
    },
    inputSummaries: [],
    download: member.previewUrl ? { href: member.previewUrl, fileName: memberName(member) } : null,
    presentation: {
      rendererKey: 'resourceCard',
      fallbackMediaType: mediaType,
      summary: member.previewUrl ? {
        kind: 'media',
        mediaType,
        url: member.previewUrl,
        mimeType: null,
        width: null,
        height: null,
        durationMs: null,
      } : { kind: 'empty' },
    },
  }
}

function deleteOperation(resource: WorkspaceResourceView): WorkspaceCanvasDeleteOperationView | null {
  const action = resource.actions.find((candidate) => candidate.kind === 'delete' && candidate.enabled)
  if (!action) return null
  if (
    action.operationId !== 'delete_resource'
    || action.input?.resourceId !== resource.resourceId
    || action.input.workspacePath !== resource.workspacePath
    || typeof action.approvalInputHash !== 'string'
    || !action.approvalInputHash
  ) {
    throw new Error(`WORKSPACE_CANVAS_DELETE_ACTION_INVALID:${resource.resourceId}`)
  }
  return {
    kind: 'delete',
    operationId: action.operationId,
    confirmation: 'destructive',
    input: {
      resourceId: resource.resourceId,
      workspacePath: resource.workspacePath,
    },
    approvalInputHash: action.approvalInputHash,
  }
}

export function projectWorkspaceResourceCard(resourceView: WorkspaceResourceView): WorkspaceResourceCardView {
  const resource = requireFileResource(resourceView)
  const download = resource.actions.find((action) => action.kind === 'download' && action.enabled && action.href)
  const billableOperations = resource.actions.flatMap((action) => {
    if (
      (action.kind !== 'retry' && action.kind !== 'regenerate')
      || !action.enabled
      || !action.operationId
      || !action.input
    ) return []
    return [{
      kind: action.kind,
      operationId: action.operationId,
      confirmation: 'billable_media' as const,
      input: action.input,
    }]
  })
  const projectedDeleteOperation = deleteOperation(resource)
  const primary: WorkspaceResourceCardMemberView = {
    resource,
    inputSummaries: resource.inputSummaries,
    download: download?.href ? { href: download.href, fileName: resource.name } : null,
    presentation: {
      rendererKey: 'resourceCard',
      fallbackMediaType: resource.mediaType,
      summary: resourceSummary(resource),
    },
  }
  const siblingMembers = resource.alternativeGroup?.members
    .filter((member) => member.resourceId !== resource.resourceId)
    .flatMap((member) => {
      const projected = alternativeMember(member, resource.mediaType)
      return projected ? [projected] : []
    }) ?? []
  const allAlternativeMembers = [primary, ...siblingMembers]
  const completeAlternativeGroup = resource.alternativeGroup
    && allAlternativeMembers.length === resource.alternativeGroup.total
  return {
    ...primary,
    resource,
    alternativeGroup: completeAlternativeGroup ? {
      groupId: resource.alternativeGroup.groupId,
      total: resource.alternativeGroup.total,
      members: allAlternativeMembers,
    } : null,
    canvasOperations: [
      ...billableOperations,
      ...(projectedDeleteOperation ? [projectedDeleteOperation] : []),
    ],
  }
}

function mediaDimensions(resource: WorkspaceCanvasResourceFileView) {
  const content = resource.current?.content
  if (content?.kind === 'media') {
    return { width: content.width, height: content.height }
  }
  return resource.summary.kind === 'media'
    ? { width: resource.summary.width, height: resource.summary.height }
    : { width: null, height: null }
}

interface ProjectionPoint {
  readonly x: number
  readonly y: number
}

interface ProjectionElement {
  readonly nodeId: string
  readonly width: number
  readonly height: number
  readonly emit: (position: ProjectionPoint, parentId: string | null) => void
}

/**
 * Row packing over variable-size elements, aiming for a slightly-wide block.
 * Used both for section interiors and as the top-level fallback layout when a
 * node has no persisted position.
 */
function packProjectionElements(elements: readonly ProjectionElement[]): {
  readonly width: number
  readonly height: number
  readonly positions: readonly ProjectionPoint[]
} {
  const totalArea = elements.reduce(
    (sum, el) => sum + (el.width + ELEMENT_GAP_X) * (el.height + ELEMENT_GAP_Y),
    0,
  )
  const maxElementWidth = elements.reduce((max, el) => Math.max(max, el.width), 0)
  const rowMaxWidth = Math.max(maxElementWidth, Math.sqrt(totalArea * 2.2))
  let x = 0
  let y = 0
  let rowHeight = 0
  let width = 0
  const positions: ProjectionPoint[] = []
  for (const el of elements) {
    if (x > 0 && x + el.width > rowMaxWidth) {
      x = 0
      y += rowHeight + ELEMENT_GAP_Y
      rowHeight = 0
    }
    positions.push({ x, y })
    x += el.width + ELEMENT_GAP_X
    rowHeight = Math.max(rowHeight, el.height)
    width = Math.max(width, x - ELEMENT_GAP_X)
  }
  return { width, height: y + rowHeight, positions }
}

export function appendWorkspaceResourceProjection(context: WorkspaceNodeProjectionContext): void {
  const { projectId, projectAspectRatio, workspaceResources, savedLayouts, translate, nodes, edges } = context
  if (workspaceResources.length === 0) return
  const nodeIdByResourceId = new Map<string, string>()
  const tree = buildWorkspaceCanvasFolderTree({
    currentFolderPath: context.currentFolderPath,
    resources: workspaceResources,
  })
  const collapsedFolders = computeCollapsedWorkspaceFolders(
    tree,
    WORKSPACE_CANVAS_EXPANSION_BUDGET,
    context.collapsedSeed,
  )

  const resourceElement = (resource: WorkspaceResourceView): ProjectionElement => {
    const card = projectWorkspaceResourceCard(resource)
    const nodeId = workspaceNodeId.resourceCard(resource.resourceId)
    const dimensions = mediaDimensions(card.resource)
    const presentationInput = {
      kind: 'resourceCard' as const,
      mediaType: card.resource.mediaType,
      schemaId: card.resource.schemaId,
      generationOptions: card.resource.generationOptions,
      mediaWidth: dimensions.width,
      mediaHeight: dimensions.height,
      projectAspectRatio,
    }
    const mediaShell = resolveWorkspaceCanvasMediaShell(presentationInput)
    const size = resolveWorkspaceCanvasNodeSize(presentationInput)
    return {
      nodeId,
      width: size.width,
      height: size.height,
      emit: (position, parentId) => {
        nodeIdByResourceId.set(resource.resourceId, nodeId)
        nodes.push(createNode({
          id: nodeId,
          position,
          width: size.width,
          height: size.height,
          parentId: parentId ?? undefined,
          data: {
            projectId,
            kind: 'resourceCard',
            layoutNodeType: 'resourceCard',
            targetType: 'workspaceResource',
            targetId: resource.resourceId,
            title: resource.name,
            eyebrow: translate('nodes.resourceCard.eyebrow', {
              type: translate(`nodes.resourceCard.mediaType.${card.resource.mediaType}`),
            }),
            mediaShell,
            ...resourcePresentation(resource),
            runtimeTargets: [{
              targetType: 'WorkspaceResource',
              targetId: resource.resourceId,
              types: RESOURCE_CARD_DEFINITION.taskTypes,
            }],
            resourceDetails: card,
          },
        }))
      },
    }
  }

  const folderData = (
    folderResource: WorkspaceResourceView,
    display: 'card' | 'section',
    childCount: number,
    titleLabel: string,
  ) => {
    const projectedDeleteOperation = deleteOperation(folderResource)
    if (!projectedDeleteOperation) {
      throw new Error(`WORKSPACE_CANVAS_FOLDER_DELETE_ACTION_REQUIRED:${folderResource.resourceId}`)
    }
    return {
      projectId,
      kind: 'folder' as const,
      layoutNodeType: 'folder' as const,
      targetType: 'folder' as const,
      targetId: folderResource.resourceId,
      title: titleLabel,
      eyebrow: translate('nodes.folder.eyebrow'),
      ...workspaceCanvasSucceededResourcePresentation(),
      runtimeTargets: [],
      folder: {
        resourceId: folderResource.resourceId,
        workspacePath: folderResource.workspacePath,
        display,
        childCount,
        deleteOperation: projectedDeleteOperation,
      },
    }
  }

  const folderCardElement = (
    treeNode: WorkspaceCanvasFolderTreeNode,
    folderResource: WorkspaceResourceView,
    titleLabel: string,
  ): ProjectionElement => {
    const nodeId = workspaceNodeId.folder(folderResource.resourceId)
    return {
      nodeId,
      width: FOLDER_WIDTH,
      height: FOLDER_HEIGHT,
      emit: (position, parentId) => {
        nodes.push(createNode({
          id: nodeId,
          position,
          width: FOLDER_WIDTH,
          height: FOLDER_HEIGHT,
          parentId: parentId ?? undefined,
          data: folderData(folderResource, 'card', countWorkspaceFolderFiles(treeNode), titleLabel),
        }))
      },
    }
  }

  /**
   * Flat section: frames never nest. A section holds only its folder's direct
   * files; deeper folders become their own top-level sections (or collapsed
   * cards), all labeled with their path relative to the current canvas.
   */
  const sectionElement = (
    treeNode: WorkspaceCanvasFolderTreeNode,
    folderResource: WorkspaceResourceView,
    titleLabel: string,
  ): ProjectionElement => {
    const nodeId = workspaceNodeId.folder(folderResource.resourceId)
    const inner = treeNode.resources.map(resourceElement)
    const packed = packProjectionElements(inner)
    const width = Math.max(packed.width, SECTION_MIN_CONTENT_WIDTH) + SECTION_PADDING_X * 2
    const height = packed.height + SECTION_HEADER_HEIGHT + SECTION_PADDING_BOTTOM
    return {
      nodeId,
      width,
      height,
      emit: (position, parentId) => {
        const sectionNode = createNode({
          id: nodeId,
          position,
          width,
          height,
          parentId: parentId ?? undefined,
          data: folderData(folderResource, 'section', treeNode.resources.length, titleLabel),
        })
        // The group has no visual frame: the node ignores pointer events so
        // blank space inside it still behaves as canvas; only the name pill
        // (pointer-events-auto in the renderer) drags and double-clicks.
        nodes.push({
          ...sectionNode,
          selectable: false,
          style: { ...sectionNode.style, pointerEvents: 'none' },
        })
        inner.forEach((el, index) => {
          const saved = savedLayouts.find((item) => item.nodeKey === el.nodeId)
          el.emit(saved ? { x: saved.x - position.x, y: saved.y - position.y } : {
            x: packed.positions[index].x + SECTION_PADDING_X,
            y: packed.positions[index].y + SECTION_HEADER_HEIGHT,
          }, nodeId)
        })
      },
    }
  }

  const topElements: ProjectionElement[] = tree.resources.map(resourceElement)
  const collectFlatElements = (treeNode: WorkspaceCanvasFolderTreeNode, trail: readonly string[]) => {
    for (const child of treeNode.folders) {
      const folderResource = child.folder
      if (!folderResource) continue
      // Folders without any descendant file stay off the canvas entirely:
      // the canvas shows content, not structure. The folder Resource still
      // exists and remains reachable through search.
      if (countWorkspaceFolderFiles(child) === 0) continue
      const childTrail = [...trail, folderResource.name]
      const titleLabel = childTrail.join(' / ')
      if (collapsedFolders.has(folderResource.resourceId)) {
        topElements.push(folderCardElement(child, folderResource, titleLabel))
        continue
      }
      if (child.resources.length > 0) {
        // Expanded groups show the folder name only; the relative path is
        // reserved for collapsed cards, where context would otherwise vanish.
        topElements.push(sectionElement(child, folderResource, folderResource.name))
      }
      collectFlatElements(child, childTrail)
    }
  }
  collectFlatElements(tree, [])
  const packedTop = packProjectionElements(topElements)
  const occupied: CanvasRectangle[] = topElements.flatMap((el) => {
    const saved = savedLayouts.find((item) => item.nodeKey === el.nodeId)
    return saved ? [{ x: saved.x, y: saved.y, width: el.width, height: el.height }] : []
  })
  topElements.forEach((el, index) => {
    const fallback = {
      x: TOP_LEVEL_ORIGIN_X + packedTop.positions[index].x,
      y: TOP_LEVEL_ORIGIN_Y + packedTop.positions[index].y,
    }
    const saved = savedLayouts.find((item) => item.nodeKey === el.nodeId)
    const position = saved ? { x: saved.x, y: saved.y } : vacantCanvasPosition({ ...fallback, width: el.width, height: el.height }, occupied)
    if (!saved) occupied.push({ ...position, width: el.width, height: el.height })
    el.emit(position, null)
  })

  const edgeIds = new Set(edges.map((edge) => edge.id))
  for (const resource of workspaceResources) {
    if (resource.resourceKind !== 'file') continue
    const targetNodeId = nodeIdByResourceId.get(resource.resourceId)
    if (!targetNodeId) continue
    for (const input of resource.inputs) {
      const sourceNodeId = nodeIdByResourceId.get(input.resourceId)
      if (!sourceNodeId || sourceNodeId === targetNodeId) continue
      const edgeId = `resource-lineage:${input.resourceId}:${targetNodeId}:${input.role}:${String(input.position)}`
      if (edgeIds.has(edgeId)) continue
      edgeIds.add(edgeId)
      edges.push(createEdge(edgeId, sourceNodeId, targetNodeId))
    }
  }
}
