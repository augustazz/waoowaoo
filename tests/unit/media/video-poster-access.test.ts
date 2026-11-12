import { beforeEach, describe, expect, it, vi } from 'vitest'
const mocks = vi.hoisted(() => ({ find: vi.fn(), auth: vi.fn() }))
vi.mock('@/lib/prisma', () => ({ prisma: {
  mediaObject: { findFirst: mocks.find },
  globalCharacterAppearance: { findMany: async () => [] },
  globalLocationImage: { findMany: async () => [] },
} }))
vi.mock('@/lib/api-auth', () => ({ requireUserAuth: mocks.auth, isErrorResponse: (value: unknown) => value instanceof Response }))
import { authorizeMediaObjectRead } from '@/lib/media/storage-access-policy'

beforeEach(() => vi.clearAllMocks())
describe('video poster media authorization', () => {
  it('authorizes a poster only through a resource version owned by the current user', async () => {
    mocks.auth.mockResolvedValue({ session: { user: { id: 'owner' } } })
    mocks.find.mockImplementation(async ({ where }) => {
      const posterRelation = where.OR?.find((condition: Record<string, unknown>) => condition.workspaceResourcePosterVersions)
      return posterRelation?.workspaceResourcePosterVersions.some.resource.userId === 'owner'
        ? { id: 'poster', publicId: 'poster-public', storageKey: 'private/poster.jpg' } : null
    })
    await expect(authorizeMediaObjectRead('poster-public')).resolves.toMatchObject({ media: { id: 'poster' } })
    mocks.auth.mockResolvedValue({ session: { user: { id: 'different-owner' } } })
    await expect(authorizeMediaObjectRead('poster-public')).rejects.toMatchObject({ code: 'NOT_FOUND' })
  })
})
