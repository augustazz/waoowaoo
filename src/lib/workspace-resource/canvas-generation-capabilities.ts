import { projectReferenceDurationLimits, type GenerationReferenceDurationLimits } from '@/lib/ai-registry/generation-reference-duration'
import { productionModelUnavailableReason } from '@/lib/model-access/production-model'
import { PROJECT_ASSISTANT_MEDIA_ATTACHMENT_MAX_FILES } from '@/lib/project-agent/media-attachments/types'
import type { CapabilityValue, VideoInputMode } from '@/lib/ai-registry/types'
import {
  readProjectProductionContext,
  type ProductionImageModel,
  type ProductionVideoModel,
  type ProjectProductionContext,
} from '@/lib/project-production-context'

/**
 * What the Canvas may offer a user for the project's configured image and
 * video model. Every choice here is derived from the same model facts the
 * planner validates against, so the UI never shows a frame, duration, role or
 * parameter the model would reject. A missing model projects `null`, and the
 * Canvas must say so instead of guessing defaults.
 */
export interface WorkspaceCanvasGenerationParameterView {
  readonly field: string
  readonly options: readonly CapabilityValue[]
  readonly required: boolean
}

export interface WorkspaceCanvasImageGenerationCapabilityView {
  readonly modelName: string
  readonly configurationVersion: string
  readonly fixedParameters: Readonly<Record<string, CapabilityValue>>
  readonly unavailableReason: 'fixed_parameters' | 'pricing' | null
  readonly maxReferenceImages: number
  readonly modelMaxReferenceImages?: number
  readonly referenceCapabilityKnown?: boolean
  /** Project frame vocabulary entries this model accepts; empty means the model takes no frame option. */
  readonly aspectRatios: readonly string[]
  /** Model parameters the user may still choose (fixed ones are server-owned and absent). */
  readonly parameters: readonly WorkspaceCanvasGenerationParameterView[]
}

export interface WorkspaceCanvasVideoGenerationCapabilityView extends WorkspaceCanvasImageGenerationCapabilityView {
  readonly contractRules?: ProductionVideoModel['contractRules']
  readonly audio?: ProductionVideoModel['audio']
  readonly referenceDurationLimits: Readonly<Record<'audio' | 'video', GenerationReferenceDurationLimits>>
  readonly durationsSeconds: readonly number[]
  readonly supportedInputModes: readonly VideoInputMode[]
  readonly firstFrameAspectRatio: 'selected' | 'adaptive' | null
  readonly maxReferenceFiles: number
  readonly referenceAudioRequiresVisual: boolean
  readonly pricingLimited: boolean
  readonly maxReferenceAudios: number
  readonly maxReferenceVideos: number
}

export interface WorkspaceCanvasGenerationCapabilitiesView {
  /** Production configuration version these facts were read from. */
  readonly version: string
  readonly assistantImage: WorkspaceCanvasImageGenerationCapabilityView | null
  readonly assistantVideo: WorkspaceCanvasVideoGenerationCapabilityView | null
  readonly projectAspectRatio: string | null
  readonly image: WorkspaceCanvasImageGenerationCapabilityView | null
  readonly video: WorkspaceCanvasVideoGenerationCapabilityView | null
}

function userParameters(
  context: ProjectProductionContext,
  model: ProductionImageModel | ProductionVideoModel,
): readonly WorkspaceCanvasGenerationParameterView[] {
  const fixed = context.fixedParameters[model.model] ?? {}
  return model.parameters
    .filter((parameter) => fixed[parameter.field] === undefined)
    .map((parameter) => ({ field: parameter.field, options: parameter.options, required: true }))
}

export async function readWorkspaceCanvasGenerationCapabilities(input: {
  readonly projectId: string
  readonly userId: string
}): Promise<WorkspaceCanvasGenerationCapabilitiesView> {
  return projectWorkspaceCanvasGenerationCapabilities(await readProjectProductionContext(input))
}

export function projectWorkspaceCanvasGenerationCapabilities(context: ProjectProductionContext): WorkspaceCanvasGenerationCapabilitiesView {
  const imageModel = context.productionCapabilities.image[0] ?? null
  const videoModel = context.productionCapabilities.video.models[0] ?? null
  const common = (model: ProductionImageModel | ProductionVideoModel) => {
    const fixedParameters = context.fixedParameters[model.model] ?? {}
    const unavailableReason = productionModelUnavailableReason(context, model)
    return { configurationVersion: context.version, fixedParameters, unavailableReason }
  }
  const view = {
    version: context.version,
    projectAspectRatio: context.project.videoRatio,
    image: imageModel
      ? {
          ...common(imageModel),
          modelName: imageModel.name,
          maxReferenceImages: imageModel.maxReferenceImages,
          modelMaxReferenceImages: imageModel.maxReferenceImages,
          referenceCapabilityKnown: imageModel.referenceCapabilityKnown,
          aspectRatios: imageModel.aspectRatios,
          parameters: userParameters(context, imageModel),
        }
      : null,
    video: videoModel
      ? {
          ...common(videoModel),
          modelName: videoModel.name,
          contractRules: videoModel.contractRules,
          audio: videoModel.audio,
          referenceDurationLimits: projectReferenceDurationLimits(videoModel),
          firstFrameAspectRatio: videoModel.firstFrameAspectRatio,
          pricingLimited: videoModel.pricingLimited,
          maxReferenceFiles: videoModel.maxReferenceFiles,
          referenceAudioRequiresVisual: videoModel.referenceAudioRequiresVisual,
          aspectRatios: videoModel.aspectRatios,
          parameters: userParameters(context, videoModel),
          durationsSeconds: videoModel.allowedSegmentDurationsSeconds,
          supportedInputModes: videoModel.supportedInputModes,
          maxReferenceImages: videoModel.maxReferenceImages,
          maxReferenceAudios: videoModel.maxReferenceAudios,
          maxReferenceVideos: videoModel.maxReferenceVideos,
        }
      : null,
  }
  return {
    ...view,
    assistantImage: view.image ? { ...view.image, maxReferenceImages: Math.min(view.image.maxReferenceImages, PROJECT_ASSISTANT_MEDIA_ATTACHMENT_MAX_FILES) } : null,
    assistantVideo: view.video ? { ...view.video, maxReferenceImages: Math.min(view.video.maxReferenceImages, PROJECT_ASSISTANT_MEDIA_ATTACHMENT_MAX_FILES) } : null,
  }
}
