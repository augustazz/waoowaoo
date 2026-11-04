'use client'

import { AppIcon } from '@/components/ui/icons'
import { isPresetComingSoonModel, type CustomModel } from '../types'
import type { UseProviderCardStateResult } from './hooks/useProviderCardState'
import type { ProviderCardProps, ProviderCardTranslator } from './types'

interface ModelRowProps {
  model: CustomModel
  t: ProviderCardTranslator
  state: UseProviderCardStateResult
  onDeleteModel: ProviderCardProps['onDeleteModel']
  onUpdateModel: ProviderCardProps['onUpdateModel']
}

/** Catalog maintenance; model selection belongs to the category picker. */
export function ModelRow({ model, t, state, onDeleteModel, onUpdateModel }: ModelRowProps) {
  const inUse = state.isDefaultModel(model)
  const comingSoon = isPresetComingSoonModel(model.provider, model.modelId)

  if (state.editingModelId === model.modelKey) {
    return (
      <div className="glass-list-row rounded-xl px-3 py-2">
        <div className="flex min-w-0 flex-1 flex-col gap-2">
          <input
            type="text"
            value={state.editModel.name}
            onChange={(event) => state.setEditModel({ ...state.editModel, name: event.target.value })}
            className="glass-input-base w-full px-3 py-1.5 text-[12px]"
            placeholder={t('modelDisplayName')}
            aria-label={t('modelDisplayName')}
          />
          <input
            type="text"
            value={state.editModel.modelId}
            onChange={(event) => state.setEditModel({ ...state.editModel, modelId: event.target.value })}
            className="glass-input-base w-full px-3 py-1.5 font-mono text-[12px]"
            placeholder={t('modelActualId')}
            aria-label={t('modelActualId')}
          />
        </div>
        <div className="flex items-center gap-1.5">
          <button
            onClick={() => { void state.handleSaveModel(model.modelKey) }}
            disabled={state.isModelSavePending}
            className="glass-icon-btn-sm"
            title={t('save')}
            aria-label={t('save')}
          >
            {state.isModelSavePending
              ? <span className="h-3.5 w-3.5 animate-spin rounded-full border-2 border-[var(--glass-text-secondary)] border-t-transparent" />
              : <AppIcon name="check" className="h-4 w-4" />}
          </button>
          <button
            onClick={state.handleCancelEditModel}
            className="glass-icon-btn-sm"
            title={t('cancel')}
            aria-label={t('cancel')}
          >
            <AppIcon name="close" className="h-3.5 w-3.5" />
          </button>
        </div>
      </div>
    )
  }

  return (
    <div className={`group glass-list-row rounded-xl px-3 py-2 ${comingSoon ? 'opacity-60' : ''}`}>
      <div className="flex min-w-0 flex-1 flex-col gap-0.5">
        <div className="flex flex-wrap items-center gap-2">
          <span className="text-[12px] font-semibold text-[var(--glass-text-primary)]">{model.name}</span>
          {inUse && (
            <span className="shrink-0 rounded-md bg-[var(--glass-accent-from)] px-1.5 py-0.5 text-[10px] leading-none text-[var(--glass-text-on-accent)]">
              {t('inUse')}
            </span>
          )}
          {comingSoon && (
            <span className="shrink-0 text-[11px] text-[var(--glass-text-tertiary)]">{t('comingSoon')}</span>
          )}
        </div>
        <span className="break-all font-mono text-[11px] text-[var(--glass-text-tertiary)]">{model.modelId}</span>
      </div>

      <div className="flex shrink-0 items-center gap-1.5">
        {!state.isPresetModel(model.modelKey) && onUpdateModel && (
          <button
            onClick={() => state.handleEditModel(model)}
            className="glass-icon-btn-sm opacity-0 transition-opacity group-hover:opacity-100"
            title={t('configure')}
            aria-label={t('configure')}
          >
            <AppIcon name="edit" className="h-3.5 w-3.5" />
          </button>
        )}
        <button
          onClick={() => onDeleteModel(model.modelKey)}
          className="glass-icon-btn-sm opacity-0 transition-opacity hover:text-[var(--glass-tone-danger-fg)] group-hover:opacity-100"
          title={t('delete')}
          aria-label={t('delete')}
        >
          <AppIcon name="trash" className="h-3.5 w-3.5" />
        </button>
      </div>
    </div>
  )
}
