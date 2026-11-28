// Plugin wiring: the service is provided under `ctx.feishuBridge`, the config reaches the gate and the
// budgets, and the executable is resolved once and then run as a real process.

import { chmodSync, copyFileSync, mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { Context } from '@deepseek-ai/cordis'
import { afterEach, describe, expect, it } from 'vitest'
import { executableFileName } from '../src/cli.ts'
import * as Bridge from '../src/index.ts'

/** Directories created by one test, removed afterwards. */
const created: string[] = []

/** Contexts started by one test, disposed afterwards. */
const started: Context[] = []

afterEach(async () => {
  for (const ctx of started.splice(0)) await ctx.fiber.dispose()
  for (const dir of created.splice(0)) rmSync(dir, { recursive: true, force: true })
})

/**
 * Create a bin directory holding a runnable `lark-cli`.
 *
 * The bridge resolves and spawns the file without reading its name, so this host's own Node binary
 * stands in for the managed CLI: every command below then runs a real process through the real runner.
 * @returns the absolute directory to configure as `binDir`.
 */
function binDirWithRunnableCli(): string {
  const dir = mkdtempSync(join(tmpdir(), 'feishu-bridge-bin-'))
  created.push(dir)
  const executable = join(dir, executableFileName(process.platform))
  copyFileSync(process.execPath, executable)
  if (process.platform !== 'win32') chmodSync(executable, 0o755)
  return dir
}

/** One command the stand-in CLI answers with a success envelope holding `data`. */
function envelopeCommand(data: unknown): string[] {
  return ['-e', `process.stdout.write(${JSON.stringify(JSON.stringify({ ok: true, data }))})`]
}

/** Mount the plugin on a fresh Context. */
async function mount(config?: Bridge.Config): Promise<Context> {
  const ctx = new Context()
  started.push(ctx)
  await ctx.plugin(Bridge, config)
  return ctx
}

describe('Config', () => {
  it('defaults the budgets, gate sizes, and cache limit', () => {
    expect(Bridge.Config({})).toMatchObject({
      readTimeoutMs: 15_000,
      writeTimeoutMs: 30_000,
      maxConcurrency: 2,
      queueLimit: 8,
      cacheLimit: 32,
    })
    expect(Bridge.Config({}).binDir).toBeUndefined()
  })

  it('accepts deployment overrides inside the documented bounds', () => {
    expect(Bridge.Config({ binDir: '/opt/lark/bin', maxConcurrency: 8, queueLimit: 64, cacheLimit: 512 }))
      .toMatchObject({ binDir: '/opt/lark/bin', maxConcurrency: 8, queueLimit: 64, cacheLimit: 512 })
    expect(() => Bridge.Config({ maxConcurrency: 0 })).toThrow()
    expect(() => Bridge.Config({ readTimeoutMs: 10 })).toThrow()
    expect(() => Bridge.Config({ binDir: '' })).toThrow()
  })
})

describe('bridge plugin', () => {
  it('provides the shared service and runs the resolved CLI without resolving it twice', async () => {
    const ctx = await mount({
      binDir: binDirWithRunnableCli(),
      readTimeoutMs: 20_000,
      writeTimeoutMs: 40_000,
      maxConcurrency: 2,
      queueLimit: 8,
      cacheLimit: 4,
    })
    const bridge = ctx.feishuBridge

    await expect(bridge.run({ command: envelopeCommand({ events: [] }), mode: 'read' }))
      .resolves.toMatchObject({ data: { events: [] }, exitCode: 0 })
    // The second call reuses the executable the first call resolved.
    await expect(bridge.run({ command: envelopeCommand({ events: [1] }), mode: 'read' }))
      .resolves.toMatchObject({ data: { events: [1] } })
  })

  it('applies the configured gate: one slot and no queue makes the second call busy', async () => {
    const ctx = await mount({ binDir: binDirWithRunnableCli(), maxConcurrency: 1, queueLimit: 0 })
    const slow = ['-e', 'setTimeout(() => process.stdout.write(JSON.stringify({ ok: true, data: null })), 200)']
    const first = ctx.feishuBridge.run({ command: slow, mode: 'read' })
    await expect(ctx.feishuBridge.run({ command: slow, mode: 'read' })).rejects.toMatchObject({ code: 'busy' })
    await expect(first).resolves.toMatchObject({ data: null })
  })

  it('defaults every choice when the deployment configures none', async () => {
    // The Loader validates Config, so these fallbacks serve a direct `apply(ctx)` call.
    const ctx = new Context()
    started.push(ctx)
    Bridge.apply(ctx)
    const routes = ctx.feishuBridge.routes('task', [{
      path: '/api/feishu-task/tasks',
      methods: ['GET'],
      requestBody: 'buffered',
      fetch: async () => ({ tasks: [] }),
    }])
    const answer = await routes[0]!.fetch(new Request('https://host/api/feishu-task/tasks'))
    await expect(answer.json()).resolves.toEqual({ ok: true, data: { tasks: [] } })
    expect(ctx.feishuBridge.cache.get('task:list')).toBeUndefined()
  })
})
