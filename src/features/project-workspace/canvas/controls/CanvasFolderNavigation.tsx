'use client'

import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { useTranslations } from 'next-intl'
import { AppIcon } from '@/components/ui/icons'
import { useWorkspaceResources } from '@/lib/query/hooks'
import {
  isWorkspaceResourceSubtreePath,
  type WorkspaceResourceView,
} from '@/lib/workspace-resource/contracts'
import {
  productionStageFolderPaths,
  type ProductionStageKey,
  type ProductionStageView,
} from '@/lib/workspace-resource/production-stages'
import { useWorkspaceProvider } from '../../WorkspaceProvider'
import {
  buildWorkspaceCanvasFolderTree,
  countWorkspaceFolderFiles,
  type WorkspaceCanvasFolderTreeNode,
} from '../projection/workspace-canvas-expansion-policy'

const PANEL_BUTTON_CLASS =
  'inline-flex h-9 items-center justify-center rounded-full border border-white/80 bg-white/88 text-[var(--glass-text-secondary)] shadow-lg ring-1 ring-[var(--glass-stroke-base)]/70 backdrop-blur-2xl transition-colors hover:bg-white hover:text-[var(--glass-text-primary)]'

function DirectoryTreeRow({
  node,
  depth,
  folderDisplays,
  canvasSubtreePaths,
  countLabel,
  jumpTitle,
  enterTitle,
  fileLocateTitle,
  onRowActivate,
  onEnter,
  onFileActivate,
}: {
  readonly node: WorkspaceCanvasFolderTreeNode
  readonly depth: number
  readonly folderDisplays: ReadonlyMap<string, 'card' | 'section'>
  readonly canvasSubtreePaths: readonly string[]
  readonly countLabel: (count: number) => string
  readonly jumpTitle: string
  readonly enterTitle: string
  readonly fileLocateTitle: string
  readonly onRowActivate: (folder: WorkspaceResourceView) => void
  readonly onEnter: (folder: WorkspaceResourceView) => void
  readonly onFileActivate: (resource: WorkspaceResourceView) => void
}) {
  const [expanded, setExpanded] = useState(depth === 0)
  const folderResource = node.folder
  const childFolders = node.folders.filter((child) => child.folder !== null)
  if (!folderResource) return null
  const fileCount = countWorkspaceFolderFiles(node)
  const hasChildren = childFolders.length > 0 || node.resources.length > 0
  // 空文件夹可以显示,但没有任何激活动作:不跳转、不进入,点击无效。
  const inert = fileCount === 0
  const display = folderDisplays.get(folderResource.resourceId) ?? null
  // 可跳转 = 该文件夹子树与当前画布顶层节点有交集(中间目录也算,跳到后代分组
  // 的并集范围);展开内容无需"进入",收起卡与画布外的文件夹才提供进入。
  const jumpable = !inert && canvasSubtreePaths.some(
    (path) => isWorkspaceResourceSubtreePath(path, folderResource.workspacePath),
  )
  const canEnter = !inert && (display === 'card' || !jumpable)
  return (
    <div>
      <div
        className={`group flex w-full items-center gap-1 rounded-lg py-1.5 pr-1.5 text-xs text-[var(--glass-text-secondary)] ${
          inert ? 'cursor-default opacity-55' : 'cursor-pointer hover:bg-[var(--glass-selection-hover-bg)]'
        }`}
        style={{ paddingLeft: 4 + depth * 14 }}
        title={inert ? undefined : jumpable ? jumpTitle : enterTitle}
        onClick={inert ? undefined : () => onRowActivate(folderResource)}
      >
        <button
          type="button"
          className={`flex h-4 w-4 shrink-0 items-center justify-center rounded text-[var(--glass-text-tertiary)] hover:bg-[var(--glass-selection-hover-bg)] ${hasChildren ? '' : 'invisible'}`}
          onClick={(event) => {
            event.stopPropagation()
            setExpanded((value) => !value)
          }}
        >
          <AppIcon
            name="chevronRight"
            className={`h-3 w-3 transition-transform ${expanded ? 'rotate-90' : ''}`}
          />
        </button>
        <AppIcon name="folder" className="h-3.5 w-3.5 shrink-0 text-[var(--glass-tone-info-fg)]" />
        <span className="min-w-0 flex-1 truncate font-medium text-[var(--glass-text-primary)]">
          {folderResource.name}
        </span>
        <span className={`shrink-0 rounded-full px-1.5 text-[10px] ${inert ? 'bg-slate-100 text-[var(--glass-text-tertiary)]' : 'bg-[var(--glass-focus-ring)] text-[var(--glass-tone-info-fg)] group-hover:hidden'}`}>
          {countLabel(fileCount)}
        </span>
        <span className="hidden shrink-0 items-center gap-0.5 group-hover:flex">
          {jumpable ? (
            <span className="rounded-md p-1 text-[var(--glass-tone-info-fg)]" title={jumpTitle}>
              <AppIcon name="crosshair" className="h-3.5 w-3.5" />
            </span>
          ) : null}
          {canEnter ? (
            <button
              type="button"
              className="rounded-md p-1 text-[var(--glass-tone-info-fg)] hover:bg-[var(--glass-selection-hover-bg)]"
              title={enterTitle}
              onClick={(event) => {
                event.stopPropagation()
                onEnter(folderResource)
              }}
            >
              <AppIcon name="arrowRight" className="h-3.5 w-3.5" />
            </button>
          ) : null}
        </span>
      </div>
      {expanded
        ? (
            <>
              {childFolders.map((child) => (
                <DirectoryTreeRow
                  key={child.folder?.resourceId}
                  node={child}
                  depth={depth + 1}
                  folderDisplays={folderDisplays}
                  canvasSubtreePaths={canvasSubtreePaths}
                  countLabel={countLabel}
                  jumpTitle={jumpTitle}
                  enterTitle={enterTitle}
                  fileLocateTitle={fileLocateTitle}
                  onRowActivate={onRowActivate}
                  onEnter={onEnter}
                  onFileActivate={onFileActivate}
                />
              ))}
              {node.resources.map((resource) => (
                <DirectoryFileRow
                  key={resource.resourceId}
                  resource={resource}
                  depth={depth + 1}
                  locateTitle={fileLocateTitle}
                  onActivate={onFileActivate}
                />
              ))}
            </>
          )
        : null}
    </div>
  )
}

