// Bridge service behavior over a recorded command runner: envelope interpretation,
// mode-specific budgets, the single retry rule, the shared gate, status, and scope checks.

import { describe, expect, it } from 'vitest'
import type { CommandOutcome, CommandRequest, CommandRunner } from '../src/cli.ts'
import { FeishuError } from '../src/errors.ts'
import { FeishuBridgeService } from '../src/service.ts'
import type { BridgeServiceOptions } from '../src/service.ts'

/** Successful envelope for one command. */
function succeed(data: unknown, extra: Record<string, unknown> = {}): CommandOutcome {
  return { exitCode: 0, stdout: JSON.stringify({ ok: true, identity: 'user', data, ...extra }), stderr: '' }
}

/** Failure envelope `lark-cli` writes to standard error. */
function fail(error: Record<string, unknown>, exitCode = 1): CommandOutcome {
  return { exitCode, stdout: '', stderr: JSON.stringify({ ok: false, identity: 'user', error }) }
}

/** Account envelope the CLI answers `auth status` with. */
function authStatus(options: { available?: boolean; status?: string; scope?: string } = {}): CommandOutcome {
  return {
    exitCode: 0,
    stdout: JSON.stringify({
      appId: 'cli_test',
      identities: {
        user: {
          status: options.status ?? 'ready',
          available: options.available ?? true,
          userName: 'Tester',
          openId: 'ou_test',
          scope: options.scope ?? 'task:task:read task:task:write',
        },
      },
    }),
    stderr: '',
  }
}

/** Build a service over a runner that records every request. */
function serviceOver(
  answers: (request: CommandRequest) => CommandOutcome | Promise<CommandOutcome>,
  overrides: Partial<BridgeServiceOptions> = {},
) {
  const calls: CommandRequest[] = []
  const run: CommandRunner = async (request) => {
    calls.push(request)
    return answers(request)
  }
  const service = new FeishuBridgeService({
    run,
    readTimeoutMs: 15_000,
    writeTimeoutMs: 30_000,
    maxConcurrency: 2,
    queueLimit: 8,
    ...overrides,
  })
  return { calls, service }
}

describe('run', () => {
  it('returns the envelope data and applies the read budget by mode', async () => {
    const { calls, service } = serviceOver(() => succeed([{ guid: 'g1' }]))
    const result = await service.run({ command: ['task', '+search'], mode: 'read' })
    expect(result.data).toEqual([{ guid: 'g1' }])
    expect(calls[0]?.timeoutMs).toBe(15_000)
  })

  it('applies the write budget and forwards stdin', async () => {
    const { calls, service } = serviceOver(() => succeed({}))
    await service.run({ command: ['docs', '+update', '--content', '-'], mode: 'write', stdin: 'body' })
    expect(calls[0]?.timeoutMs).toBe(30_000)
    expect(calls[0]?.stdin).toBe('body')
  })

  it('lets an explicit timeout override the mode default', async () => {
    const { calls, service } = serviceOver(() => succeed({}))
    await service.run({ command: ['task', '+search'], mode: 'read', timeoutMs: 1234 })
    expect(calls[0]?.timeoutMs).toBe(1234)
  })

  it('maps a failure envelope to the stable code', async () => {
    const { service } = serviceOver(() => fail({ type: 'config', subtype: 'not_configured', message: 'not configured' }))
    await expect(service.run({ command: ['auth', 'status', '--json'], mode: 'read' }))
      .rejects.toMatchObject({ code: 'not-configured' })
  })

  it('retries one read after a timeout and succeeds', async () => {
    const answers = [new FeishuError('timeout', 'too slow'), succeed({ ok: 1 })]
    let index = 0
    const { calls, service } = serviceOver(() => {
      const next = answers[index]
      index += 1
      if (next instanceof Error) throw next
      return next as CommandOutcome
    })
    const result = await service.run({ command: ['task', '+search'], mode: 'read', retry: 'transient' })
    expect(result.data).toEqual({ ok: 1 })
    expect(calls).toHaveLength(2)
  })

  it('never retries a write', async () => {
    let index = 0
    const { calls, service } = serviceOver(() => {
      index += 1
      throw new FeishuError('timeout', 'too slow')
    })
    await expect(service.run({ command: ['docs', '+update'], mode: 'write', retry: 'transient' }))
      .rejects.toMatchObject({ code: 'timeout' })
    expect(calls).toHaveLength(1)
    expect(index).toBe(1)
  })

  it('fails with busy when the wait queue is full', async () => {
    let release: (() => void) | undefined
    const held = new Promise<void>((resolve) => { release = resolve })
    const { service } = serviceOver(async () => {
      await held
      return succeed({})
    }, { maxConcurrency: 1, queueLimit: 0 })
    const first = service.run({ command: ['task', '+search'], mode: 'read' })
    await expect(service.run({ command: ['task', '+search'], mode: 'read' })).rejects.toMatchObject({ code: 'busy' })
    release?.()
    await first
  })
})

