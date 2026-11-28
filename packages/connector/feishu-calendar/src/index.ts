/**
 * Feishu calendar Host plugin: serves the authenticated calendar routes and reads the
 * primary calendar through the shared Feishu bridge. The reported week start is
 * configuration, so a deployment changes it from `cordis.yml` rather than from code.
 * @module @deepseek-ai/dsh-feishu-calendar
 */

import type { Context } from '@deepseek-ai/cordis'
// Type-only: the ctx.connection Context merge from the Connection package's Host face.
import type {} from '@deepseek-ai/dsh-client-connection'
// Type-only: the ctx.feishuBridge Context merge from the bridge plugin.
import type {} from '@deepseek-ai/dsh-feishu-bridge'
import z from '@deepseek-ai/schemastery'
import { calendarRoutes } from './routes.ts'
import { CalendarService } from './service.ts'

/** Plugin name. */
export const name = 'feishu-calendar'

/** Deployment-varying choices for the Host half. */
export interface Config {
  /** Week start the panel grid renders from. */
  weekStart?: 'monday' | 'sunday'
}

/** Validates {@link Config}. */
export const Config: z<Config> = z.object({
  weekStart: z.union([z.const('monday'), z.const('sunday')]).default('monday'),
})

/**
 * Register the calendar routes while Connection and the bridge are available.
 * @param ctx - Host context.
 * @param config - reported week start.
 */
export function apply(ctx: Context, config: Config = {}): void {
  const resolved = { weekStart: config.weekStart ?? 'monday' as const }
  ctx.inject(['connection', 'feishuBridge'], (scope) => {
    const service = new CalendarService({ bridge: scope.feishuBridge, weekStart: resolved.weekStart })
    const log = (message: string): void => { ctx.logger('feishu-calendar').warn(message) }
    for (const route of calendarRoutes({ service, bridge: scope.feishuBridge, log })) {
      scope.effect(() => scope.connection.fetch.register(route), `feishu-calendar: ${route.path}`)
    }
  })
}