function resourceIconName(resource: WorkspaceResourceView): 'audioWave' | 'fileText' | 'image' | 'video' {
  if (resource.mediaType === 'image') return 'image'
  if (resource.mediaType === 'audio') return 'audioWave'
  if (resource.mediaType === 'video') return 'video'
  return 'fileText'
}

function DirectoryFileRow({
  resource,
  depth,
  locateTitle,
  onActivate,
}: {
  readonly resource: WorkspaceResourceView
  readonly depth: number
  readonly locateTitle: string
  readonly onActivate: (resource: WorkspaceResourceView) => void
}) {
  return (
    <button
      type="button"
      className="group flex w-full items-center gap-1 rounded-lg py-1.5 pr-1.5 text-left text-xs text-[var(--glass-text-secondary)] hover:bg-[var(--glass-selection-hover-bg)]"
      style={{ paddingLeft: 4 + depth * 14 }}
      title={locateTitle}
      onClick={() => onActivate(resource)}
    >
      <span className="h-4 w-4 shrink-0" aria-hidden="true" />
      <AppIcon
        name={resourceIconName(resource)}
        className="h-3.5 w-3.5 shrink-0 text-[var(--glass-text-tertiary)]"
      />
      <span className="min-w-0 flex-1 truncate font-medium text-[var(--glass-text-primary)]">
        {resource.name}
      </span>
      <AppIcon
        name="crosshair"
        className="h-3.5 w-3.5 shrink-0 text-[var(--glass-tone-info-fg)] opacity-0 transition-opacity group-hover:opacity-100"
        aria-hidden="true"
      />
    </button>
  )
}

