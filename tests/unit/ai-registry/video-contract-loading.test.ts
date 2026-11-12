import { afterEach, describe, expect, it, vi } from 'vitest'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import defaults from '../../../config/video-model-contracts.json'
import example from '../../../config/video-model-contracts.example.json'
import fixture from '../../fixtures/video-contract-catalog.json'
import { compileVideoContracts, loadVideoContracts } from '@/lib/ai-registry/video-contracts'
import * as logging from '@/lib/logging/core'

const directories: string[] = []
function catalogFile(value: string) {
  const directory = mkdtempSync(path.join(tmpdir(), 'video-contracts-'))
  directories.push(directory)
  const filename = path.join(directory, 'catalog.json')
  writeFileSync(filename, value)
  return filename
}
afterEach(() => {
  directories.splice(0).forEach((directory) => rmSync(directory, { recursive: true, force: true }))
  vi.restoreAllMocks()
})

describe('deployment video contracts', () => {
  it('ships no deployment bindings and does not enable the illustrative example', () => {
    expect(compileVideoContracts(defaults)).toEqual([])
    expect(loadVideoContracts(null)).toEqual([])
    expect(compileVideoContracts(example)).toHaveLength(1)
  })

  it('loads the shared deployment file without changing frozen contract identities', () => {
    expect(loadVideoContracts(catalogFile(JSON.stringify(fixture)))).toEqual(compileVideoContracts(fixture))
  })

  it('accepts no local file as an empty compatible catalog without warning', () => {
    const warn = vi.spyOn(logging, 'logWarn').mockImplementation(() => {})
    const filename = catalogFile('{}')
    expect(loadVideoContracts(`${filename}.missing`)).toEqual([])
    expect(warn).not.toHaveBeenCalled()
  })

  it.each(['{"private":"sensitive-marker",', '{"schemaVersion":1,"families":[],"channels":[{"private":"sensitive-marker"}]}'])('isolates invalid deployment data without exposing the payload', (raw) => {
    const warn = vi.spyOn(logging, 'logWarn').mockImplementation(() => {})
    expect(loadVideoContracts(catalogFile(raw))).toEqual([])
    expect(warn).toHaveBeenCalledOnce()
    expect(JSON.stringify(warn.mock.calls)).not.toContain('sensitive-marker')
  })
})
