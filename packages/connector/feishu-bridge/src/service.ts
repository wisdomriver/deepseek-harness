/**
 * The bridge service: one CLI process gate, one shared cache, and stable failure codes
 * for every Feishu panel plugin.
 * @module @deepseek-ai/dsh-feishu-bridge/service
 */

import { BridgeCache } from './cache.ts'
import type { CommandRunner } from './cli.ts'
import { asRecord, asString, envelopeFailure, parseEnvelope, requireEnvelopeOk } from './envelope.ts'
import { FeishuError } from './errors.ts'
import { ConcurrencyGate } from './limits.ts'
import { panelRoutes } from './routes.ts'
import type {
  AuthFacts,
  BridgeRoute,
  CacheStore,
  CliRequest,
  CliResult,
  FeishuBridge,
  PanelId,
  PanelRoute,
} from './types.ts'

/** Account facts stay fresh this long; status polling runs every 30 s. */
export const STATUS_TTL_MS = 30_000

/** Bridge service dependencies. */
export interface BridgeServiceOptions {
  /** Runs one `lark-cli` command. */
  readonly run: CommandRunner
  /** Budget for read commands. */
  readonly readTimeoutMs: number
  /** Budget for write commands. */
  readonly writeTimeoutMs: number
  /** CLI processes allowed to run at once across every panel. */
  readonly maxConcurrency: number
  /** Callers allowed to wait for a slot before the next one fails with `busy`. */
  readonly queueLimit: number
  /** Entries retained in the shared cache. */
  readonly cacheLimit?: number
}

/** Runs `lark-cli` for every Feishu panel through one gate and one cache. */
export class FeishuBridgeService implements FeishuBridge {
  /** Values shared by every panel, keyed with the panel's own prefix. */
  readonly cache: CacheStore

  /** The one process gate. */
  private readonly gate: ConcurrencyGate

  /**
   * @param options - command runner, budgets, gate sizes, and cache limit.
   */
  constructor(private readonly options: BridgeServiceOptions) {
    this.cache = new BridgeCache(options.cacheLimit)
    this.gate = new ConcurrencyGate(options.maxConcurrency, options.queueLimit)
  }

  /**
   * Run one command inside the shared gate and return its envelope data.
   * @param request - command, mode, optional stdin, and optional overrides.
   * @returns the envelope's data, meta, exit code, and duration.
   * @throws FeishuError mapped from the CLI failure, `busy`, or `timeout`.
   */
  async run(request: CliRequest): Promise<CliResult> {
    const label = request.label ?? request.command.slice(0, 2).join(' ')
    const timeoutMs = request.timeoutMs
      ?? (request.mode === 'write' ? this.options.writeTimeoutMs : this.options.readTimeoutMs)
    const retries = request.retry === 'transient' && request.mode === 'read' ? 1 : 0
    const startedAt = Date.now()
    for (let attempt = 0; ; attempt += 1) {
      try {
        const outcome = await this.gate.run(() => this.options.run({
          args: request.command,
          timeoutMs,
          ...(request.stdin === undefined ? {} : { stdin: request.stdin }),
        }))
        const envelope = parseEnvelope(outcome, label)
        requireEnvelopeOk(envelope, label)
        return {
          data: envelope.data,
          meta: envelope.meta,
          exitCode: outcome.exitCode,
          durationMs: Date.now() - startedAt,
        }
      } catch (error: unknown) {
        if (attempt >= retries || !isTransient(error)) throw error
      }
    }
  }

  /**
   * Read the account's CLI, application, and sign-in facts.
   * @returns the facts every panel maps onto its five states.
   * @throws FeishuError when the CLI is missing or its answer cannot be interpreted.
   */
  status(): Promise<AuthFacts> {
    return this.cache.memo('auth:status', STATUS_TTL_MS, async () => {
      const outcome = await this.gate.run(() => this.options.run({
        args: ['auth', 'status', '--json'],
        timeoutMs: this.options.readTimeoutMs,
      }))
      const envelope = parseEnvelope(outcome, 'auth status')
      if (envelope.ok === false) throw envelopeFailure(envelope, 'auth status')
      const identities = asRecord(envelope.identities)
      const user = asRecord(identities?.user)
      const scope = asString(user?.scope) ?? ''
      const scopes = scope.split(/\s+/).filter(part => part !== '')
      const available = user?.available === true
      const userName = asString(user?.userName)
      const openId = asString(user?.openId)
      return {
        cli: true,
        configured: true,
        connected: available && asString(user?.status) === 'ready',
        scopes,
        ...(userName === undefined ? {} : { userName }),
        ...(openId === undefined ? {} : { openId }),
      } satisfies AuthFacts
    })
  }

  /**
   * Require the signed-in token to hold every listed scope.
   * @param panel - panel asking, for the diagnostic.
   * @param required - scopes without which the panel cannot answer its own reads.
   * @throws FeishuError with `permission-denied` listing the missing scopes.
   */
  async requireScopes(panel: PanelId, required: readonly string[]): Promise<void> {
    const facts = await this.status()
    const granted = new Set(facts.scopes)
    const missing = required.filter(scope => !granted.has(scope))
    if (missing.length > 0) {
      throw new FeishuError('permission-denied', `feishu-${panel}: missing scopes ${missing.join(', ')}`)
    }
  }

  /**
   * Wrap one panel's declared routes into Connection's structural form.
   * @param panel - panel owning these routes; it names the diagnostics and fallback copy.
   * @param routes - declared routes whose handlers return data or throw `FeishuError`.
   * @param log - optional Host-side diagnostic sink.
   * @returns routes ready for `ctx.connection.fetch.register`.
   */
  routes(panel: PanelId, routes: readonly PanelRoute[], log?: (message: string) => void): readonly BridgeRoute[] {
    return panelRoutes(panel, routes, log === undefined ? {} : { log })
  }
}

/**
 * Test whether one failure may be retried once.
 * @param error - value caught from one attempt.
 * @returns true only for a timed-out command.
 */
function isTransient(error: unknown): boolean {
  return error instanceof FeishuError && error.code === 'timeout'
}
