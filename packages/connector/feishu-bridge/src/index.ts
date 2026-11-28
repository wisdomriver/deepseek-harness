/**
 * Feishu bridge Host plugin: provides `ctx.feishuBridge`, the one `lark-cli` process gate,
 * shared cache, and stable failure codes every Feishu panel plugin uses. The CLI location,
 * command budgets, and gate sizes are configuration, so a deployment changes them from
 * `cordis.yml` rather than from code.
 * @module @deepseek-ai/dsh-feishu-bridge
 */

import type { Context } from '@deepseek-ai/cordis'
import z from '@deepseek-ai/schemastery'
import { createProcessRunner, resolveCliExecutable } from './cli.ts'
import { FeishuBridgeService } from './service.ts'
import type { FeishuBridge } from './types.ts'

declare module '@deepseek-ai/cordis' {
  interface Context {
    /** The shared Feishu CLI bridge, provided by this plugin. */
    feishuBridge: FeishuBridge
  }
}

/** Plugin name. */
export const name = 'feishu-bridge'

/** Deployment-varying choices for the bridge. */
export interface Config {
  /** Absolute directory holding `lark-cli`; defaults to the installed `@larksuite/cli` package. */
  binDir?: string
  /** Budget for one read command, in milliseconds. */
  readTimeoutMs?: number
  /** Budget for one write command, in milliseconds. */
  writeTimeoutMs?: number
  /** CLI processes allowed to run at once across every panel. */
  maxConcurrency?: number
  /** Callers allowed to wait for a slot before the next one fails with `busy`. */
  queueLimit?: number
  /** Entries retained in the shared cache. */
  cacheLimit?: number
}

/** Validates {@link Config}. */
export const Config: z<Config> = z.object({
  binDir: z.string().min(1),
  readTimeoutMs: z.number().step(1).min(1000).max(120_000).default(15_000),
  writeTimeoutMs: z.number().step(1).min(1000).max(300_000).default(30_000),
  maxConcurrency: z.number().step(1).min(1).max(8).default(2),
  queueLimit: z.number().step(1).min(0).max(64).default(8),
  cacheLimit: z.number().step(1).min(1).max(512).default(32),
})

/**
 * Provide the shared bridge service.
 * @param ctx - Host context.
 * @param config - CLI location, command budgets, gate sizes, and cache limit.
 */
export function apply(ctx: Context, config: Config = {}): void {
  // Defaults live here, once: the service never defaults on its own.
  const resolved = {
    binDir: config.binDir,
    readTimeoutMs: config.readTimeoutMs ?? 15_000,
    writeTimeoutMs: config.writeTimeoutMs ?? 30_000,
    maxConcurrency: config.maxConcurrency ?? 2,
    queueLimit: config.queueLimit ?? 8,
    cacheLimit: config.cacheLimit ?? 32,
  }
  let executable: string | undefined
  const service = new FeishuBridgeService({
    run: createProcessRunner(() => {
      executable ??= resolveCliExecutable(resolved.binDir)
      return executable
    }),
    readTimeoutMs: resolved.readTimeoutMs,
    writeTimeoutMs: resolved.writeTimeoutMs,
    maxConcurrency: resolved.maxConcurrency,
    queueLimit: resolved.queueLimit,
    cacheLimit: resolved.cacheLimit,
  })
  ctx.provide('feishuBridge', service)
}

export { FeishuError } from './errors.ts'
export type { FeishuErrorCode } from './errors.ts'
export type { PanelRoutesDeps, PanelResponse } from './routes.ts'
export type { CommandOutcome, CommandRequest, CommandRunner } from './cli.ts'
export type {
  AuthFacts,
  BridgeRoute,
  CacheStore,
  CliRequest,
  CliResult,
  FeishuBridge,
  PanelId,
  PanelRoute,
  RouteMethod,
} from './types.ts'
