export const OPENAI_COMPATIBLE_PROVIDER_KEY = 'openai-compatible'

export function normalizeResponsesBaseUrl(value: string): string {
  const url = new URL(value.trim())
  if (
    !['http:', 'https:'].includes(url.protocol)
    || url.username || url.password || url.search || url.hash
    || /\/(?:responses|chat\/completions)\/?$/u.test(url.pathname)
  ) {
    throw new Error('PROVIDER_BASE_URL_INVALID')
  }
  return url.toString().replace(/\/+$/u, '')
}
