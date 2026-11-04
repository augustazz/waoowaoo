/**
 * Runs the Prisma CLI with the database URL resolved from data/config.
 *
 * The setup page stores the MySQL URL in data/config/database.json (encrypted),
 * which must take precedence over the container environment. Prisma CLI reads
 * DATABASE_URL directly, so this wrapper applies the same resolution before
 * spawning it.
 */
import { spawnSync } from 'node:child_process'

async function main(): Promise<never> {
  const args = process.argv.slice(2)
  if (args.length === 0) {
    console.error('Usage: tsx scripts/prisma-with-runtime-config.ts <prisma-args...>')
    process.exit(2)
  }

  // Source-mode invocations do not automatically load .env. Docker and other
  // launchers already provide the environment, and loadEnvFile does not
  // override existing variables.
  try {
    const { loadEnvFile } = await import('node:process')
    loadEnvFile('.env')
  } catch (error) {
    const code = error && typeof error === 'object' && 'code' in error
      ? (error as { code?: unknown }).code
      : undefined
    if (code !== 'ENOENT') {
      console.error('[prisma] Failed to load .env:', error)
      process.exit(1)
    }
  }

  const { resolveDatabaseUrl } = await import('@/lib/runtime-config/database-settings')
  const resolved = resolveDatabaseUrl()
  if (!resolved) {
    console.warn('[prisma] No database URL configured yet. Skipping Prisma command until setup completes.')
    process.exit(0)
  }

  const result = spawnSync('npx', ['prisma', ...args], {
    env: {
      ...process.env,
      DATABASE_URL: resolved.url,
    },
    stdio: 'inherit',
    shell: process.platform === 'win32',
  })

  if (result.error) {
    console.error('[prisma] Failed to start Prisma CLI:', result.error)
    process.exit(1)
  }

  process.exit(result.status ?? 1)
}

void main()
