/**
 * Wrap panel route handlers into the envelope, status mapping, and logging every panel shares.
 * @module @deepseek-ai/dsh-feishu-bridge/routes
 */

import { randomUUID } from 'node:crypto'
import { FEISHU_HTTP_STATUS, feishuCodeOf, type FeishuErrorCode } from './errors.ts'
import type { BridgeRoute, PanelId, PanelRoute } from './types.ts'

/** What the wrapper needs beyond the panel's own routes. */
export interface PanelRoutesDeps {
  /** Host-side diagnostic sink; it must never receive Feishu content. */
  readonly log?: (message: string) => void
}

/** The success or failure envelope every panel route answers with. */
export type PanelResponse<T> =
  | { readonly ok: true; readonly data: T }
  | { readonly ok: false; readonly error: { readonly code: FeishuErrorCode; readonly message: string; readonly requestId: string } }

/**
 * Build the Connection routes for one panel.
 * @param panel - panel owning these routes; it names the diagnostics and the fallback copy.
 * @param routes - declared routes whose handlers return data or throw `FeishuError`.
 * @param deps - diagnostic sink.
 * @returns routes ready for `ctx.connection.fetch.register`.
 */
export function panelRoutes(
  panel: PanelId,
  routes: readonly PanelRoute[],
  deps: PanelRoutesDeps = {},
): readonly BridgeRoute[] {
  return routes.map(route => ({
    path: route.path,
    methods: route.methods,
    requestBody: route.requestBody,
    fetch: (request: Request) => answer(panel, route, request, deps),
  }))
}

/**
 * Run one handler and shape its answer.
 * @param panel - panel owning the route.
 * @param route - the declared route.
 * @param request - authenticated request.
 * @param deps - diagnostic sink.
 * @returns the JSON response with the documented status.
 */
async function answer(
  panel: PanelId,
  route: PanelRoute,
  request: Request,
  deps: PanelRoutesDeps,
): Promise<Response> {
  const requestId = randomUUID()
  const startedAt = Date.now()
  try {
    return json({ ok: true, data: await route.fetch(request) }, 200)
  } catch (error: unknown) {
    const code = feishuCodeOf(error)
    deps.log?.(`feishu-${panel}: ${request.method} ${route.path} failed with ${code} after ${Date.now() - startedAt} ms (requestId ${requestId})`)
    return json({
      ok: false,
      error: { code, message: `feishu-${panel}: ${code}`, requestId },
    }, FEISHU_HTTP_STATUS[code])
  }
}

/**
 * Answer with one JSON body.
 * @param body - envelope to serialize.
 * @param status - HTTP status.
 * @returns the response with no-store caching.
 */
function json<T>(body: PanelResponse<T>, status: number): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' },
  })
}
