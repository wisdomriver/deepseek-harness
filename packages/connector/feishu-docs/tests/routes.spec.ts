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

describe('query defaults', () => {
  it('defaults recent to the last 30 days ordered by last open', async () => {
    const { routes, calls } = serviceOver(() => succeed({ results: [], has_more: false }))
    expect((await get(routes, RECENT_PATH)).status).toBe(200)
    expect(calls[0]?.args).toEqual([
      'drive', '+search', '--opened-since', '30d', '--sort', 'open_time', '--page-size', '20',
    ])
  })

  it('reads an explicit 30 or 90 day window and defaults a blank ordering', async () => {
    const { routes, calls } = serviceOver(() => succeed({ results: [], has_more: false }))
    await get(routes, `${RECENT_PATH}?days=30`)
    await get(routes, `${RECENT_PATH}?days=90&sort=`)
    expect(calls[0]?.args?.[3]).toBe('30d')
    expect(calls[1]?.args?.[3]).toBe('90d')
    expect(calls[1]?.args?.[5]).toBe('open_time')
    const invalid = await get(routes, `${RECENT_PATH}?sort=nope`)
    expect(invalid.status).toBe(400)
    expect(invalid.body).toMatchObject({ ok: false, error: { code: 'invalid-input' } })
  })

  it('rejects a search without a keyword before reading the drive', async () => {
    const { routes, calls } = serviceOver(() => succeed({ results: [], has_more: false }))
    const { status } = await get(routes, SEARCH_PATH)
    expect(status).toBe(400)
    expect(calls).toHaveLength(0)
  })

  it('drops blank type filters and accepts the `true` ownership form', async () => {
    const { routes, calls } = serviceOver(() => succeed({ results: [], has_more: false }))
    await get(routes, `${SEARCH_PATH}?query=DSH&types=,`)
    expect(calls[0]?.args).toEqual(['drive', '+search', '--query', 'DSH', '--page-size', '20'])
    await get(routes, `${SEARCH_PATH}?query=DSH&mine=true`)
    expect(calls[1]?.args).toEqual(['drive', '+search', '--query', 'DSH', '--page-size', '20', '--mine'])
  })

  it('defaults the folder listing to the cloud-space root', async () => {
    const { routes, calls } = serviceOver(() => succeed({ files: [], has_more: false }))
    expect((await get(routes, FILES_PATH)).status).toBe(200)
    expect(calls[0]?.args).toEqual(['drive', 'files', 'list'])
    const invalid = await get(routes, `${FILES_PATH}?orderBy=Nope`)
    expect(invalid.status).toBe(400)
  })

  it('defaults the document read to the outline', async () => {
    const { routes, calls } = serviceOver(() => succeed({
      document: { content: '# A', document_id: 'd1', revision_id: 1 },
    }))
    expect((await get(routes, `${DOCUMENT_PATH}?token=d1`)).status).toBe(200)
    expect(calls[0]?.args).toEqual([
      'docs', '+fetch', '--doc', 'd1', '--scope', 'outline',
      '--doc-format', 'markdown', '--detail', 'simple',
    ])
  })

  it('rejects a document read without a token', async () => {
    const { routes } = serviceOver(() => succeed({}))
    const { status } = await get(routes, DOCUMENT_PATH)
    expect(status).toBe(400)
  })
})