/**
 * Content-management panel. In step view it shows the active step's content
 * card; switching to all content replaces it with the project directory tree
 * (folders plus their direct files) and cross-project search. Folder rows jump
 * to the matching canvas group when it is projected; file rows and search
 * results share the canonical Resource navigation entry, which locates the
 * exact file node by resourceId.
 */
export function CanvasFolderNavigation(props: {
  readonly stages: readonly ProductionStageView[]
  readonly activeStep: ProductionStageKey
  readonly onStepSelected: (stepKey: ProductionStageKey) => void
  readonly onStartStep: (stepKey: ProductionStageKey) => void
  readonly canGoBack: boolean
  readonly folderDisplays: ReadonlyMap<string, 'card' | 'section'>
  readonly canvasSubtreePaths: readonly string[]
  readonly onJumpToFolder: (folder: WorkspaceResourceView) => boolean
  /** Notifies the canvas that the user targeted a folder. Returns true when
   * the canvas handled the activation itself (for example, by showing the
   * all-content projection and focusing a step folder). */
  readonly onFolderFocus?: (folder: WorkspaceResourceView) => boolean
  readonly search: string
  readonly searchPlaceholder: string
  readonly backLabel: string
  readonly searchResultsLabel: string
  readonly noResultsLabel: string
  readonly loadingLabel: string
  readonly loadFailedLabel: string
  readonly retryLabel: string
  readonly loadMoreLabel: string
  readonly searchResults: readonly WorkspaceResourceView[]
  readonly searchLoading: boolean
  readonly searchFailed: boolean
  readonly searchHasMore: boolean
  readonly onBack: () => void
  readonly onSearchChange: (value: string) => void
  readonly onSearchResult: (resource: WorkspaceResourceView) => void
  readonly onRetrySearch: () => void
  readonly onLoadMoreSearch: () => void
  /** Active step folder; when set, stepContent replaces the directory tree. */
  readonly scopePath: string | null
  readonly scopeLabel: string
  readonly viewingAll: boolean
  readonly viewAllLabel: string
  readonly viewStepLabel: string
  readonly onToggleScope: () => void
  /** Step-view body: replaces the directory tree until the user views all. */
  readonly stepContent?: ReactNode
}) {
  const t = useTranslations('projectWorkflow.canvas.workspace.folderNavigation')
  const tStages = useTranslations('projectWorkflow.canvas.workspace.stages')
  const { projectId } = useWorkspaceProvider()
  const hasSearch = props.search.trim().length > 0
  const showStepContent = Boolean(props.scopePath && props.stepContent)
  const activeStepRowRef = useRef<HTMLDivElement | null>(null)

  const treeQuery = useWorkspaceResources({
    projectId,
    prefix: props.scopePath,
    search: null,
    scope: 'subtree',
    enabled: !showStepContent,
  })
  const fetchNextTreePage = treeQuery.fetchNextPage
  const treeHasNextPage = treeQuery.hasNextPage
  const treeFetchingNextPage = treeQuery.isFetchingNextPage
  useEffect(() => {
    if (!treeHasNextPage || treeFetchingNextPage) return
    void fetchNextTreePage()
  }, [fetchNextTreePage, treeFetchingNextPage, treeHasNextPage])
  const treeResources = useMemo(() => {
    const byId = new Map<string, WorkspaceResourceView>()
    for (const page of treeQuery.data?.pages ?? []) {
      for (const resource of page.items) byId.set(resource.resourceId, resource)
    }
    return [...byId.values()]
  }, [treeQuery.data])
  const tree = useMemo(
    () => buildWorkspaceCanvasFolderTree({ currentFolderPath: props.scopePath, resources: treeResources }),
    [props.scopePath, treeResources],
  )
  const rootFolders = tree.folders.filter((child) => child.folder !== null)
  const stepFolderPaths = new Set(props.stages.flatMap((stage) => productionStageFolderPaths(stage.key)))
  const otherRootFolders = rootFolders.filter((node) => (
    node.folder && !stepFolderPaths.has(node.folder.workspacePath)
  ))
  const rootFiles = tree.resources
  const treeReady = !treeQuery.isLoading && !treeQuery.isError && !treeHasNextPage
  useEffect(() => {
    if (showStepContent || hasSearch || !treeReady) return
    activeStepRowRef.current?.scrollIntoView({ block: 'nearest', inline: 'nearest' })
  }, [hasSearch, props.activeStep, showStepContent, treeReady])
  // 搜索结果里的空文件夹同样只展示不激活——系统不存在进入空文件夹的入口。
  const folderFileCounts = useMemo(() => {
    const counts = new Map<string, number>()
    const walk = (candidate: WorkspaceCanvasFolderTreeNode) => {
      for (const child of candidate.folders) {
        if (!child.folder) continue
        counts.set(child.folder.resourceId, countWorkspaceFolderFiles(child))
        walk(child)
      }
    }
    walk(tree)
    return counts
  }, [tree])
  const searchResultInert = (resource: WorkspaceResourceView): boolean =>
    resource.resourceKind === 'folder' && (folderFileCounts.get(resource.resourceId) ?? 0) === 0

  const enterFolder = (resource: WorkspaceResourceView) => {
    props.onSearchResult(resource)
  }
  const activateRow = (resource: WorkspaceResourceView) => {
    // Step folders in all-content mode should reveal that step without
    // filtering the other steps out, so the canvas gets first refusal.
    if (props.onFolderFocus?.(resource)) return
    // 跳转优先:面板保持打开,方便连续跳转;跳不了(子树不在当前画布)才进入。
    if (props.onJumpToFolder(resource)) return
    enterFolder(resource)
  }

  return (
    <div className="pointer-events-auto flex min-h-0 max-h-full flex-col items-start">
      <div className="nodrag nopan nowheel flex min-h-0 max-h-full w-[min(24rem,calc(100vw-8rem))] flex-col overflow-hidden rounded-2xl border border-white/80 bg-white/88 p-2 shadow-lg ring-1 ring-[var(--glass-stroke-base)]/70 backdrop-blur-2xl">
        <div className="mb-1.5 flex shrink-0 items-center justify-between gap-2 px-0.5">
          <div className="flex min-w-0 items-center gap-1.5">
            {props.canGoBack ? (
              <button
                type="button"
                aria-label={props.backLabel}
                title={props.backLabel}
                className={`${PANEL_BUTTON_CLASS} w-8`}
                onClick={props.onBack}
              >
                <AppIcon name="chevronLeft" className="h-3.5 w-3.5" />
              </button>
            ) : null}
            <span className="inline-flex min-w-0 items-center gap-1.5 text-[12px] font-semibold text-[var(--glass-text-primary)]">
              <AppIcon name="folder" className="h-3.5 w-3.5 shrink-0 text-[var(--glass-tone-info-fg)]" />
              <span className="truncate">{t('directory')}</span>
            </span>
            {showStepContent ? null : (
              <span className="min-w-0 truncate text-[10px] font-semibold uppercase tracking-wide text-[var(--glass-text-tertiary)]">
                {props.scopeLabel}
              </span>
            )}
          </div>
          <button
            type="button"
            className="shrink-0 rounded-full px-2 py-1 text-[11px] font-semibold text-[var(--glass-tone-info-fg)] transition hover:bg-[var(--glass-selection-hover-bg)]"
            onClick={props.onToggleScope}
          >
            {props.viewingAll ? props.viewStepLabel : props.viewAllLabel}
          </button>
        </div>
        {showStepContent ? (
          <div className="flex min-h-0 flex-1 flex-col overflow-hidden">
            {props.stepContent}
          </div>
        ) : (
          <>
          <label className="relative block shrink-0">
            <AppIcon name="search" className="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-[var(--glass-text-tertiary)]" />
            <input
              value={props.search}
              placeholder={props.searchPlaceholder}
              className="glass-input-base w-full py-2 pl-8 pr-8 text-xs"
              onChange={(event) => props.onSearchChange(event.target.value)}
            />
            {hasSearch ? (
              <button
                type="button"
                className="absolute right-2 top-1/2 -translate-y-1/2 rounded-full p-1 text-[var(--glass-text-tertiary)] hover:bg-slate-100"
                onClick={() => props.onSearchChange('')}
              >
                <AppIcon name="close" className="h-3 w-3" />
              </button>
            ) : null}
          </label>
          {hasSearch ? (
            <div className="mt-1.5 min-h-0 overflow-y-auto">
              <p className="border-b border-[var(--glass-stroke-soft)] px-2 py-2 text-[10px] font-semibold uppercase tracking-wide text-[var(--glass-text-tertiary)]">
                {props.searchResultsLabel}
              </p>
              {props.searchFailed ? (
                <div className="flex items-center justify-between gap-3 px-3 py-3 text-xs text-[var(--glass-tone-danger-fg)]">
                  <span>{props.loadFailedLabel}</span>
                  <button type="button" className="font-semibold" onClick={props.onRetrySearch}>
                    {props.retryLabel}
                  </button>
                </div>
              ) : props.searchLoading && props.searchResults.length === 0 ? (
                <p className="px-3 py-3 text-xs text-[var(--glass-text-tertiary)]">{props.loadingLabel}</p>
              ) : props.searchResults.length === 0 ? (
                <p className="px-3 py-3 text-xs text-[var(--glass-text-tertiary)]">{props.noResultsLabel}</p>
              ) : (
                <ul className="max-h-64 overflow-y-auto p-1.5">
                  {props.searchResults.map((resource) => (
                    <li key={resource.resourceId}>
                      <button
                        type="button"
                        className={`flex w-full items-center gap-2 rounded-lg px-2 py-2 text-left ${
                          searchResultInert(resource) ? 'cursor-default opacity-55' : 'hover:bg-[var(--glass-selection-hover-bg)]'
                        }`}
                        onClick={searchResultInert(resource) ? undefined : () => enterFolder(resource)}
                      >
                        <AppIcon
                          name={resource.resourceKind === 'folder' ? 'folder' : resourceIconName(resource)}
                          className="h-4 w-4 shrink-0 text-[var(--glass-text-tertiary)]"
                        />
                        <span className="min-w-0 flex-1">
                          <span className="block truncate text-xs font-medium text-[var(--glass-text-primary)]">
                            {resource.name}
                          </span>
                          <span className="block truncate text-[10px] text-[var(--glass-text-tertiary)]">
                            {resource.workspacePath}
                          </span>
                        </span>
                      </button>
                    </li>
                  ))}
                  {props.searchHasMore ? (
                    <li>
                      <button
                        type="button"
                        className="w-full rounded-lg px-3 py-2 text-xs font-semibold text-[var(--glass-tone-info-fg)] hover:bg-slate-50"
                        onClick={props.onLoadMoreSearch}
                      >
                        {props.loadMoreLabel}
                      </button>
                    </li>
                  ) : null}
                </ul>
              )}
            </div>
          ) : (
            <div className="mt-1.5 min-h-0 max-h-72 overflow-y-auto p-0.5">
              {treeQuery.isError ? (
                <div className="flex items-center justify-between gap-3 px-2 py-2 text-xs text-[var(--glass-tone-danger-fg)]">
                  <span>{props.loadFailedLabel}</span>
                  <button type="button" className="font-semibold" onClick={() => { void treeQuery.refetch() }}>
                    {props.retryLabel}
                  </button>
                </div>
              ) : !treeReady ? (
                <p className="px-2 py-2 text-xs text-[var(--glass-text-tertiary)]">{props.loadingLabel}</p>
              ) : props.stages.length === 0 && rootFolders.length === 0 && rootFiles.length === 0 ? (
                <p className="px-2 py-2 text-xs text-[var(--glass-text-tertiary)]">
                  {props.scopePath ? t('scopeEmpty') : t('directoryEmpty')}
                </p>
              ) : (
                <>
                  {props.stages.map((stage) => {
                    const folderPaths = productionStageFolderPaths(stage.key)
                    const folderNodes = rootFolders.filter((node) => (
                      node.folder && folderPaths.includes(node.folder.workspacePath)
                    ))
                    const active = stage.key === props.activeStep
                    const count = folderNodes.length > 0
                      ? folderNodes.reduce((total, node) => total + countWorkspaceFolderFiles(node), 0)
                      : stage.counts.total
                    return (
                      <div
                        key={stage.key}
                        ref={active ? activeStepRowRef : undefined}
                        className="scroll-m-1"
                      >
                        <button
                          type="button"
                          aria-current={active ? 'step' : undefined}
                          className={`flex w-full items-center gap-1.5 rounded-lg px-2 py-2 text-left text-xs transition ${
                            active
                              ? 'bg-[var(--glass-selection-hover-bg)] text-[var(--glass-tone-info-fg)]'
                              : 'text-[var(--glass-text-secondary)] hover:bg-[var(--glass-selection-hover-bg)]'
                          }`}
                          onClick={() => props.onStepSelected(stage.key)}
                        >
                          <AppIcon name="folder" className="h-3.5 w-3.5 shrink-0 text-[var(--glass-tone-info-fg)]" />
                          <span className="min-w-0 flex-1 truncate font-semibold">{stage.defaultFolderPath}</span>
                          <span className="shrink-0 text-[10px] text-[var(--glass-text-tertiary)]">{t('sectionCount', { count })}</span>
                        </button>
                        {active && count === 0 ? (
                          <div className="mx-2 mb-1 rounded-lg bg-slate-50 px-3 py-2">
                            <p className="text-[11px] text-[var(--glass-text-tertiary)]">{t('scopeEmpty')}</p>
                            <button
                              type="button"
                              className="mt-1 text-[11px] font-semibold text-[var(--glass-tone-info-fg)]"
                              onClick={() => props.onStartStep(stage.key)}
                            >
                              {tStages('start')}
                            </button>
                          </div>
                        ) : null}
                        {folderNodes.flatMap((node) => node.folders).map((child) => (
                          <DirectoryTreeRow
                            key={child.folder?.resourceId}
                            node={child}
                            depth={1}
                            folderDisplays={props.folderDisplays}
                            canvasSubtreePaths={props.canvasSubtreePaths}
                            countLabel={(count) => t('sectionCount', { count })}
                            jumpTitle={t('jumpToFolder')}
                            enterTitle={t('openFolder')}
                            fileLocateTitle={t('locateFile')}
                            onRowActivate={activateRow}
                            onEnter={enterFolder}
                            onFileActivate={enterFolder}
                          />
                        ))}
                        {folderNodes.flatMap((node) => node.resources).map((resource) => (
                          <DirectoryFileRow
                            key={resource.resourceId}
                            resource={resource}
                            depth={1}
                            locateTitle={t('locateFile')}
                            onActivate={enterFolder}
                          />
                        ))}
                      </div>
                    )
                  })}
                  {otherRootFolders.map((child) => (
                    <DirectoryTreeRow
                      key={child.folder?.resourceId}
                      node={child}
                      depth={0}
                      folderDisplays={props.folderDisplays}
                      canvasSubtreePaths={props.canvasSubtreePaths}
                      countLabel={(count) => t('sectionCount', { count })}
                      jumpTitle={t('jumpToFolder')}
                      enterTitle={t('openFolder')}
                      fileLocateTitle={t('locateFile')}
                      onRowActivate={activateRow}
                      onEnter={enterFolder}
                      onFileActivate={enterFolder}
                    />
                  ))}
                  {rootFiles.map((resource) => (
                    <DirectoryFileRow
                      key={resource.resourceId}
                      resource={resource}
                      depth={0}
                      locateTitle={t('locateFile')}
                      onActivate={enterFolder}
                    />
                  ))}
                </>
              )}
            </div>
          )}
          </>
        )}
      </div>
    </div>
  )
}
