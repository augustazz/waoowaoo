'use client'

import { useTranslations } from 'next-intl'
import type { CanvasGenerationCapability } from '../create/canvas-draft'
import { Link } from '@/i18n/navigation'

export function GenerationReferenceLimits({ capability }: { readonly capability: CanvasGenerationCapability | null }) {
  const t = useTranslations('projectWorkflow.canvas.workspace.create')
  if (!capability) return null
  const video = capability.mediaType === 'video' ? capability.view : null
  return (
    <div className="mt-1 space-y-1 text-[10px] leading-4 text-[var(--glass-text-tertiary)]">
      {video ? (video.supportedInputModes.includes('reference') ? (
        <p>{t('referenceLimits.video', { images: video.maxReferenceImages, audios: video.maxReferenceAudios, videos: video.maxReferenceVideos, total: video.maxReferenceFiles })}</p>
      ) : null) : capability.view.maxReferenceImages > 0 ? (
        <>
          <p>{t('referenceLimits.image', { count: capability.view.maxReferenceImages })}</p>
          {(capability.view.modelMaxReferenceImages ?? 0) > capability.view.maxReferenceImages
            ? <p>{t('referenceLimits.modelImage', { count: capability.view.modelMaxReferenceImages! })}</p> : null}
        </>
      ) : (
        <p>{t(capability.view.referenceCapabilityKnown === false ? 'referenceLimits.imageUnknown' : 'referenceLimits.imageUnsupported')} <Link href={{ pathname: '/profile', query: { section: 'apiConfig' } }} target="_blank" rel="noopener noreferrer" className="underline">{t('referenceLimits.changeModel')}</Link></p>
      )}
      {video?.supportedInputModes.includes('first_last_frame') ? <p>{t('referenceLimits.frames')}</p>
        : video?.supportedInputModes.includes('first_frame') ? <p>{t('referenceLimits.firstFrameOnly')}</p> : null}
      {video ? (['audio', 'video'] as const).map((channel) => {
        const limit = video.referenceDurationLimits[channel]
        const count = channel === 'audio' ? video.maxReferenceAudios : video.maxReferenceVideos
        return count > 0 && limit.maximumTotalMs !== null ? (
          <p key={channel}>{t(`referenceLimits.${channel}Duration`, { minimum: (limit.minimumMs ?? 0) / 1000, maximum: (limit.maximumMs ?? limit.maximumTotalMs) / 1000, total: limit.maximumTotalMs / 1000 })}</p>
        ) : null
      }) : null}
    </div>
  )
}