describe('mutation body validation', () => {
  it('rejects an unknown action before starting a process', async () => {
    const { routes, calls } = serviceOver(() => succeed({}))
    const { status, body } = await post(routes, DOCUMENT_PATH, { action: 'move', token: 'd1' })
    expect(status).toBe(400)
    expect(body).toMatchObject({ ok: false, error: { code: 'invalid-input' } })
    expect(calls).toHaveLength(0)
  })

  it('rejects a blank or non-string token', async () => {
    const { routes } = serviceOver(() => succeed({}))
    expect((await post(routes, DOCUMENT_PATH, { action: 'append', token: '   ', revisionId: 1, content: 'x' })).status)
      .toBe(400)
    expect((await post(routes, DOCUMENT_PATH, { action: 'append', token: 7, revisionId: 1, content: 'x' })).status)
      .toBe(400)
  })

  it('rejects a rename without a string title', async () => {
    const { routes } = serviceOver(() => succeed({}))
    expect((await post(routes, DOCUMENT_PATH, { action: 'rename', token: 'd1' })).status).toBe(400)
    expect((await post(routes, DOCUMENT_PATH, { action: 'rename', token: 'd1', title: 7 })).status).toBe(400)
  })

  it('rejects an append without a Markdown body', async () => {
    const { routes } = serviceOver(() => succeed({}))
    expect((await post(routes, DOCUMENT_PATH, { action: 'append', token: 'd1', revisionId: 1 })).status).toBe(400)
  })

  it('rejects a block write without a usable block id', async () => {
    const { routes } = serviceOver(() => succeed({}))
    expect((await post(routes, DOCUMENT_PATH, { action: 'delete-block', token: 'd1', revisionId: 1 })).status).toBe(400)
    expect((await post(routes, DOCUMENT_PATH, { action: 'delete-block', token: 'd1', revisionId: 1, blockId: 7 })).status)
      .toBe(400)
  })

  it('deletes one block when the body is complete', async () => {
    const { routes, calls } = serviceOver(() => succeed({
      document: { revision_id: 2 },
      result: 'success',
      warnings: [],
    }))
    const { status, body } = await post(routes, DOCUMENT_PATH, {
      action: 'delete-block',
      token: 'd1',
      revisionId: 1,
      blockId: 'b1',
    })
    expect(status).toBe(200)
    expect(body).toMatchObject({ ok: true, data: { token: 'd1', revisionId: 2 } })
    expect(calls[0]?.args).toEqual([
      'docs', '+update', '--doc', 'd1', '--command', 'block_delete', '--block-id', 'b1', '--revision-id', '1',
    ])
  })

  it('rejects a replace-block body without a string tag or content', async () => {
    const { routes } = serviceOver(() => succeed({}))
    const withoutTag = await post(routes, DOCUMENT_PATH, {
      action: 'replace-block', token: 'd1', revisionId: 1, blockId: 'b1', tag: 7, content: 'x',
    })
    expect(withoutTag.status).toBe(400)
    const withoutContent = await post(routes, DOCUMENT_PATH, {
      action: 'replace-block', token: 'd1', revisionId: 1, blockId: 'b1', tag: 'p', content: 7,
    })
    expect(withoutContent.status).toBe(400)
  })

  it('rewrites one block with the five entities escaped', async () => {
    const { routes, calls } = serviceOver(() => succeed({ document: { revision_id: 2 }, warnings: [] }))
    const { status, body } = await post(routes, DOCUMENT_PATH, {
      action: 'replace-block',
      token: 'd1',
      revisionId: 1,
      blockId: 'b1',
      tag: 'p',
      content: 'a < b & "c" \'d\' > e',
    })
    expect(status).toBe(200)
    expect(body).toMatchObject({ ok: true, data: { token: 'd1', revisionId: 2 } })
    expect(calls[0]?.args).toContain('<p>a &lt; b &amp; &quot;c&quot; &#39;d&#39; &gt; e</p>')
  })
})

describe('create body validation', () => {
  it('rejects a create without a title', async () => {
    const { routes } = serviceOver(() => succeed({}))
    expect((await post(routes, DOCUMENTS_PATH, { content: 'body' })).status).toBe(400)
  })

  it('rejects a non-string body or parent token', async () => {
    const { routes } = serviceOver(() => succeed({}))
    expect((await post(routes, DOCUMENTS_PATH, { title: 'New', content: 7 })).status).toBe(400)
    expect((await post(routes, DOCUMENTS_PATH, { title: 'New', parentToken: 7 })).status).toBe(400)
  })

  it('accepts a title alone and sends an empty Markdown body', async () => {
    const { routes, calls } = serviceOver(() => succeed({ document: { document_id: 'new1' } }))
    const { status, body } = await post(routes, DOCUMENTS_PATH, { title: 'New' })
    expect(status).toBe(200)
    expect(body).toMatchObject({ ok: true, data: { documentId: 'new1' } })
    expect(calls[0]?.args).toEqual(['docs', '+create', '--title', 'New', '--content', '-', '--doc-format', 'markdown'])
    expect(calls[0]?.stdin).toBe('')
  })

  it('creates one document under the parent token', async () => {
    const { routes, calls } = serviceOver(() => succeed({ document: { document_id: 'new2' } }))
    const { status } = await post(routes, DOCUMENTS_PATH, { title: 'New', parentToken: 'f1' })
    expect(status).toBe(200)
    expect(calls[0]?.args).toContain('--parent-token')
    expect(calls[0]?.args).toContain('f1')
  })

  it('rejects a JSON body that is not an object', async () => {
    const { routes } = serviceOver(() => succeed({}))
    const response = await routeOf(routes, DOCUMENTS_PATH).fetch(new Request(`http://localhost${DOCUMENTS_PATH}`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: '[]',
    }))
    expect(response.status).toBe(400)
  })
})
