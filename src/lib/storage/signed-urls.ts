import { decodeImageUrlsFromDb } from '@/lib/contracts/image-urls-contract'
import { createScopedLogger } from '@/lib/logging/core'
import { getSignedUrl } from '@/lib/storage'
import { DEFAULT_SIGNED_URL_EXPIRES_SECONDS } from '@/lib/storage/utils'

export type UnknownRecord = Record<string, unknown>

export interface AppLike {
  imageUrls: string | null
  descriptions: string | unknown[] | null
  imageUrl: string | null
  [key: string]: unknown
}

export interface CharacterLike {
  appearances?: AppLike[]
  [key: string]: unknown
}

export interface LocationImageLike {
  imageUrl: string | null
  [key: string]: unknown
}

export interface LocationLike {
  images?: LocationImageLike[]
  [key: string]: unknown
}

export interface ProjectLike {
  audioUrl?: string | null
  characters?: CharacterLike[]
  locations?: LocationLike[]
  props?: LocationLike[]
  [key: string]: unknown
}

const signedUrlLogger = createScopedLogger({
  module: 'storage.signed-urls',
})
const _ulogError = (...args: unknown[]) => signedUrlLogger.error(...args)

function keyToSignedUrl(key: string | null, expires: number = DEFAULT_SIGNED_URL_EXPIRES_SECONDS): string | null {
  if (!key) return null
  if (key.startsWith('http://') || key.startsWith('https://')) {
    return key
  }
  return getSignedUrl(key, expires)
}

function addSignedUrlsToCharacter(character: CharacterLike) {
  const appearances = character.appearances?.map((app) => {
    const imageUrls = decodeImageUrlsFromDb(app.imageUrls, 'appearance.imageUrls')
      .map((key) => keyToSignedUrl(key))
      .filter((url): url is string => !!url)

    let descriptions: string[] | null = null
    if (app.descriptions) {
      try {
        descriptions = typeof app.descriptions === 'string' ? JSON.parse(app.descriptions) : app.descriptions as string[]
      } catch (error: unknown) {
        _ulogError('[signed-url] failed to parse descriptions', app.descriptions, error)
      }
    }

    return {
      ...app,
      imageUrl: keyToSignedUrl(app.imageUrl),
      imageUrls,
      descriptions,
    }
  }) || []

  return {
    ...character,
    appearances,
  }
}

function addSignedUrlToLocation(location: LocationLike) {
  const images = location.images?.map((img) => ({
    ...img,
    imageUrl: keyToSignedUrl(img.imageUrl),
  })) || []

  return {
    ...location,
    images,
  }
}

export function addSignedUrlsToProject(project: ProjectLike) {
  return {
    ...project,
    audioUrl: project.audioUrl ? getSignedUrl(project.audioUrl) : project.audioUrl,
    characters: project.characters?.map(addSignedUrlsToCharacter) || [],
    locations: project.locations?.map(addSignedUrlToLocation) || [],
    props: project.props?.map(addSignedUrlToLocation) || [],
  }
}
