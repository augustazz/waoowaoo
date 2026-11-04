import { PrismaClient } from '@prisma/client'
import { applyDatabaseUrlToProcessEnv, resolveDatabaseUrl } from '@/lib/runtime-config/database-settings'

const globalForPrisma = global as unknown as { prisma: PrismaClient }

// A database URL saved from the setup/admin page lives in data/config and must
// win over the container environment. Prisma reads DATABASE_URL lazily, so apply
// it before constructing the singleton client.
const runtimeDatabase = applyDatabaseUrlToProcessEnv()
const resolvedDatabase = runtimeDatabase ? resolveDatabaseUrl() : null

export const prisma = globalForPrisma.prisma || new PrismaClient(
  resolvedDatabase
    ? { datasources: { db: { url: resolvedDatabase.url } } }
    : undefined,
)

if (process.env.NODE_ENV !== 'production') globalForPrisma.prisma = prisma
