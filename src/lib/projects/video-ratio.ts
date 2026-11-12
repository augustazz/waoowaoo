export const DEFAULT_PROJECT_VIDEO_RATIO = '16:9'

/** Stable project default, including legacy rows; independent of user preferences. */
export function resolveProjectVideoRatio(value: string | null | undefined): string {
  return value ?? DEFAULT_PROJECT_VIDEO_RATIO
}

export const PROJECT_VIDEO_RATIOS = [
  '21:9',
  '16:9',
  '4:3',
  '1:1',
  '3:4',
  '9:16',
  '9:21',
] as const
export type ProjectVideoRatio = (typeof PROJECT_VIDEO_RATIOS)[number]
