import { randomBytes } from 'node:crypto'
import fs from 'node:fs'
import path from 'node:path'

const CONFIG_FILE_NAME_PATTERN = /^[a-z0-9][a-z0-9-]*\.json$/

export interface RuntimeConfigFileStat {
  readonly key: string
  readonly mtimeMs: number
  readonly size: number
  readonly ino: number
}

export function getRuntimeConfigDir(): string {
  const override = process.env.WAO_RUNTIME_CONFIG_DIR?.trim()
  if (override) return path.resolve(override)
  return path.join(process.cwd(), 'data', 'config')
}

export function getRuntimeConfigFilePath(name: string): string {
  if (!CONFIG_FILE_NAME_PATTERN.test(name)) {
    throw new Error(`RUNTIME_CONFIG_FILE_NAME_INVALID:${name}`)
  }
  return path.join(getRuntimeConfigDir(), name)
}

export function getRuntimeConfigFileStat(name: string): RuntimeConfigFileStat | null {
  try {
    const stat = fs.statSync(getRuntimeConfigFilePath(name))
    if (!stat.isFile()) return null
    return {
      key: `${String(stat.ino)}:${String(stat.mtimeMs)}:${String(stat.size)}`,
      mtimeMs: stat.mtimeMs,
      size: stat.size,
      ino: stat.ino,
    }
  } catch (error: unknown) {
    if (isMissingFileError(error)) return null
    throw error
  }
}

export function readRuntimeConfigFile<T>(name: string): T | null {
  let raw: string
  try {
    raw = fs.readFileSync(getRuntimeConfigFilePath(name), 'utf8')
  } catch (error: unknown) {
    if (isMissingFileError(error)) return null
    throw error
  }

  try {
    return JSON.parse(raw) as T
  } catch {
    throw new Error(`RUNTIME_CONFIG_JSON_INVALID:${name}`)
  }
}

export function writeRuntimeConfigFile(name: string, value: unknown): void {
  const directory = getRuntimeConfigDir()
  fs.mkdirSync(directory, { recursive: true, mode: 0o700 })
  try {
    fs.chmodSync(directory, 0o700)
  } catch {
    // Best effort: a pre-existing directory may be owned by another process.
  }

  const filePath = getRuntimeConfigFilePath(name)
  const temporaryPath = path.join(
    directory,
    `.${name}.${String(process.pid)}.${randomBytes(6).toString('hex')}.tmp`,
  )
  const payload = `${JSON.stringify(value, null, 2)}\n`
  fs.writeFileSync(temporaryPath, payload, { encoding: 'utf8', mode: 0o600 })
  try {
    fs.renameSync(temporaryPath, filePath)
  } catch (error) {
    try {
      fs.unlinkSync(temporaryPath)
    } catch {
      // Ignore cleanup failures; the original error is more useful.
    }
    throw error
  }
  try {
    fs.chmodSync(filePath, 0o600)
  } catch {
    // Best effort: the process may not own the file (for example in a read-only mount).
  }
}

export function deleteRuntimeConfigFile(name: string): void {
  try {
    fs.unlinkSync(getRuntimeConfigFilePath(name))
  } catch (error: unknown) {
    if (isMissingFileError(error)) return
    throw error
  }
}

function isMissingFileError(error: unknown): boolean {
  return !!error
    && typeof error === 'object'
    && 'code' in error
    && (error as { code?: unknown }).code === 'ENOENT'
}
