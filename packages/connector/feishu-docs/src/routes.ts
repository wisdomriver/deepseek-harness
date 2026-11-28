/**
 * Exact Fetch routes the docs panel calls, registered inside Connection's authentication fence.
 * @module @deepseek-ai/dsh-feishu-docs/routes
 */

import { FeishuError } from '@deepseek-ai/dsh-feishu-bridge'
import type { BridgeRoute, FeishuBridge, PanelRoute } from '@deepseek-ai/dsh-feishu-bridge'
import { DOCUMENTS_PATH, DOCUMENT_PATH, FILES_PATH, RECENT_PATH, SEARCH_PATH, STATUS_PATH } from './paths.ts'
import type { DocScope, DocsService } from './service.ts'
import type { CreateDocInput, DocDays, DocMutationInput, DocSort } from './types.ts'

/** What the route handlers need. */
export interface DocsRouteDeps {
  /** Document reads and writes. */
  readonly service: DocsService
  /** The shared bridge, which wraps these routes into Connection's form. */
  readonly bridge: FeishuBridge
  /** Host-side diagnostic sink; it must never receive document content. */
  readonly log?: (message: string) => void
}

/**
 * Build the docs routes.
 * @param deps - service and diagnostic sink.
 * @returns routes in registration order, ready for `ctx.connection.fetch.register`.
 */
export function docsRoutes(deps: DocsRouteDeps): readonly BridgeRoute[] {
  const routes: readonly PanelRoute[] = [
    {
      path: STATUS_PATH,
      methods: ['GET'],
      requestBody: 'buffered',
      fetch: () => deps.service.status(),
    },
    {
      path: RECENT_PATH,
      methods: ['GET'],
      requestBody: 'buffered',
      fetch: (request) => {
        const url = new URL(request.url)
        return deps.service.recent(
          daysOf(url.searchParams.get('days')),
          sortOf(url.searchParams.get('sort')),
          refreshOf(url),
        )
      },
    },
    {
      path: SEARCH_PATH,
      methods: ['GET'],
      requestBody: 'buffered',
      fetch: (request) => {
        const url = new URL(request.url)
        return deps.service.search(
          url.searchParams.get('query') ?? '',
          {
            ...typesOf(url.searchParams.get('types')),
            ...(mineOf(url.searchParams.get('mine')) ? { mine: true } : {}),
          },
          refreshOf(url),
        )
      },
    },
    {
      path: FILES_PATH,
      methods: ['GET'],
      requestBody: 'buffered',
      fetch: (request) => {
        const url = new URL(request.url)
        return deps.service.files(
          optionalOf(url.searchParams.get('folderToken')),
          orderByOf(url.searchParams.get('orderBy')),
          optionalOf(url.searchParams.get('pageToken')),
          refreshOf(url),
        )
      },
    },
    {
      path: DOCUMENT_PATH,
      methods: ['GET', 'POST'],
      requestBody: 'buffered',
      fetch: request => (request.method === 'POST'
        ? readMutationBody(request).then(input => deps.service.mutate(input))
        : Promise.resolve(deps.service.document(
          new URL(request.url).searchParams.get('token') ?? '',
          scopeOf(new URL(request.url).searchParams.get('mode')),
        ))),
    },
    {
      path: DOCUMENTS_PATH,
      methods: ['POST'],
      requestBody: 'buffered',
      fetch: request => readCreateBody(request).then(input => deps.service.create(input)),
    },
  ]
  return deps.bridge.routes('docs', routes, deps.log)
}

/**
 * Read one mutation body.
 * @param request - authenticated request carrying JSON.
 * @returns the validated mutation.
 * @throws FeishuError with `invalid-input` for a malformed body.
 */
async function readMutationBody(request: Request): Promise<DocMutationInput> {
  const body = await readObject(request)
  const action = body.action
  if (
    action !== 'append'
    && action !== 'replace-block'
    && action !== 'delete-block'
    && action !== 'rename'
  ) {
    throw new FeishuError('invalid-input', 'action must be append, replace-block, delete-block, or rename')
  }
  const token = typeof body.token === 'string' ? body.token.trim() : ''
  if (token === '') throw new FeishuError('invalid-input', 'token is required')
  if (action === 'rename') {
    if (typeof body.title !== 'string') throw new FeishuError('invalid-input', 'title is required')
    return { action, token, title: body.title }
  }
  const revisionId = body.revisionId
  if (typeof revisionId !== 'number' || !Number.isInteger(revisionId) || revisionId < 0) {
    throw new FeishuError('invalid-input', 'revisionId must be a non-negative integer')
  }
  if (action === 'append') {
    if (typeof body.content !== 'string') throw new FeishuError('invalid-input', 'content is required')
    return { action, token, revisionId, content: body.content }
  }
  const blockId = typeof body.blockId === 'string' ? body.blockId.trim() : ''
  if (blockId === '') throw new FeishuError('invalid-input', 'blockId is required')
  if (action === 'delete-block') return { action, token, revisionId, blockId }
  if (typeof body.tag !== 'string' || body.tag.trim() === '') {
    throw new FeishuError('invalid-input', 'tag is required')
  }
  if (typeof body.content !== 'string') throw new FeishuError('invalid-input', 'content is required')
  return { action, token, revisionId, blockId, tag: body.tag, content: body.content }
}

