'use client'

import { useRef, useState } from 'react'
import { useTranslations } from 'next-intl'
import { useQueryClient } from '@tanstack/react-query'
import { useToast } from '@/contexts/ToastContext'
import { requestOperationMutationVoidWithError } from '@/lib/query/mutations/mutation-shared'

export function useCanvasResourceWorkflowAction(projectId: string) {
  const t = useTranslations('projectWorkflow.canvas.workspace.actions')
  const queryClient = useQueryClient()
  const { showError, showToast } = useToast()
  const pending = useRef(false)
  const [busy, setBusy] = useState(false)

  const setWorkflowEnabled = async (resourceId: string, workflowEnabled: boolean) => {
    if (pending.current) return
    pending.current = true
    setBusy(true)
    try {
      await requestOperationMutationVoidWithError(
        `/api/projects/${encodeURIComponent(projectId)}/resources/${encodeURIComponent(resourceId)}`,
        {
          method: 'PATCH',
          headers: {
            'Content-Type': 'application/json',
            'Idempotency-Key': `set_resource_workflow:${resourceId}:${crypto.randomUUID()}`,
          },
          body: JSON.stringify({ workflowEnabled }),
        },
        queryClient,
      )
      showToast(t(workflowEnabled ? 'workflowRestored' : 'workflowDisabled'), 'success')
    } catch (error) {
      showError(error, t('workflowUpdateFailed'))
    } finally {
      pending.current = false
      setBusy(false)
    }
  }
  return { setWorkflowEnabled, busy }
}
