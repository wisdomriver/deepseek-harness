// Panel controller behavior over recorded route answers: list states, search, folders,
// document reads, block edits, conflicts, partial success, rename, and creation.

import { describe, expect, it, vi } from 'vitest'
import { DocsController } from '../src/client/controller.ts'
import {
  DOCUMENT_ROUTE,
  DOCUMENTS_ROUTE,
  FILES_ROUTE,
  RECENT_ROUTE,
  SEARCH_ROUTE,
  STATUS_ROUTE,
} from '../src/paths.ts'
import type { DocItem } from '../src/types.ts'

/** One route answer. */
type Answer =
  | { readonly ok: true; readonly data: unknown }
  | { readonly ok: false; readonly error: { readonly code: string; readonly message: string; readonly requestId: string } }

/** Successful answer. */
function ok(data: unknown): Answer {
  return { ok: true, data }
}

/** Failed answer. */
function failure(code: string): Answer {
  return { ok: false, error: { code, message: code, requestId: 'r1' } }
}

/** The listed document every spec opens. */
const ITEM: DocItem = {
  token: 'd1',
  title: [{ text: 'Doc', highlighted: false }],
  type: 'docx',
  entityType: 'DOC',
  isFolder: false,
  url: 'https://example.test/docx/d1',
  ownerName: 'Ada',
}

/** Recorded server answers. */
interface Answers {
  status: Answer
  recent?: Answer
  search?: Answer
  files?: Answer
  document?: (mode: string) => Answer
  mutate?: (body: Record<string, unknown>, call: number) => Answer
  create?: Answer
}