/**
 * Read one create body.
 * @param request - authenticated request carrying JSON.
 * @returns the validated input.
 * @throws FeishuError with `invalid-input` for a malformed body.
 */
async function readCreateBody(request: Request): Promise<CreateDocInput> {
  const body = await readObject(request)
  if (typeof body.title !== 'string') throw new FeishuError('invalid-input', 'title is required')
  if (body.content !== undefined && typeof body.content !== 'string') {
    throw new FeishuError('invalid-input', 'content must be a string')
  }
  if (body.parentToken !== undefined && typeof body.parentToken !== 'string') {
    throw new FeishuError('invalid-input', 'parentToken must be a string')
  }
  return {
    title: body.title,
    ...(typeof body.content === 'string' ? { content: body.content } : {}),
    ...(typeof body.parentToken === 'string' ? { parentToken: body.parentToken } : {}),
  }
}

/**
 * Read one JSON object body.
 * @param request - authenticated request carrying JSON.
 * @returns the body as a plain record.
 * @throws FeishuError with `invalid-input` when the body is not a JSON object.
 */
async function readObject(request: Request): Promise<Record<string, unknown>> {
  const raw: unknown = await request.json().catch(() => {
    throw new FeishuError('invalid-input', 'request body must be JSON')
  })
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) {
    throw new FeishuError('invalid-input', 'request body must be a JSON object')
  }
  return raw as Record<string, unknown>
}

/**
 * Read the recent window.
 * @param value - `days` query parameter.
 * @returns the window; 30 when absent.
 * @throws FeishuError with `invalid-input` for an unsupported window.
 */
function daysOf(value: string | null): DocDays {
  if (value === null || value === '') return 30
  if (value === '7') return 7
  if (value === '30') return 30
  if (value === '90') return 90
  throw new FeishuError('invalid-input', 'days must be 7, 30, or 90')
}

/**
 * Read the recent ordering.
 * @param value - `sort` query parameter.
 * @returns the ordering; open when absent.
 * @throws FeishuError with `invalid-input` for an unknown ordering.
 */
function sortOf(value: string | null): DocSort {
  if (value === null || value === '' || value === 'open') return 'open'
  if (value === 'edit') return 'edit'
  throw new FeishuError('invalid-input', 'sort must be open or edit')
}

/**
 * Read the document scope.
 * @param value - `mode` query parameter.
 * @returns the scope; outline when absent.
 * @throws FeishuError with `invalid-input` for an unknown scope.
 */
function scopeOf(value: string | null): DocScope {
  if (value === null || value === '' || value === 'outline') return 'outline'
  if (value === 'full' || value === 'blocks') return value
  throw new FeishuError('invalid-input', 'mode must be outline, full, or blocks')
}

/**
 * Read the folder ordering.
 * @param value - `orderBy` query parameter.
 * @returns the ordering, or undefined when absent.
 * @throws FeishuError with `invalid-input` for an unknown ordering.
 */
function orderByOf(value: string | null): 'EditedTime' | 'CreatedTime' | undefined {
  if (value === null || value === '') return undefined
  if (value === 'EditedTime' || value === 'CreatedTime') return value
  throw new FeishuError('invalid-input', 'orderBy must be EditedTime or CreatedTime')
}

/**
 * Read the search type filter.
 * @param value - comma-separated `types` query parameter.
 * @returns the filter, or an empty object when absent.
 */
function typesOf(value: string | null): { readonly types?: readonly string[] } {
  if (value === null || value === '') return {}
  const types = value.split(',').map(type => type.trim()).filter(type => type !== '')
  return types.length === 0 ? {} : { types }
}

/**
 * Read the owned-only flag.
 * @param value - `mine` query parameter.
 * @returns true for `1` and `true`.
 */
function mineOf(value: string | null): boolean {
  return value === '1' || value === 'true'
}

/**
 * Read the cache bypass flag.
 * @param url - authenticated request URL.
 * @returns true when the panel asked for a fresh read.
 */
function refreshOf(url: URL): boolean {
  return mineOf(url.searchParams.get('refresh'))
}

/**
 * Read one optional trimmed query parameter.
 * @param value - query parameter value.
 * @returns the trimmed value, or undefined when absent or blank.
 */
function optionalOf(value: string | null): string | undefined {
  const trimmed = value?.trim() ?? ''
  return trimmed === '' ? undefined : trimmed
}
