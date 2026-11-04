// Grok Imagine uses aspect_ratio, rather than the OpenAI Images size field.
// https://docs.x.ai/developers/model-capabilities/images/generation
export const GROK_IMAGE_ASPECT_RATIOS = [
  '1:1', '16:9', '9:16', '4:3', '3:4', '3:2', '2:3', '2:1', '1:2',
  '19.5:9', '9:19.5', '20:9', '9:20', '21:9', '5:2', 'auto',
] as const

export function isGrokImagineImageModel(modelId: string): boolean {
  return /(?:^|\/)grok-imagine-image(?:[-.][\w.-]+)?$/iu.test(modelId)
}
