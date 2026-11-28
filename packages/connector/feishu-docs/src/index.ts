/**
 * Feishu docs Host plugin: serves the authenticated cloud-document routes and reads and
 * writes documents through the shared Feishu bridge.
 * @module @deepseek-ai/dsh-feishu-docs
 */

import type { Context } from '@deepseek-ai/cordis'
// Type-only: the ctx.connection Context merge from the Connection package's Host face.
import type {} from '@deepseek-ai/dsh-client-connection'
// Type-only: the ctx.feishuBridge Context merge from the bridge plugin.
import type {} from '@deepseek-ai/dsh-feishu-bridge'
import { docsRoutes } from './routes.ts'
import { DocsService } from './service.ts'

/** Plugin name. */
export const name = 'feishu-docs'

/**
 * Register the docs routes while Connection and the bridge are available.
 * @param ctx - Host context.
 */
export function apply(ctx: Context): void {
  ctx.inject(['connection', 'feishuBridge'], (scope) => {
    const service = new DocsService({ bridge: scope.feishuBridge })
    const log = (message: string): void => { ctx.logger('feishu-docs').warn(message) }
    for (const route of docsRoutes({ service, bridge: scope.feishuBridge, log })) {
      scope.effect(() => scope.connection.fetch.register(route), `feishu-docs: ${route.path}`)
    }
  })
}