/** Build a fetcher and record every route and parsed body. */
function server(answers: Answers) {
  const calls: { route: string; body?: Record<string, unknown> }[] = []
  let mutations = 0
  const fetcher: typeof fetch = async (input, init) => {
    const route = String(input)
    const url = new URL(route, 'http://localhost')
    const body = init?.body === undefined || init.body === null
      ? undefined
      : JSON.parse(String(init.body)) as Record<string, unknown>
    calls.push({ route, ...(body === undefined ? {} : { body }) })
    const path = url.pathname.replace(/^\//, '')
    let answer: Answer | undefined
    if (path === STATUS_ROUTE) answer = answers.status
    else if (path === RECENT_ROUTE) answer = answers.recent
    else if (path === SEARCH_ROUTE) answer = answers.search
    else if (path === FILES_ROUTE) answer = answers.files
    else if (path === DOCUMENT_ROUTE && init?.method === 'POST') {
      answer = answers.mutate?.(body ?? {}, mutations)
      mutations += 1
    } else if (path === DOCUMENT_ROUTE) answer = answers.document?.(url.searchParams.get('mode') ?? '')
    else if (path === DOCUMENTS_ROUTE) answer = answers.create
    if (answer === undefined) {
      return new Response(JSON.stringify(failure('not-found')), { status: 404 })
    }
    return new Response(JSON.stringify(answer), { status: answer.ok ? 200 : answer.error.code === 'conflict' ? 409 : 500 })
  }
  return { calls, fetcher }
}

/** A connected status answer. */
function connected(): Answer {
  return ok({ cli: true, configured: true, connected: true, userName: 'Ada', missingScopes: [] })
}

/** A recent page with one row. */
function page(items: readonly unknown[] = [ITEM]): Answer {
  return ok({ items, hasMore: false, fetchedAt: 'now' })
}

/** The document reads the drawer performs. */
function documents(mode: string): Answer {
  return documentsAt(() => 2)(mode)
}

/**
 * Build the document reads over a mutable revision.
 * @param revision - current revision the blocks read reports.
 * @returns the read function.
 */
function documentsAt(revision: () => number): (mode: string) => Answer {
  return (mode) => {
    if (mode === 'blocks') {
      return ok({
        mode: 'blocks',
        token: 'd1',
        revisionId: revision(),
        blocks: [
          { blockId: 'p1', tag: 'p', text: 'old', editable: true },
          { blockId: 'i1', tag: 'img', text: '', editable: false },
        ],
      })
    }
    if (mode === 'full') {
      return ok({ mode: 'full', token: 'd1', content: '# Body', truncated: true, revisionId: revision() })
    }
    return ok({ mode: 'outline', token: 'd1', content: '## A', truncated: false, revisionId: revision() })
  }
}

describe('DocsController list', () => {
  it('reads status and the recent page, then reports ready', async () => {
    const { calls, fetcher } = server({ status: connected(), recent: page() })
    const controller = new DocsController(fetcher)
    controller.load()
    await vi.waitFor(() => { expect(controller.store.getSnapshot().phase).toBe('ready') })
    expect(controller.store.getSnapshot().items).toHaveLength(1)
    expect(controller.store.getSnapshot().userName).toBe('Ada')
    expect(calls[0]?.route).toBe(STATUS_ROUTE)
    expect(calls[1]?.route.startsWith(`${RECENT_ROUTE}?days=30&sort=open`)).toBe(true)
  })

  it('maps a missing CLI to the no-cli state', async () => {
    const { fetcher } = server({ status: failure('cli-missing') })
    const controller = new DocsController(fetcher)
    controller.load()
    await vi.waitFor(() => { expect(controller.store.getSnapshot().phase).toBe('no-cli') })
  })

  it('maps a signed-out account to disconnected', async () => {
    const { fetcher } = server({
      status: ok({ cli: true, configured: true, connected: false, missingScopes: [] }),
    })
    const controller = new DocsController(fetcher)
    controller.load()
    await vi.waitFor(() => { expect(controller.store.getSnapshot().phase).toBe('disconnected') })
  })

  it('maps missing scopes to the permission state', async () => {
    const { fetcher } = server({
      status: ok({ cli: true, configured: true, connected: true, missingScopes: ['docx:document:readonly'] }),
    })
    const controller = new DocsController(fetcher)
    controller.load()
    await vi.waitFor(() => { expect(controller.store.getSnapshot().phase).toBe('permission') })
    expect(controller.store.getSnapshot().missingScopes).toEqual(['docx:document:readonly'])
  })

  it('reports an empty recent view', async () => {
    const { fetcher } = server({ status: connected(), recent: page([]) })
    const controller = new DocsController(fetcher)
    controller.load()
    await vi.waitFor(() => { expect(controller.store.getSnapshot().phase).toBe('empty') })
  })

  it('submits a search and encodes the keyword', async () => {
    const { calls, fetcher } = server({ status: connected(), search: page([]) })
    const controller = new DocsController(fetcher)
    controller.actions.search('DSH 文档')
    await vi.waitFor(() => { expect(controller.store.getSnapshot().phase).toBe('empty') })
    expect(controller.store.getSnapshot().view).toBe('search')
    expect(calls[1]?.route).toContain(`${SEARCH_ROUTE}?query=DSH+%E6%96%87%E6%A1%A3`)
  })

  it('does not send a query longer than 30 code points', async () => {
    const { calls, fetcher } = server({ status: connected() })
    const controller = new DocsController(fetcher)
    controller.actions.search('a'.repeat(31))
    expect(controller.store.getSnapshot().phase).toBe('empty')
    expect(controller.store.getSnapshot().view).toBe('search')
    expect(calls).toHaveLength(0)
  })

  it('enters a folder and returns through the breadcrumb', async () => {
    const { calls, fetcher } = server({ status: connected(), files: page([]) })
    const controller = new DocsController(fetcher)
    controller.actions.setView('files')
    await vi.waitFor(() => { expect(controller.store.getSnapshot().phase).toBe('empty') })
    controller.actions.openFolder('f1', 'Folder')
    await vi.waitFor(() => { expect(controller.store.getSnapshot().crumbs).toHaveLength(1) })
    await vi.waitFor(() => { expect(calls[calls.length - 1]?.route).toContain('folderToken=f1') })
    controller.actions.goBack()
    await vi.waitFor(() => { expect(controller.store.getSnapshot().crumbs).toHaveLength(0) })
  })
})

describe('DocsController drawer', () => {
  it('reads the outline, then the full body on demand', async () => {
    const { fetcher } = server({ status: connected(), recent: page(), document: documents })
    const controller = new DocsController(fetcher)
    controller.actions.openDoc(ITEM)
    await vi.waitFor(() => { expect(controller.store.getSnapshot().selection?.phase).toBe('ready') })
    expect(controller.store.getSnapshot().selection?.outline).toBe('## A')
    controller.actions.viewFull()
    await vi.waitFor(() => { expect(controller.store.getSnapshot().selection?.full).toBe('# Body') })
    expect(controller.store.getSnapshot().selection?.truncated).toBe(true)
  })

  it('opens the editor with the block list and freezes view changes', async () => {
    const { calls, fetcher } = server({ status: connected(), recent: page(), document: documents })
    const controller = new DocsController(fetcher)
    controller.actions.openDoc(ITEM)
    await vi.waitFor(() => { expect(controller.store.getSnapshot().selection?.phase).toBe('ready') })
    controller.actions.startEdit()
    await vi.waitFor(() => { expect(controller.store.getSnapshot().selection?.blocksPhase).toBe('ready') })
    expect(controller.store.getSnapshot().selection?.blocks).toHaveLength(2)
    const before = calls.length
    controller.actions.setView('files')
    expect(controller.store.getSnapshot().view).toBe('recent')
    expect(calls).toHaveLength(before)
  })

  it('appends Markdown with the base revision and updates it after the write', async () => {
    let revision = 2
    const { calls, fetcher } = server({
      status: connected(),
      recent: page(),
      document: documentsAt(() => revision),
      mutate: () => {
        revision = 3
        return ok({ token: 'd1', revisionId: 3, result: 'success', updatedBlocks: 1, warnings: [] })
      },
    })
    const controller = new DocsController(fetcher)
    controller.actions.openDoc(ITEM)
    await vi.waitFor(() => { expect(controller.store.getSnapshot().selection?.phase).toBe('ready') })
    controller.actions.startEdit()
    await vi.waitFor(() => { expect(controller.store.getSnapshot().selection?.blocksPhase).toBe('ready') })
    controller.actions.startAppend()
    controller.actions.updateDraft('# new')
    controller.actions.saveDraft()
    await vi.waitFor(() => { expect(controller.store.getSnapshot().selection?.revisionId).toBe(3) })
    const mutation = calls.find(call => call.body?.action === 'append')
    expect(mutation?.body).toMatchObject({
      action: 'append',
      token: 'https://example.test/docx/d1',
      revisionId: 2,
      content: '# new',
    })
    expect(controller.store.getSnapshot().selection?.editor).toBeUndefined()
  })

  it('keeps the draft on conflict, shows the banner, and reloads the blocks', async () => {
    const { calls, fetcher } = server({
      status: connected(),
      recent: page(),
      document: documents,
      mutate: () => failure('conflict'),
    })
    const controller = new DocsController(fetcher)
    controller.actions.openDoc(ITEM)
    await vi.waitFor(() => { expect(controller.store.getSnapshot().selection?.phase).toBe('ready') })
    controller.actions.startEdit()
    await vi.waitFor(() => { expect(controller.store.getSnapshot().selection?.blocksPhase).toBe('ready') })
    controller.actions.editBlock('p1')
    controller.actions.updateDraft('changed')
    controller.actions.saveDraft()
    await vi.waitFor(() => { expect(controller.store.getSnapshot().selection?.banner?.kind).toBe('conflict') })
    expect(controller.store.getSnapshot().selection?.editor?.text).toBe('changed')
    expect(controller.store.getSnapshot().selection?.editor?.errorCode).toBe('conflict')
    await vi.waitFor(() => {
      expect(calls.filter(call => call.route.includes('mode=blocks') && call.route.includes('refresh=1')).length).toBeGreaterThan(0)
    })
  })

  it('keeps a partial success visible and records its revision', async () => {
    let revision = 2
    const { fetcher } = server({
      status: connected(),
      recent: page(),
      document: documentsAt(() => revision),
      mutate: () => {
        revision = 5
        return ok({
          token: 'd1',
          revisionId: 5,
          result: 'partial_success',
          updatedBlocks: 1,
          warnings: ['one skipped'],
        })
      },
    })
    const controller = new DocsController(fetcher)
    controller.actions.openDoc(ITEM)
    await vi.waitFor(() => { expect(controller.store.getSnapshot().selection?.phase).toBe('ready') })
    controller.actions.startEdit()
    await vi.waitFor(() => { expect(controller.store.getSnapshot().selection?.blocksPhase).toBe('ready') })
    controller.actions.editBlock('p1')
    controller.actions.updateDraft('changed')
    controller.actions.saveDraft()
    await vi.waitFor(() => { expect(controller.store.getSnapshot().selection?.banner?.kind).toBe('partial') })
    expect(controller.store.getSnapshot().selection?.banner?.warnings).toEqual(['one skipped'])
    expect(controller.store.getSnapshot().selection?.revisionId).toBe(5)
  })

  it('deletes one block and sends its id', async () => {
    let revision = 2
    const { calls, fetcher } = server({
      status: connected(),
      recent: page(),
      document: documentsAt(() => revision),
      mutate: () => {
        revision = 6
        return ok({ token: 'd1', revisionId: 6, result: 'success', warnings: [] })
      },
    })
    const controller = new DocsController(fetcher)
    controller.actions.openDoc(ITEM)
    await vi.waitFor(() => { expect(controller.store.getSnapshot().selection?.phase).toBe('ready') })
    controller.actions.startEdit()
    await vi.waitFor(() => { expect(controller.store.getSnapshot().selection?.blocksPhase).toBe('ready') })
    controller.actions.deleteBlock('p1')
    await vi.waitFor(() => { expect(controller.store.getSnapshot().selection?.revisionId).toBe(6) })
    expect(calls.find(call => call.body?.action === 'delete-block')?.body).toMatchObject({
      action: 'delete-block',
      blockId: 'p1',
      revisionId: 2,
    })
  })

  it('renames the open document and updates the row', async () => {
    const { calls, fetcher } = server({
      status: connected(),
      recent: page(),
      document: documents,
      mutate: () => ok({ token: 'd1', title: 'Renamed', warnings: [] }),
    })
    const controller = new DocsController(fetcher)
    controller.actions.openDoc(ITEM)
    await vi.waitFor(() => { expect(controller.store.getSnapshot().selection?.phase).toBe('ready') })
    await expect(controller.actions.rename('Renamed')).resolves.toBe(true)
    expect(controller.store.getSnapshot().selection?.item.title).toEqual([{ text: 'Renamed', highlighted: false }])
    expect(calls.find(call => call.body?.action === 'rename')?.body).toMatchObject({
      action: 'rename',
      title: 'Renamed',
    })
  })
})

describe('DocsController create', () => {
  it('creates a document, closes the form, and opens it', async () => {
    const { fetcher } = server({
      status: connected(),
      recent: page(),
      document: documents,
      create: ok({ documentId: 'new1', url: 'https://example.test/docx/new1' }),
    })
    const controller = new DocsController(fetcher)
    controller.actions.openCreate()
    controller.actions.submitCreate({ title: 'New' })
    await vi.waitFor(() => { expect(controller.store.getSnapshot().selection?.item.token).toBe('new1') })
    expect(controller.store.getSnapshot().composer).toBeUndefined()
    expect(controller.store.getSnapshot().selection?.item.url).toBe('https://example.test/docx/new1')
  })

  it('keeps the form on failure', async () => {
    const { fetcher } = server({ status: connected(), create: failure('invalid-input') })
    const controller = new DocsController(fetcher)
    controller.actions.openCreate()
    controller.actions.submitCreate({ title: 'New' })
    await vi.waitFor(() => { expect(controller.store.getSnapshot().composer?.errorCode).toBe('invalid-input') })
    expect(controller.store.getSnapshot().composer?.pending).toBe(false)
  })
})
