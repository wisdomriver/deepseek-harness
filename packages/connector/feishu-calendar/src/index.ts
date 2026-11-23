/**
 * Feishu calendar Host plugin: serves the authenticated calendar routes and runs
 * `lark-cli` for the primary calendar behind them. The CLI location, command
 * budgets, concurrency gate, and reported week start are configuration, so a
 * deployment changes them from `cordis.yml` rather than from code.
 * @module @deepseek-ai/dsh-feishu-calendar
 */

import type { Context } from '@deepseek-ai/cordis'
// Type-only: the ctx.connection Context merge from the Connection package's Host face.
import type {} from '@deepseek-ai/dsh-client-connection'
import z from '@deepseek-ai/schemastery'
import { createProcessRunner, resolveCliExecutable } from './cli.ts'
import { calendarRoutes } from './routes.ts'
import { CalendarService } from './service.ts'

/** Plugin name. */
export const name = 'feishu-calendar'

/** Deployment-varying choices for the Host half. */
export interface Config {
  /** Absolute directory holding `lark-cli`; defaults to the installed `@larksuite/cli` package. */
  binDir?: string
  /** Budget for one read command, in milliseconds. */
  readTimeoutMs?: number
  /** Budget for one write command, in milliseconds. */
  writeTimeoutMs?: number
  /** CLI processes allowed to run at once. */
  maxConcurrency?: number
  /** Requests allowed to wait for a slot before the next fails with `busy`. */
  queueLimit?: number
  /** Week start the panel grid renders from. */
  weekStart?: 'monday' | 'sunday'
}

/** Validates {@link Config}. */
export const Config: z<Config> = z.object({
  binDir: z.string().min(1),
  readTimeoutMs: z.number().step(1).min(1000).max(120_000).default(15_000),
  writeTimeoutMs: z.number().step(1).min(1000).max(300_000).default(30_000),
  maxConcurrency: z.number().step(1).min(1).max(8).default(2),
  queueLimit: z.number().step(1).min(0).max(64).default(8),
  weekStart: z.union([z.const('monday'), z.const('sunday')]).default('monday'),
})

/** {@link Config} with every default resolved; the one place defaults are applied. */
export interface ResolvedConfig {
  readonly binDir: string | undefined
  readonly readTimeoutMs: number
  readonly writeTimeoutMs: number
  readonly maxConcurrency: number
  readonly queueLimit: number
  readonly weekStart: 'monday' | 'sunday'
}

/**
 * Resolve deployment choices once, so the service never defaults on its own.
 * @param config - validated or partial plugin configuration.
 * @returns every field with its default applied.
 */
export function resolveConfig(config: Config = {}): ResolvedConfig {
  return {
    binDir: config.binDir,
    readTimeoutMs: config.readTimeoutMs ?? 15_000,
    writeTimeoutMs: config.writeTimeoutMs ?? 30_000,
    maxConcurrency: config.maxConcurrency ?? 2,
    queueLimit: config.queueLimit ?? 8,
    weekStart: config.weekStart ?? 'monday',
  }
}

/**
 * Register the calendar routes while a Connection service exists.
 * @param ctx - Host context.
 * @param config - CLI location, command budgets, gate sizes, and week start.
 */
export function apply(ctx: Context, config: Config = {}): void {
  const resolved = resolveConfig(config)
  let executable: string | undefined
  const service = new CalendarService({
    run: createProcessRunner(() => {
      executable ??= resolveCliExecutable(resolved.binDir)
      return executable
    }),
    readTimeoutMs: resolved.readTimeoutMs,
    writeTimeoutMs: resolved.writeTimeoutMs,
    maxConcurrency: resolved.maxConcurrency,
    queueLimit: resolved.queueLimit,
    weekStart: resolved.weekStart,
  })
  const log = (message: string): void => { ctx.logger('feishu-calendar').warn(message) }
  ctx.inject(['connection'], (scope) => {
    for (const route of calendarRoutes({ service, log })) {
      scope.effect(() => scope.connection.fetch.register(route), `feishu-calendar: ${route.path}`)
    }
  })
}
