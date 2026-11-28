// Executable resolution and JSON locating: the two host-environment behaviors the bridge owns.

import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { executableFileName, jsonObjectIn, resolveCliExecutable } from '../src/cli.ts'

/** Directories created by one test, removed afterwards. */
const created: string[] = []

afterEach(() => {
  for (const dir of created.splice(0)) rmSync(dir, { recursive: true, force: true })
})

/** Create a temporary directory holding one executable file. */
function directoryWithCli(): string {
  const dir = mkdtempSync(join(tmpdir(), 'feishu-bridge-'))
  created.push(dir)
  writeFileSync(join(dir, executableFileName(process.platform)), '#!/bin/sh\nexit 0\n')
  return dir
}

describe('resolveCliExecutable', () => {
  it('resolves the platform-named file inside binDir', () => {
    const dir = directoryWithCli()
    expect(resolveCliExecutable(dir)).toBe(join(dir, executableFileName(process.platform)))
  })

  it('fails with cli-missing when the file is absent', () => {
    const dir = mkdtempSync(join(tmpdir(), 'feishu-bridge-empty-'))
    created.push(dir)
    expect(() => resolveCliExecutable(dir)).toThrowError(expect.objectContaining({ code: 'cli-missing' }))
  })

  it('names the Windows executable with its extension', () => {
    expect(executableFileName('win32')).toBe('lark-cli.exe')
    expect(executableFileName('darwin')).toBe('lark-cli')
  })
})

describe('jsonObjectIn', () => {
  it('stops at the last balanced object after a progress line', () => {
    expect(jsonObjectIn('[warn] note\n{"ok":true}\n')).toEqual({ ok: true })
  })

  it('ignores a JSON array because the envelope is always an object', () => {
    expect(jsonObjectIn('[1,2,3]')).toBeUndefined()
  })

  it('returns undefined for empty output', () => {
    expect(jsonObjectIn('')).toBeUndefined()
  })
})
