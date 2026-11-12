'use client'

import { useCallback, useMemo, useRef, useState } from 'react'
import { useTranslations } from 'next-intl'
import { useQueryClient } from '@tanstack/react-query'
import { useToast } from '@/contexts/ToastContext'
import type { OperationPlanView } from '@/lib/operations/plan-contract'
import {
  executeApprovedCanvasOperation,
  fetchOperationPlanView,
  issueOperationApprovalGrant,
} from '@/lib/query/operation-plan-client'
import { requestJsonWithError } from '@/lib/query/mutations/mutation-shared'
import { queryKeys } from '@/lib/query/keys'

export interface CanvasOperationRequest {
  readonly operationId: string
  readonly input: Readonly<Record<string, unknown>>
  readonly confirmation: 'billable_media' | 'none'
  /** Runs after the approved plan executed; `output` is the Operation's acknowledged result. */
  readonly onAccepted?: (result: { readonly plan: OperationPlanView; readonly output: unknown }) => void
}

interface PendingCanvasOperation extends CanvasOperationRequest {
  readonly operationRequestId: string
  readonly plan: OperationPlanView
}

type CanvasOperationPhase = 'idle' | 'planning' | 'confirming' | 'executing'

export function useCanvasOperationAction(params: {
  readonly projectId: string
}) {
  const t = useTranslations('projectWorkflow.canvas.workspace.operationConfirm')
  const { showError } = useToast()
  const queryClient = useQueryClient()
  const [phase, setPhase] = useState<CanvasOperationPhase>('idle')
  const [pending, setPending] = useState<PendingCanvasOperation | null>(null)
  const busyRef = useRef(false)

  const context = useMemo(() => ({}), [])

  const begin = useCallback(async (request: CanvasOperationRequest) => {
    if (phase !== 'idle' || busyRef.current) return
    busyRef.current = true
    const operationRequestId = crypto.randomUUID()
    try {
      if (request.confirmation === 'none') {
        setPhase('executing')
        const candidate = request.input.request
        const target = candidate && typeof candidate === 'object' && !Array.isArray(candidate)
          ? candidate as Readonly<Record<string, unknown>> : null
        if (request.operationId !== 'merge_videos' || !target
          || target.kind !== 'retry' || typeof target.resourceId !== 'string'
          || typeof target.expectedTaskId !== 'string') throw new Error('CANVAS_MERGE_RETRY_INPUT_INVALID')
        await requestJsonWithError(
          `/api/projects/${encodeURIComponent(params.projectId)}/resources/${encodeURIComponent(target.resourceId)}/retry`,
          { method: 'POST', headers: { 'Content-Type': 'application/json', 'Idempotency-Key': operationRequestId },
            body: JSON.stringify({ expectedTaskId: target.expectedTaskId }) },
        )
        await queryClient.invalidateQueries({ queryKey: queryKeys.project.workspaceResourcesAll(params.projectId) })
        setPhase('idle')
        busyRef.current = false
        return
      }
      setPhase('planning')
      const plan = await fetchOperationPlanView({
        projectId: params.projectId,
        operationId: request.operationId,
        input: { ...request.input },
        context,
        operationRequestId,
      })
      setPending({ ...request, operationRequestId, plan })
      setPhase('confirming')
    } catch (error) {
      setPending(null)
      setPhase('idle')
      busyRef.current = false
      showError(error, t('failed'))
    }
  }, [context, params.projectId, phase, queryClient, showError, t])

  const confirm = useCallback(async () => {
    if (!pending || phase !== 'confirming') return
    try {
      setPhase('executing')
      const grant = await issueOperationApprovalGrant(
        pending.plan,
        pending.operationRequestId,
      )
      const output = await executeApprovedCanvasOperation({
        projectId: params.projectId,
        operationId: pending.operationId,
        input: pending.input,
        context,
        approvalGrantId: grant.approvalGrantId,
        operationRequestId: grant.operationRequestId,
      })
      pending.onAccepted?.({ plan: pending.plan, output })
      await queryClient.invalidateQueries({
        queryKey: queryKeys.project.workspaceResourcesAll(params.projectId),
      })
      setPending(null)
      setPhase('idle')
      busyRef.current = false
    } catch (error) {
      // Keep the immutable plan and request identity so a user retry cannot
      // silently approve or execute a different plan.
      setPhase('confirming')
      showError(error, t('failed'))
    }
  }, [context, params.projectId, pending, phase, queryClient, showError, t])

  const cancel = useCallback(() => {
    if (phase === 'executing') return
    setPending(null)
    setPhase('idle')
    busyRef.current = false
  }, [phase])

  return {
    begin,
    confirm,
    cancel,
    pending,
    phase,
    busy: phase !== 'idle',
  } as const
}
