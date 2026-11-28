// Executable resolution, process running, and JSON locating: the host-environment behaviors the bridge owns.

import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  OUTPUT_LIMIT_BYTES,
  createProcessRunner,
  executableFileName,
  jsonObjectIn,
  resolveCliExecutable,
} from '../src/cli.ts'

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

/** A runner over this Node binary, so every command below is a real child process. */
function nodeRunner(): ReturnType<typeof createProcessRunner> {
  return createProcessRunner(() => process.execPath)
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

  it('looks for the executable in the installed @larksuite/cli package by default', () => {
    // The executable arrives with @larksuite/cli's install script; a checkout that skipped it must report
    // that same package location, never another installation.
    const expected = join('@larksuite', 'cli', 'bin', executableFileName(process.platform))
    let resolved: string | undefined
    try {
      resolved = resolveCliExecutable(undefined)
    } catch (error) {
      expect(error).toMatchObject({ code: 'cli-missing' })
      expect((error as Error).message).toContain(expected)
    }
    expect(resolved ?? expected).toContain(expected)
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

  it('returns undefined for an unterminated object', () => {
    expect(jsonObjectIn('progress\n{"ok":true')).toBeUndefined()
  })
})

describe('createProcessRunner', () => {
  it('captures both streams and the exit code of one finished command', async () => {
    await expect(nodeRunner()({
      args: ['-e', 'process.stdout.write("out"); process.stderr.write("err"); process.exit(2)'],
      timeoutMs: 20_000,
    })).resolves.toEqual({ exitCode: 2, stdout: 'out', stderr: 'err' })
  })

  it('writes the request stdin and closes an absent one', async () => {
    const runner = nodeRunner()
    await expect(runner({
      args: ['-e', 'process.stdin.pipe(process.stdout)'],
      stdin: '{"summary":"Trip"}',
      timeoutMs: 20_000,
    })).resolves.toMatchObject({ stdout: '{"summary":"Trip"}' })
    await expect(runner({
      args: ['-e', 'process.stdin.resume(); process.stdin.on("end", () => process.stdout.write("eof"))'],
      timeoutMs: 20_000,
    })).resolves.toMatchObject({ stdout: 'eof' })
  })

  it('terminates a command that outlives its budget', async () => {
    await expect(nodeRunner()({
      args: ['-e', 'setTimeout(() => {}, 10000)'],
      timeoutMs: 80,
    })).rejects.toMatchObject({ code: 'timeout', message: expect.stringContaining('exceeded 80 ms') as string })
  })

  it('terminates a command when the caller cancels', async () => {
    const abort = new AbortController()
    const running = nodeRunner()({
      args: ['-e', 'setTimeout(() => {}, 10000)'],
      timeoutMs: 20_000,
      signal: abort.signal,
    })
    setTimeout(() => { abort.abort() }, 50)
    await expect(running).rejects.toMatchObject({ code: 'timeout', message: expect.stringContaining('was cancelled') as string })
  })

  it('refuses an already-cancelled call without resolving the executable', async () => {
    const resolveExecutable = vi.fn(() => process.execPath)
    const cancelled = new Error('the panel closed')
    await expect(createProcessRunner(resolveExecutable)({
      args: [],
      timeoutMs: 20_000,
      signal: AbortSignal.abort(cancelled),
    })).rejects.toBe(cancelled)
    expect(resolveExecutable).not.toHaveBeenCalled()
  })

  it('fails with cli-missing when the executable cannot be started', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'feishu-bridge-missing-'))
    created.push(dir)
    await expect(createProcessRunner(() => join(dir, executableFileName(process.platform)))({
      args: [],
      timeoutMs: 20_000,
    })).rejects.toMatchObject({ code: 'cli-missing', message: expect.stringContaining('could not be started') as string })
  })

  it('fails with upstream when one stream floods past the output limit', async () => {
    await expect(nodeRunner()({
      args: ['-e', 'const chunk = "x".repeat(65536); for (let index = 0; index < 200; index += 1) process.stdout.write(chunk)'],
      timeoutMs: 120_000,
    })).rejects.toMatchObject({
      code: 'upstream',
      message: expect.stringContaining(`produced more than ${OUTPUT_LIMIT_BYTES} bytes`) as string,
    })
  })
})
