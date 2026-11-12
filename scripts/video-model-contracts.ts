import { readFile, writeFile, rename, mkdir } from 'node:fs/promises'
import path from 'node:path'
import { compileVideoContracts, LOCAL_VIDEO_CONTRACT_CATALOG_PATH } from '../src/lib/ai-registry/video-contracts'

async function main() {
  const [command = 'check', filename] = process.argv.slice(2)
  if (!['check', 'import'].includes(command) || (command === 'import' && !filename)) {
    throw new Error('Usage: npm run video:contracts -- check [file] | import <file>')
  }
  const target = LOCAL_VIDEO_CONTRACT_CATALOG_PATH
  const raw = filename
    ? await readFile(path.resolve(filename), 'utf8')
    : await readFile(target, 'utf8').catch((error: NodeJS.ErrnoException) => {
        if (error.code !== 'ENOENT') throw error
        return readFile(path.resolve('config/video-model-contracts.json'), 'utf8')
      })
  if (Buffer.byteLength(raw) > 2 * 1024 * 1024) throw new Error('Contract file exceeds 2 MiB')
  const value: unknown = JSON.parse(raw)
  const compiled = compileVideoContracts(value)
  if (command === 'import') {
    await mkdir(path.dirname(target), { recursive: true })
    const temporary = `${target}.${process.pid}.tmp`
    await writeFile(temporary, `${JSON.stringify(value, null, 2)}\n`, { flag: 'wx', mode: 0o600 })
    await rename(temporary, target)
  }
  console.log(JSON.stringify({ command, models: compiled.map((entry) => ({
    provider: entry.provider, modelId: entry.modelId, protocol: entry.protocol,
    revision: entry.revision, fingerprint: entry.fingerprint,
    protocolImplemented: entry.protocol === 'json-videos-v1',
  })), generationSubmitted: false }, null, 2))
  if (command === 'import') console.log('Deployment catalog imported into data/config/video-model-contracts.json. Restart the app and worker to load the same revision. The public catalog was not modified.')
}

void main().catch((error: unknown) => {
  console.error(error instanceof Error && error.message.startsWith('Usage:') ? error.message : 'Invalid or unreadable video contract catalog')
  process.exitCode = 1
})