describe('status', () => {
  it('reports the signed-in identity and granted scopes', async () => {
    const { service } = serviceOver(() => authStatus({ scope: 'task:task:read calendar:calendar:read' }))
    const facts = await service.status()
    expect(facts).toMatchObject({ cli: true, configured: true, connected: true, userName: 'Tester', openId: 'ou_test' })
    expect(facts.scopes).toEqual(['task:task:read', 'calendar:calendar:read'])
  })

  it('splits a scope list that repeats whitespace and reports an anonymous identity without name or id', async () => {
    const { service } = serviceOver(() => ({
      exitCode: 0,
      stdout: JSON.stringify({
        appId: 'cli_test',
        identities: { user: { status: 'ready', available: true, scope: ' task:task:read  docs:docs:read ' } },
      }),
      stderr: '',
    }))
    const facts = await service.status()
    expect(facts.scopes).toEqual(['task:task:read', 'docs:docs:read'])
    expect(facts).not.toHaveProperty('userName')
    expect(facts).not.toHaveProperty('openId')
    expect(facts).toMatchObject({ cli: true, configured: true, connected: true })
  })

  it('reports no scopes when the answer carries none', async () => {
    const { service } = serviceOver(() => ({
      exitCode: 0,
      stdout: JSON.stringify({ appId: 'cli_test', identities: { user: { status: 'ready', available: true } } }),
      stderr: '',
    }))
    await expect(service.status()).resolves.toMatchObject({ scopes: [] })
  })

  it('reports a signed-out identity as not connected', async () => {
    const { service } = serviceOver(() => authStatus({ available: false, status: 'expired' }))
    await expect(service.status()).resolves.toMatchObject({ connected: false })
  })

  it('caches the answer for the status window', async () => {
    const { calls, service } = serviceOver(() => authStatus())
    await service.status()
    await service.status()
    expect(calls).toHaveLength(1)
  })

  it('maps a failure envelope through the stable codes', async () => {
    const { service } = serviceOver(() => fail({ type: 'config', subtype: 'not_configured', message: 'x' }))
    await expect(service.status()).rejects.toMatchObject({ code: 'not-configured' })
  })
})

describe('requireScopes', () => {
  it('passes when every scope was granted', async () => {
    const { service } = serviceOver(() => authStatus({ scope: 'task:task:read' }))
    await expect(service.requireScopes('task', ['task:task:read'])).resolves.toBeUndefined()
  })

  it('lists the missing scopes', async () => {
    const { service } = serviceOver(() => authStatus({ scope: 'task:task:read' }))
    await expect(service.requireScopes('docs', ['task:task:read', 'docs:document.content:read']))
      .rejects.toMatchObject({ code: 'permission-denied' })
    await expect(service.requireScopes('docs', ['docs:document.content:read']))
      .rejects.toThrow(/docs:document\.content:read/)
  })
})

describe('routes', () => {
  const panelRoute = {
    path: '/api/feishu-docs/recent',
    methods: ['GET'] as const,
    requestBody: 'buffered' as const,
    fetch: async (): Promise<unknown> => { throw new FeishuError('not-found', 'no such document') },
  }

  it('wraps a panel route set into the answer Connection registers', async () => {
    const { service } = serviceOver(() => succeed({}))
    const routes = service.routes('docs', [panelRoute])
    expect(routes.map(route => [route.path, route.methods, route.requestBody]))
      .toEqual([['/api/feishu-docs/recent', ['GET'], 'buffered']])
    const answer = await routes[0]!.fetch(new Request('https://host/api/feishu-docs/recent'))
    expect(answer.status).toBe(404)
    await expect(answer.json()).resolves.toMatchObject({ ok: false, error: { code: 'not-found' } })
  })

  it('forwards diagnostics to the panel log when one is given', async () => {
    const lines: string[] = []
    const { service } = serviceOver(() => succeed({}))
    const routes = service.routes('docs', [panelRoute], line => lines.push(line))
    await routes[0]!.fetch(new Request('https://host/api/feishu-docs/recent'))
    expect(lines).toHaveLength(1)
    expect(lines[0]).toContain('feishu-docs: GET /api/feishu-docs/recent failed with not-found')
  })
})
