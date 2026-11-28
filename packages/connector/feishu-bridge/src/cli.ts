/**
 * Resolve the managed `lark-cli` executable and run one command to completion.
 * @module @deepseek-ai/dsh-feishu-bridge/cli
 */

import { spawn } from 'node:child_process'
import { accessSync, constants } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { FeishuError } from './errors.ts'

/** The program name every guide and diagnostic uses. */
export const PROGRAM = 'lark-cli'

/** Bytes retained per output stream before the command is failed as oversized. */
export const OUTPUT_LIMIT_BYTES = 8 * 1024 * 1024

/**
 * Name the executable file as `@larksuite/cli` installs it.
 * @param platform - the Host platform.
 * @returns `lark-cli`, or `lark-cli.exe` on Windows.
 */
export function executableFileName(platform: NodeJS.Platform): string {
  return platform === 'win32' ? `${PROGRAM}.exe` : PROGRAM
}

/**
 * Locate the managed executable.
 * @param binDir - absolute override; defaults to the installed `@larksuite/cli` package bin directory.
 * @returns the absolute path of the executable.
 * @throws FeishuError with code `cli-missing` when the file is absent or not executable.
 */
export function resolveCliExecutable(binDir: string | undefined): string {
  const program = join(
    binDir ?? join(dirname(fileURLToPath(import.meta.resolve('@larksuite/cli/package.json'))), 'bin'),
    executableFileName(process.platform),
  )
  try {
    accessSync(program, constants.X_OK)
  } catch (error) {
    throw new FeishuError(
      'cli-missing',
      `feishu-bridge: ${program} is not executable; approve the @larksuite/cli install script or set binDir`,
      { cause: error },
    )
  }
  return program
}

/** One finished command's raw output. */
export interface CommandOutcome {
  /** Process exit code; `lark-cli` uses 0 success, 2 validation, 1 or 3/5 failures. */
  readonly exitCode: number
  /** Captured standard output, which may carry progress lines before the JSON envelope. */
  readonly stdout: string
  /** Captured standard error, where `lark-cli` writes its failure envelope. */
  readonly stderr: string
}

/** One command to run. */
export interface CommandRequest {
  /** Native arguments after the program name. */
  readonly args: readonly string[]
  /** Text written to the process's standard input, used for `--data -` payloads. */
  readonly stdin?: string
  /** Wall-clock budget; exceeding it terminates the process and fails with `timeout`. */
  readonly timeoutMs: number
  /** Caller cancellation; aborted calls terminate the process. */
  readonly signal?: AbortSignal
}

/** Runs one command to completion. */
export type CommandRunner = (request: CommandRequest) => Promise<CommandOutcome>

/**
 * Build a runner over one executable path.
 * @param resolveExecutable - resolves the executable lazily, so a missing CLI surfaces as `cli-missing` at call time rather than at load.
 * @returns the runner used by the bridge service.
 */
export function createProcessRunner(resolveExecutable: () => string): CommandRunner {
  return request => new Promise<CommandOutcome>((resolve, reject) => {
    request.signal?.throwIfAborted()
    const executable = resolveExecutable()
    const child = spawn(executable, [...request.args], { windowsHide: true, stdio: ['pipe', 'pipe', 'pipe'] })
    const stdout: Buffer[] = []
    const stderr: Buffer[] = []
    let retained = 0
    let settled = false
    const fail = (error: Error): void => {
      if (settled) return
      settled = true
      clearTimeout(timer)
      request.signal?.removeEventListener('abort', onAbort)
      reject(error)
    }
    const onAbort = (): void => {
      child.kill()
      fail(new FeishuError('timeout', `${PROGRAM} ${request.args.join(' ')} was cancelled`))
    }
    const timer = setTimeout(() => {
      child.kill()
      fail(new FeishuError('timeout', `${PROGRAM} ${request.args.join(' ')} exceeded ${request.timeoutMs} ms`))
    }, request.timeoutMs)
    request.signal?.addEventListener('abort', onAbort, { once: true })
    const collect = (chunks: Buffer[], chunk: Buffer): void => {
      retained += chunk.length
      if (retained > OUTPUT_LIMIT_BYTES) {
        child.kill()
        fail(new FeishuError('upstream', `${PROGRAM} ${request.args.join(' ')} produced more than ${OUTPUT_LIMIT_BYTES} bytes`))
        return
      }
      chunks.push(chunk)
    }
    child.stdout.on('data', (chunk: Buffer) => { collect(stdout, chunk) })
    child.stderr.on('data', (chunk: Buffer) => { collect(stderr, chunk) })
    child.on('error', (error: NodeJS.ErrnoException) => {
      fail(error.code === 'ENOENT'
        ? new FeishuError('cli-missing', `feishu-bridge: ${executable} could not be started`, { cause: error })
        : new FeishuError('upstream', `${PROGRAM} could not be started`, { cause: error }))
    })
    child.on('close', (exitCode: number | null) => {
      if (settled) return
      settled = true
      clearTimeout(timer)
      request.signal?.removeEventListener('abort', onAbort)
      resolve({
        exitCode: exitCode ?? -1,
        stdout: Buffer.concat(stdout).toString('utf8'),
        stderr: Buffer.concat(stderr).toString('utf8'),
      })
    })
    if (request.stdin !== undefined) child.stdin.end(request.stdin)
    else child.stdin.end()
  })
}

/**
 * Find the JSON object a command printed, tolerating progress lines before it.
 * @param text - one captured stream.
 * @returns the parsed object, or undefined when the stream holds no JSON object.
 */
export function jsonObjectIn(text: string): Record<string, unknown> | undefined {
  const start = text.indexOf('{')
  if (start < 0) return undefined
  const candidates = [text.slice(start)]
  const lastClose = text.lastIndexOf('}')
  if (lastClose > start) candidates.push(text.slice(start, lastClose + 1))
  for (const candidate of candidates) {
    try {
      const parsed: unknown = JSON.parse(candidate)
      if (typeof parsed === 'object' && parsed !== null && !Array.isArray(parsed)) {
        return parsed as Record<string, unknown>
      }
    } catch (error) {
      if (!(error instanceof SyntaxError)) throw error
    }
  }
  return undefined
}
