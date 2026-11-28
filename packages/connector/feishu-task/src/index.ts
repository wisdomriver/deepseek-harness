/**
 * Feishu tasks Host plugin: serves the authenticated task routes and reads tasks through the
 * shared Feishu bridge. The panel has no deployment-varying choice of its own, so this plugin
 * declares no configuration and takes the bridge's whole policy as given.
 * @module @deepseek-ai/dsh-feishu-task
 */

import type { Context } from '@deepseek-ai/cordis'
// Type-only: the ctx.connection Context merge from the Connection package's Host face.
import type {} from '@deepseek-ai/dsh-client-connection'
// Type-only: the ctx.feishuBridge Context merge from the bridge plugin.
import type {} from '@deepseek-ai/dsh-feishu-bridge'
import { taskRoutes } from './routes.ts'
import { TaskService } from './service.ts'

/** Plugin name. */
export const name = 'feishu-task'

/**
 * Register the task routes while Connection and the bridge are available.
 * @param ctx - Host context.
 */
export function apply(ctx: Context): void {
  ctx.inject(['connection', 'feishuBridge'], (scope) => {
    const service = new TaskService({ bridge: scope.feishuBridge })
    const log = (message: string): void => { ctx.logger('feishu-task').warn(message) }
    for (const route of taskRoutes({ service, bridge: scope.feishuBridge, log })) {
      scope.effect(() => scope.connection.fetch.register(route), `feishu-task: ${route.path}`)
    }
  })
}
