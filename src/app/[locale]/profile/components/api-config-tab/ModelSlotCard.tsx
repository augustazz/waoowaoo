'use client'

import { AppIcon } from '@/components/ui/icons'
import { ModelCapabilityDropdown } from '@/components/ui/config-modals/ModelCapabilityDropdown'
import type { CapabilitySelections, CapabilityValue, UnifiedModelType } from '@/lib/ai-registry/types'
import type { FixedParameterFieldsByModel } from '@/lib/ai-registry/fixed-parameters'
import type { ProviderCardTranslator } from '../api-config/provider-card/types'
import { MODEL_SLOT_PRESENTATION } from './model-slot-presentation'
import type { ModelSlotOption, ModelSlotSelection } from './hooks/useApiConfigFilters'
import type { CustomModel, Provider } from '../api-config'
import { ManualModelEntry } from './ManualModelEntry'

export interface ModelSlotCardProps {
  type: UnifiedModelType
  options: readonly ModelSlotOption[]
  selection: ModelSlotSelection
  customProviders?: Provider[]
  onManualSelect?: (model: Omit<CustomModel, 'enabled'>) => Promise<void>
  fixedParameterFields: FixedParameterFieldsByModel
  capabilityDefaults: CapabilitySelections
  onSelect: (type: UnifiedModelType, modelKey: string) => void
  onFixedParameterChange: (modelKey: string, field: string, value: CapabilityValue | null) => void
  t: ProviderCardTranslator
}

/**
 * One slot = one model the user picks for a category, plus the parameters they
 * choose to pin instead of leaving to the AI.
 */
export function ModelSlotCard(props: ModelSlotCardProps) {
  const { type, options, selection, t } = props
  const customProviders = props.customProviders ?? []
  const presentation = MODEL_SLOT_PRESENTATION[type]
  const title = t(presentation.slotTitle)
  const fields = selection.modelKey ? props.fixedParameterFields[selection.modelKey] ?? [] : []
  const overrides = selection.modelKey ? props.capabilityDefaults[selection.modelKey] ?? {} : {}

  return (
    <section className="glass-surface glass-card-shadow-soft flex flex-col gap-3 rounded-2xl p-4">
      <div className="flex items-center gap-2.5">
        <span className="glass-surface-soft inline-flex h-7 w-7 items-center justify-center rounded-lg text-[var(--glass-text-secondary)]">
          <AppIcon name={presentation.icon} className="h-4 w-4" />
        </span>
        <h2 className="text-sm font-semibold text-[var(--glass-text-primary)]">{title}</h2>
      </div>
      {options.length === 0 && (customProviders.length === 0 || !props.onManualSelect) ? (
        <p className="rounded-xl bg-[var(--glass-tone-surface)] px-3 py-2 text-[12px] text-[var(--glass-text-secondary)] shadow-[var(--glass-tone-shadow)]">
          {t('slotEmpty')}
        </p>
      ) : (
        <ModelCapabilityDropdown
          models={options.map((option) => ({
            value: option.modelKey,
            label: option.unclassified ? `${option.name} · ${t('discovery.unknown')}` : option.name,
            provider: option.provider,
            providerName: option.providerName,
            groupNote: option.providerHasKey ? undefined : t('notConfigured'),
            disabled: Boolean(option.videoUnavailableReason),
            note: option.videoUnavailableReason ? t(`videoAvailability.${option.videoUnavailableReason}`) : undefined,
          }))}
          value={selection.modelKey || undefined}
          onModelChange={(modelKey) => props.onSelect(type, modelKey)}
          capabilityFields={fields.map((definition) => ({
            field: definition.field,
            label: t(`fixedParameters.fields.${definition.field}`),
            options: [...definition.options],
            defaultValue: definition.defaultValue,
            allowUnset: definition.allowUnset,
          }))}
          capabilityOverrides={overrides}
          onCapabilityChange={(field, rawValue) => {
            if (!selection.modelKey) return
            if (!rawValue) {
              props.onFixedParameterChange(selection.modelKey, field, null)
              return
            }
            const definition = fields.find((candidate) => candidate.field === field)
            const value = definition?.options.find((option) => String(option) === rawValue)
            if (value !== undefined) props.onFixedParameterChange(selection.modelKey, field, value)
          }}
          placeholder={selection.ambiguous ? t('modelSelectionRequired') : t('slotUnset')}
          allowUnset
          searchPlaceholder={t('discovery.search')}
          emptyLabel={t('discovery.noMatches')}
          modelListFooter={customProviders.length > 0 && props.onManualSelect ? (
            <ManualModelEntry type={type} providers={customProviders} onSelect={props.onManualSelect} t={t} />
          ) : undefined}
        />
      )}
      {selection.ambiguous && (
        <p className="text-xs text-[var(--glass-tone-warning-fg)]">{t('modelSelectionRequiredHint')}</p>
      )}
      {type === 'video' && selection.modelKey && (
        <p className="text-xs text-[var(--glass-text-tertiary)]">{t('videoModelChangeHint')}</p>
      )}
      {options.find((option) => option.modelKey === selection.modelKey)?.videoUnavailableReason && (
        <p role="alert" className="text-xs text-[var(--glass-tone-warning-fg)]">
          {t(`videoAvailability.${options.find((option) => option.modelKey === selection.modelKey)!.videoUnavailableReason}`)}
        </p>
      )}
    </section>
  )
}
