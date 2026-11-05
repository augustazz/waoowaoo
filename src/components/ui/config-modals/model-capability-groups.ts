export interface ModelCapabilityGroupOption {
    value: string
    provider?: string
    providerName?: string
    /** Note shown beside the provider heading, e.g. "no API key". */
    groupNote?: string
}

export interface ModelCapabilityOptionGroup<T extends ModelCapabilityGroupOption> {
    /** Stable grouping key: the provider id when present, so two providers
     *  sharing a display name never collapse into one group. */
    key: string
    /** Provider display name used as the group heading. */
    label: string
    models: T[]
}

export function resolveModelCapabilityProviderLabel(
    option: Pick<ModelCapabilityGroupOption, 'provider' | 'providerName'>,
    fallbackLabel: string,
): string {
    return option.providerName || option.provider || fallbackLabel
}

function resolveModelCapabilityGroupKey(
    option: Pick<ModelCapabilityGroupOption, 'provider' | 'providerName'>,
    fallbackLabel: string,
): string {
    return option.provider || resolveModelCapabilityProviderLabel(option, fallbackLabel)
}

export function groupModelCapabilityOptions<T extends ModelCapabilityGroupOption>(
    models: readonly T[],
    fallbackProviderLabel: string,
): ModelCapabilityOptionGroup<T>[] {
    const grouped = new Map<string, ModelCapabilityOptionGroup<T>>()
    for (const model of models) {
        const key = resolveModelCapabilityGroupKey(model, fallbackProviderLabel)
        let group = grouped.get(key)
        if (!group) {
            group = {
                key,
                label: resolveModelCapabilityProviderLabel(model, fallbackProviderLabel),
                models: [],
            }
            grouped.set(key, group)
        }
        group.models.push(model)
    }
    return Array.from(grouped.values())
}

export function resolveSelectedModelProviderKey(
    models: readonly ModelCapabilityGroupOption[],
    value: string | undefined,
    fallbackProviderLabel: string,
): string | null {
    if (!value) return null
    const selected = models.find((model) => model.value === value)
    if (!selected) return null
    return resolveModelCapabilityGroupKey(selected, fallbackProviderLabel)
}
