interface GenerationFrameItem {
  readonly mediaType: 'image' | 'video' | 'audio'
  readonly options?: { readonly aspectRatio?: string }
}

/** Every new visual generation uses the project frame, including legacy inputs. */
export function resolveGenerationAspectRatioOwner(item: GenerationFrameItem): 'project' | null {
  if (item.mediaType === 'audio') return null
  return 'project'
}

export function resolveGenerationAspectRatio(item: GenerationFrameItem, projectAspectRatio: string | null): string | null {
  const owner = resolveGenerationAspectRatioOwner(item)
  if (owner === null) return null
  if (!projectAspectRatio) throw new Error('PROJECT_VIDEO_RATIO_SNAPSHOT_REQUIRED')
  return projectAspectRatio
}
