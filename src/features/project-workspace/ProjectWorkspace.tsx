'use client'

import { useCallback, useRef, useState } from 'react'
import { WorkspaceProvider } from './WorkspaceProvider'
import WorkspaceAssistantPanel from './components/WorkspaceAssistantPanel'
import ProjectWorkspaceCanvas from './canvas/ProjectWorkspaceCanvas'
import type {
  WorkspaceAssistantDraftRequest,
  WorkspaceCanvasPathFocusRequest,
  WorkspaceCanvasSelection,
} from './canvas/contracts/workspace-canvas-interactions'
import type {
  WorkspaceAssistantActiveFocusRequest,
  WorkspaceAssistantTurnOutcomeView,
} from './workspace-assistant-focus'
import type { ProjectWorkspaceProps } from './types'
import '@/styles/animations.css'

function ProjectWorkspaceContent(props: ProjectWorkspaceProps) {
  const { projectId } = props
  const [selection, setSelection] = useState<WorkspaceCanvasSelection | null>(null)
  // Assistant context is set only by an explicit discuss action, never by
  // canvas selection alone; the chip above the composer mirrors this state.
  const [assistantContext, setAssistantContext] = useState<WorkspaceCanvasSelection | null>(null)
  const [draft, setDraft] = useState<WorkspaceAssistantDraftRequest | null>(null)
  const [activeFocus, setActiveFocus] = useState<WorkspaceAssistantActiveFocusRequest | null>(null)
  const [pathFocus, setPathFocus] = useState<WorkspaceCanvasPathFocusRequest | null>(null)
  const [turnOutcomes, setTurnOutcomes] = useState<readonly WorkspaceAssistantTurnOutcomeView[]>([])
  const selectionRef = useRef<WorkspaceCanvasSelection | null>(null)
  const changeSelection = useCallback((next: WorkspaceCanvasSelection | null) => {
    selectionRef.current = next
    setSelection(next)
  }, [])
  const requestAssistantDraft = useCallback((request: WorkspaceAssistantDraftRequest) => {
    // Only the explicit "discuss" prefill copies the selection into the
    // assistant context; a draft submit carries its own references.
    if (request.kind === 'prefill') setAssistantContext(selectionRef.current)
    setDraft(request)
  }, [])
  return (
    <div className="relative h-full min-h-0 overflow-hidden">
      <WorkspaceAssistantPanel
        projectId={projectId}
        selection={assistantContext}
        draftRequest={draft}
        onDraftRequestConsumed={(requestId) => {
          setDraft((current) => current?.requestId === requestId ? null : current)
        }}
        onClearSelection={() => setAssistantContext(null)}
        autoStartDraft={props.assistantAutoStartDraft ?? null}
        autoStartKey={props.assistantAutoStartKey ?? null}
        onAutoStartConsumed={props.onAssistantAutoStartConsumed}
        onActiveOperationChange={setActiveFocus}
        onTurnOutcomesChange={setTurnOutcomes}
        onOpenWorkspacePath={(workspacePath) => {
          setPathFocus({ requestId: crypto.randomUUID(), workspacePath })
        }}
      />
      <div className="h-full min-w-0 overflow-hidden pr-[var(--workspace-assistant-panel-width,420px)]">
        <ProjectWorkspaceCanvas
          selection={selection}
          onSelectionChange={changeSelection}
          onAssistantDraftRequest={requestAssistantDraft}
          activeAssistantFocusRequest={activeFocus}
          assistantTurnOutcomes={turnOutcomes}
          workspacePathFocusRequest={pathFocus}
          onOpenWorkspacePath={(workspacePath) => {
            setPathFocus({ requestId: crypto.randomUUID(), workspacePath })
          }}
        />
      </div>
    </div>
  )
}

export default function ProjectWorkspace(props: ProjectWorkspaceProps) {
  return (
    <WorkspaceProvider projectId={props.projectId}>
      <ProjectWorkspaceContent {...props} />
    </WorkspaceProvider>
  )
}
