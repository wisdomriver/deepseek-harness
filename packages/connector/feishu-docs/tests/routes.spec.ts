// Route contract: query validation, request bodies, envelopes, and status mapping.

import { describe, expect, it } from 'vitest'
import type { BridgeRoute } from '@deepseek-ai/dsh-feishu-bridge'
import {
  DOCUMENTS_PATH,
  DOCUMENT_PATH,
  FILES_PATH,
  RECENT_PATH,
  SEARCH_PATH,
  STATUS_PATH,
} from '../src/paths.ts'
import { authStatus, searchResult, serviceOver, succeed } from './harness.ts'

/**
 * Find one route.
 * @param routes - routes the panel registered.
 * @param path - absolute route path.
 * @returns the route.
 * @throws Error when the path is missing.
 */
function routeOf(routes: readonly BridgeRoute[], path: string): BridgeRoute {
  const route = routes.find(candidate => candidate.path === path)
  if (route === undefined) throw new Error(`missing route ${path}`)
  return route
}

/**
 * Send one GET and read its JSON envelope.
 * @param routes - routes the panel registered.
 * @param path - absolute route path with its query string.
 * @returns the status and the parsed body.
 */
async function get(routes: readonly BridgeRoute[], path: string): Promise<{ status: number; body: Record<string, unknown> }> {
  const route = routeOf(routes, path.split('?')[0] ?? path)
  const response = await route.fetch(new Request(`http://localhost${path}`))
  return { status: response.status, body: await response.json() as Record<string, unknown> }
}

/**
 * Send one POST and read its JSON envelope.
 * @param routes - routes the panel registered.
 * @param path - absolute route path.
 * @param body - JSON request body.
 * @returns the status and the parsed body.
 */
async function post(
  routes: readonly BridgeRoute[],
  path: string,
  body: unknown,
): Promise<{ status: number; body: Record<string, unknown> }> {
  const route = routeOf(routes, path)
  const response = await route.fetch(new Request(`http://localhost${path}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  }))
  return { status: response.status, body: await response.json() as Record<string, unknown> }
}

describe('GET routes', () => {
  it('answers the status envelope', async () => {
    const { routes } = serviceOver(() => authStatus())
    const { status, body } = await get(routes, STATUS_PATH)
    expect(status).toBe(200)
    expect(body).toMatchObject({
      ok: true,
      data: { cli: true, configured: true, connected: true, userName: 'Ada', missingScopes: [] },
    })
  })

  it('answers recent with days and sort, and rejects an unsupported window', async () => {
    const { routes, calls } = serviceOver(() => succeed({ results: [searchResult()], has_more: false }))
    const { status, body } = await get(routes, `${RECENT_PATH}?days=7&sort=edit`)
    expect(status).toBe(200)
    expect((body.data as { items: unknown[] }).items).toHaveLength(1)
    expect(calls[0]?.args).toEqual([
      'drive', '+search', '--opened-since', '7d', '--sort', 'edit_time', '--page-size', '20',
    ])
    const invalid = await get(routes, `${RECENT_PATH}?days=14`)
    expect(invalid.status).toBe(400)
    expect(invalid.body).toMatchObject({ ok: false, error: { code: 'invalid-input' } })
  })

  it('answers search with the query, types, and ownership filter', async () => {
    const { routes, calls } = serviceOver(() => succeed({ results: [], has_more: false, total: 0 }))
    const { status } = await get(routes, `${SEARCH_PATH}?query=DSH&types=docx,wiki&mine=1`)
    expect(status).toBe(200)
    expect(calls[0]?.args).toEqual([
      'drive', '+search', '--query', 'DSH', '--page-size', '20', '--doc-types', 'docx,wiki', '--mine',
    ])
  })

  it('answers files with the folder, ordering, and cursor', async () => {
    const { routes, calls } = serviceOver(() => succeed({ files: [], has_more: false }))
    const { status } = await get(routes, `${FILES_PATH}?folderToken=f1&orderBy=CreatedTime&pageToken=p2`)
    expect(status).toBe(200)
    expect(calls[0]?.args).toEqual([
      'drive', 'files', 'list', '--folder-token', 'f1', '--order-by', 'CreatedTime', '--page-token', 'p2',
    ])
  })

  it('answers a block read and rejects an unknown scope', async () => {
    const { routes } = serviceOver(() => succeed({
      document: { content: '<p id="p1">x</p>', document_id: 'd1', revision_id: 2 },
    }))
    const { status, body } = await get(routes, `${DOCUMENT_PATH}?token=d1&mode=blocks`)
    expect(status).toBe(200)
    expect(body).toMatchObject({
      ok: true,
      data: { mode: 'blocks', token: 'd1', revisionId: 2, blocks: [{ blockId: 'p1', tag: 'p', text: 'x', editable: true }] },
    })
    const invalid = await get(routes, `${DOCUMENT_PATH}?token=d1&mode=nope`)
    expect(invalid.status).toBe(400)
  })
})

describe('POST routes', () => {
  it('accepts an append body and answers the write result', async () => {
    const { routes, calls } = serviceOver(() => succeed({
      document: { revision_id: 3 },
      result: 'success',
      updated_blocks_count: 1,
      warnings: [],
    }))
    const { status, body } = await post(routes, DOCUMENT_PATH, {
      action: 'append',
      token: 'd1',
      revisionId: 2,
      content: '# hi',
    })
    expect(status).toBe(200)
    expect(body).toMatchObject({ ok: true, data: { token: 'd1', revisionId: 3, result: 'success', updatedBlocks: 1 } })
    expect(calls[0]?.stdin).toBe('# hi')
  })

  it('rejects a mutation without a base revision', async () => {
    const { routes } = serviceOver(() => succeed({}))
    const { status, body } = await post(routes, DOCUMENT_PATH, {
      action: 'delete-block',
      token: 'd1',
      blockId: 'b1',
    })
    expect(status).toBe(400)
    expect(body).toMatchObject({ ok: false, error: { code: 'invalid-input' } })
  })

  it('rejects a replace-block body without its tag', async () => {
    const { routes } = serviceOver(() => succeed({}))
    const { status } = await post(routes, DOCUMENT_PATH, {
      action: 'replace-block',
      token: 'd1',
      revisionId: 2,
      blockId: 'b1',
      content: 'x',
    })
    expect(status).toBe(400)
  })

  it('accepts a rename body', async () => {
    const { routes, calls } = serviceOver(() => succeed({}))
    const { status } = await post(routes, DOCUMENT_PATH, {
      action: 'rename',
      token: 'https://example.test/docx/d1',
      title: 'New',
    })
    expect(status).toBe(200)
    expect(calls[0]?.args).toEqual([
      'drive', '+update-title', '--url', 'https://example.test/docx/d1', '--title', 'New',
    ])
  })

  it('creates one document', async () => {
    const { routes, calls } = serviceOver(() => succeed({
      document: { document_id: 'new1', url: 'https://example.test/docx/new1' },
    }))
    const { status, body } = await post(routes, DOCUMENTS_PATH, { title: 'New', content: 'body' })
    expect(status).toBe(200)
    expect(body).toMatchObject({ ok: true, data: { documentId: 'new1', url: 'https://example.test/docx/new1' } })
    expect(calls[0]?.stdin).toBe('body')
  })

  it('rejects a non-JSON create body', async () => {
    const { routes } = serviceOver(() => succeed({}))
    const route = routeOf(routes, DOCUMENTS_PATH)
    const response = await route.fetch(new Request(`http://localhost${DOCUMENTS_PATH}`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: 'not json',
    }))
    expect(response.status).toBe(400)
  })
})
