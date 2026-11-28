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

/**
 * The shared row without its URL; wiki-free rows fall back to the token.
 * @returns the row.
 */
function itemWithoutUrl(): DocItem {
  const { url: _url, ...bare } = ITEM
  return bare
}

/** Recorded server answers. */
interface Answers {
  status: Answer
  recent?: Answer | ((call: number) => Answer)
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
  let recentReads = 0
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
    else if (path === RECENT_ROUTE) {
      answer = typeof answers.recent === 'function' ? answers.recent(recentReads) : answers.recent
      recentReads += 1
    } else if (path === SEARCH_ROUTE) answer = answers.search
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

/** One request a deferred fetcher holds open. */
interface HeldRequest {
  readonly route: string
  settle: (answer: Answer) => void
}

/**
 * Serialize one recorded answer as a route response.
 * @param answer - recorded envelope.
 * @returns the response.
 */
function respond(answer: Answer): Response {
  return new Response(JSON.stringify(answer), { status: answer.ok ? 200 : 500 })
}

/**
 * Build a fetcher that holds every request until the spec settles it.
 * @returns the fetcher and its held requests in arrival order.
 */
function deferred() {
  const held: HeldRequest[] = []
  const fetcher: typeof fetch = input => new Promise<Response>((resolve) => {
    held.push({ route: String(input), settle: (answer) => { resolve(respond(answer)) } })
  })
  return { fetcher, held }
}

/**
 * Build a fetcher that holds every write open and answers the drawer reads around it.
 * @returns the fetcher, the recorded calls, and the pending write answers in arrival order.
 */
function heldWrite() {
  const calls: { route: string; body?: Record<string, unknown> }[] = []
  const writes: Array<(answer: Answer) => void> = []
  const fetcher: typeof fetch = async (input, init) => {
    const route = String(input)
    const body = init?.body === undefined || init.body === null
      ? undefined
      : JSON.parse(String(init.body)) as Record<string, unknown>
    calls.push({ route, ...(body === undefined ? {} : { body }) })
    if (init?.method === 'POST') {
      return new Promise<Response>((resolve) => {
        writes.push((answer) => { resolve(respond(answer)) })
      })
    }
    if (route.startsWith(STATUS_ROUTE)) return respond(connected())
    if (route.includes('mode=blocks')) {
      return respond(ok({
        mode: 'blocks',
        token: 'd1',
        revisionId: 2,
        blocks: [{ blockId: 'p1', tag: 'p', text: 'old', editable: true }],
      }))
    }
    return respond(documents('outline'))
  }
  return { fetcher, calls, writes }
}

describe('DocsController transport', () => {
  it('uses the global fetch when no fetcher is injected', async () => {
    const fetchMock = vi.fn(async (input: string | URL) => respond(String(input).startsWith(STATUS_ROUTE)
      ? connected()
      : page([])))
    vi.stubGlobal('fetch', fetchMock)
    try {
      const controller = new DocsController()
      controller.load()
      await vi.waitFor(() => { expect(controller.store.getSnapshot().phase).toBe('empty') })
      expect(fetchMock).toHaveBeenCalled()
    } finally {
      vi.unstubAllGlobals()
    }
  })

  it('reports an unreadable route answer as upstream', async () => {
    const fetcher: typeof fetch = async () => new Response('{}', { status: 200 })
    const controller = new DocsController(fetcher)
    controller.load()
    await vi.waitFor(() => { expect(controller.store.getSnapshot().phase).toBe('error') })
    expect(controller.store.getSnapshot().errorCode).toBe('upstream')
  })

  it('reports a transport failure as upstream', async () => {
    const fetcher: typeof fetch = async () => { throw new Error('offline') }
    const controller = new DocsController(fetcher)
    controller.load()
    await vi.waitFor(() => { expect(controller.store.getSnapshot().errorCode).toBe('upstream') })
    expect(controller.store.getSnapshot().phase).toBe('error')
  })

  it('ignores a status answer that lands after the panel went away', async () => {
    const d = deferred()
    const controller = new DocsController(d.fetcher)
    controller.load()
    await vi.waitFor(() => { expect(d.held).toHaveLength(1) })
    controller.dispose()
    d.held[0]?.settle(connected())
    await new Promise(resolve => setTimeout(resolve, 0))
    expect(controller.store.getSnapshot().phase).toBe('loading')
  })

  it('cancels the list read when the panel goes away', async () => {
    const d = deferred()
    const controller = new DocsController(d.fetcher)
    controller.load()
    await vi.waitFor(() => { expect(d.held).toHaveLength(1) })
    d.held[0]?.settle(connected())
    await vi.waitFor(() => { expect(d.held).toHaveLength(2) })
    controller.dispose()
    d.held[1]?.settle(page([ITEM]))
    await new Promise(resolve => setTimeout(resolve, 0))
    expect(controller.store.getSnapshot().phase).toBe('loading')
    expect(controller.store.getSnapshot().items).toEqual([])
  })

  it('ignores a list failure that lands after the panel went away', async () => {
    const fetcher: typeof fetch = async () => {
      controller.dispose()
      throw new Error('offline')
    }
    const controller = new DocsController(fetcher)
    controller.load()
    await new Promise(resolve => setTimeout(resolve, 0))
    expect(controller.store.getSnapshot().phase).toBe('loading')
  })
})

describe('DocsController list states', () => {
  it.each([
    ['not-configured', 'disconnected'],
    ['not-connected', 'disconnected'],
    ['permission-denied', 'permission'],
    ['cli-missing', 'no-cli'],
    ['upstream', 'error'],
  ])('maps a %s list failure to %s', async (code, phase) => {
    const { fetcher } = server({ status: connected(), recent: failure(code) })
    const controller = new DocsController(fetcher)
    controller.load()
    await vi.waitFor(() => { expect(controller.store.getSnapshot().phase).toBe(phase) })
    expect(controller.store.getSnapshot().errorCode).toBe(code)
  })

  it('shows the permission state for an account missing scopes', async () => {
    const { fetcher } = server({
      status: ok({ cli: true, configured: true, connected: false, missingScopes: ['search:docs:read'] }),
    })
    const controller = new DocsController(fetcher)
    controller.load()
    await vi.waitFor(() => { expect(controller.store.getSnapshot().phase).toBe('permission') })
    expect(controller.store.getSnapshot().errorCode).toBe('permission-denied')
  })

  it('asks for a keyword instead of reading an empty search', async () => {
    const { calls, fetcher } = server({ status: connected() })
    const controller = new DocsController(fetcher)
    controller.actions.setView('search')
    await vi.waitFor(() => { expect(controller.store.getSnapshot().phase).toBe('empty') })
    expect(controller.store.getSnapshot().view).toBe('search')
    expect(calls.map(call => call.route)).toEqual([STATUS_ROUTE])
  })

  it('bypasses the host cache when the reader refreshes', async () => {
    const { calls, fetcher } = server({ status: connected(), recent: page() })
    const controller = new DocsController(fetcher)
    controller.load()
    await vi.waitFor(() => { expect(controller.store.getSnapshot().phase).toBe('ready') })
    controller.actions.refresh()
    await vi.waitFor(() => { expect(calls.at(-1)?.route).toContain('refresh=1') })
  })

  it('re-reads the list for every view dimension', async () => {
    const { calls, fetcher } = server({ status: connected(), recent: page(), files: page() })
    const controller = new DocsController(fetcher)
    controller.actions.setDays(7)
    await vi.waitFor(() => { expect(calls.at(-1)?.route).toContain('days=7') })
    controller.actions.setSort('edit')
    await vi.waitFor(() => { expect(calls.at(-1)?.route).toContain('sort=edit') })
    controller.actions.setOrderBy('CreatedTime')
    await vi.waitFor(() => {
      expect(controller.store.getSnapshot().orderBy).toBe('CreatedTime')
      expect(calls.at(-1)?.route).toContain('days=7')
    })
    controller.actions.setView('files')
    await vi.waitFor(() => { expect(calls.at(-1)?.route).toContain('orderBy=CreatedTime') })
  })

  it('adds the owned-only filter only once a keyword exists', async () => {
    const { calls, fetcher } = server({ status: connected(), search: page([]) })
    const controller = new DocsController(fetcher)
    controller.actions.setMine(true)
    expect(controller.store.getSnapshot().mine).toBe(true)
    expect(calls).toHaveLength(0)
    controller.actions.search('DSH')
    await vi.waitFor(() => { expect(calls.at(-1)?.route).toContain('mine=1') })
    controller.actions.setMine(false)
    await vi.waitFor(() => { expect(calls.at(-1)?.route).not.toContain('mine=1') })
  })

  it('ignores panel actions while the block editor is open', async () => {
    const { calls, fetcher } = server({ status: connected(), recent: page(), document: documents })
    const controller = new DocsController(fetcher)
    controller.actions.openDoc(ITEM)
    await vi.waitFor(() => { expect(controller.store.getSnapshot().selection?.phase).toBe('ready') })
    controller.actions.startEdit()
    await vi.waitFor(() => { expect(controller.store.getSnapshot().selection?.blocksPhase).toBe('ready') })
    const before = calls.length
    controller.actions.refresh()
    controller.actions.setView('files')
    controller.actions.setDays(7)
    controller.actions.setSort('edit')
    controller.actions.setOrderBy('CreatedTime')
    controller.actions.setMine(true)
    controller.actions.search('x')
    controller.actions.loadMore()
    controller.actions.openFolder('f1', 'Folder')
    controller.actions.goBack()
    controller.actions.goRoot()
    expect(calls).toHaveLength(before)
    expect(controller.store.getSnapshot().view).toBe('recent')
    expect(controller.store.getSnapshot().mine).toBe(false)
    expect(controller.store.getSnapshot().crumbs).toEqual([])
  })
})

describe('DocsController paging', () => {
  it('appends the next page and follows its cursor', async () => {
    const { calls, fetcher } = server({
      status: connected(),
      recent: (call) => {
        if (call === 0) return ok({ items: [ITEM], hasMore: true, pageToken: 'p2', fetchedAt: 'now' })
        if (call === 1) return ok({ items: [{ ...ITEM, token: 'd2' }], hasMore: true, pageToken: 'p3', fetchedAt: 'now' })
        return ok({ items: [{ ...ITEM, token: 'd3' }], hasMore: false, fetchedAt: 'now' })
      },
    })
    const controller = new DocsController(fetcher)
    controller.load()
    await vi.waitFor(() => { expect(controller.store.getSnapshot().items).toHaveLength(1) })
    controller.actions.loadMore()
    await vi.waitFor(() => { expect(controller.store.getSnapshot().items).toHaveLength(2) })
    expect(controller.store.getSnapshot().hasMore).toBe(true)
    expect(controller.store.getSnapshot().pageToken).toBe('p3')
    expect(controller.store.getSnapshot().loadingMore).toBe(false)
    expect(calls.at(-1)?.route).toContain('pageToken=p2')
    controller.actions.loadMore()
    await vi.waitFor(() => { expect(controller.store.getSnapshot().items).toHaveLength(3) })
    expect(controller.store.getSnapshot().hasMore).toBe(false)
    expect(controller.store.getSnapshot().pageToken).toBeUndefined()
  })

  it('reports a failed next page without losing the rows it has', async () => {
    const { fetcher } = server({
      status: connected(),
      recent: call => (call === 0
        ? ok({ items: [ITEM], hasMore: true, pageToken: 'p2', fetchedAt: 'now' })
        : failure('timeout')),
    })
    const controller = new DocsController(fetcher)
    controller.load()
    await vi.waitFor(() => { expect(controller.store.getSnapshot().items).toHaveLength(1) })
    controller.actions.loadMore()
    await vi.waitFor(() => { expect(controller.store.getSnapshot().errorCode).toBe('timeout') })
    expect(controller.store.getSnapshot().loadingMore).toBe(false)
    expect(controller.store.getSnapshot().items).toHaveLength(1)
  })

  it('offers no next page without a cursor', async () => {
    const { calls, fetcher } = server({
      status: connected(),
      recent: ok({ items: [ITEM], hasMore: true, fetchedAt: 'now' }),
    })
    const controller = new DocsController(fetcher)
    controller.load()
    await vi.waitFor(() => { expect(controller.store.getSnapshot().hasMore).toBe(true) })
    const before = calls.length
    controller.actions.loadMore()
    await new Promise(resolve => setTimeout(resolve, 0))
    expect(calls).toHaveLength(before)
    expect(controller.store.getSnapshot().items).toHaveLength(1)
  })
})

describe('DocsController folders', () => {
  it('enters the folder a row names and returns to the root', async () => {
    const folder: DocItem = {
      ...ITEM,
      token: 'f1',
      type: 'folder',
      isFolder: true,
      title: [{ text: 'Folder', highlighted: false }],
    }
    const { calls, fetcher } = server({ status: connected(), files: page([]) })
    const controller = new DocsController(fetcher)
    controller.actions.openDoc(folder)
    await vi.waitFor(() => { expect(controller.store.getSnapshot().view).toBe('files') })
    await vi.waitFor(() => { expect(calls.at(-1)?.route).toContain('folderToken=f1') })
    expect(controller.store.getSnapshot().crumbs).toEqual([{ token: 'f1', name: 'Folder' }])
    controller.actions.goRoot()
    await vi.waitFor(() => { expect(controller.store.getSnapshot().crumbs).toEqual([]) })
    await vi.waitFor(() => {
      expect(controller.store.getSnapshot().phase).toBe('empty')
      expect(calls.at(-1)?.route).not.toContain('folderToken')
    })
  })
})

describe('DocsController drawer reads', () => {
  it('addresses the document by token when the row has no URL', async () => {
    const bare = itemWithoutUrl()
    const { calls, fetcher } = server({ status: connected(), document: documents })
    const controller = new DocsController(fetcher)
    controller.actions.openDoc(bare)
    await vi.waitFor(() => { expect(controller.store.getSnapshot().selection?.phase).toBe('ready') })
    expect(calls.at(-1)?.route).toContain('token=d1&mode=outline')
  })

  it('closes the drawer and drops the read it superseded', async () => {
    const d = deferred()
    const controller = new DocsController(d.fetcher)
    controller.actions.openDoc(ITEM)
    await vi.waitFor(() => { expect(d.held).toHaveLength(1) })
    controller.actions.closeDoc()
    d.held[0]?.settle(documents('outline'))
    await new Promise(resolve => setTimeout(resolve, 0))
    expect(controller.store.getSnapshot().selection).toBeUndefined()
  })

  it('records a failed outline read and retries it', async () => {
    const { calls, fetcher } = server({
      status: connected(),
      document: mode => (mode === 'outline' ? failure('upstream') : documents(mode)),
    })
    const controller = new DocsController(fetcher)
    controller.actions.openDoc(ITEM)
    await vi.waitFor(() => { expect(controller.store.getSnapshot().selection?.phase).toBe('error') })
    expect(controller.store.getSnapshot().selection?.errorCode).toBe('upstream')
    controller.actions.retryDetail()
    await vi.waitFor(() => { expect(calls.at(-1)?.route).toContain('refresh=1') })
  })

  it('ignores a retry without an open drawer', async () => {
    const controller = new DocsController(server({ status: connected() }).fetcher)
    controller.actions.retryDetail()
    expect(controller.store.getSnapshot().selection).toBeUndefined()
  })

  it('records a failed full read and retries it', async () => {
    const { fetcher } = server({
      status: connected(),
      document: mode => (mode === 'full' ? failure('upstream') : documents(mode)),
    })
    const controller = new DocsController(fetcher)
    controller.actions.openDoc(ITEM)
    await vi.waitFor(() => { expect(controller.store.getSnapshot().selection?.phase).toBe('ready') })
    controller.actions.viewFull()
    await vi.waitFor(() => { expect(controller.store.getSnapshot().selection?.fullPhase).toBe('error') })
    controller.actions.viewFull()
    await vi.waitFor(() => { expect(controller.store.getSnapshot().selection?.fullPhase).toBe('error') })
  })

  it('ignores a second full read while the first is loading', async () => {
    const d = deferred()
    const controller = new DocsController(d.fetcher)
    controller.actions.openDoc(ITEM)
    await vi.waitFor(() => { expect(d.held).toHaveLength(1) })
    d.held[0]?.settle(documents('outline'))
    await vi.waitFor(() => { expect(controller.store.getSnapshot().selection?.phase).toBe('ready') })
    controller.actions.viewFull()
    await vi.waitFor(() => { expect(d.held).toHaveLength(2) })
    controller.actions.viewFull()
    expect(d.held).toHaveLength(2)
    d.held[1]?.settle(documents('full'))
    await vi.waitFor(() => { expect(controller.store.getSnapshot().selection?.fullPhase).toBe('ready') })
  })

  it('hides the full body again', async () => {
    const { fetcher } = server({ status: connected(), document: documents })
    const controller = new DocsController(fetcher)
    controller.actions.openDoc(ITEM)
    await vi.waitFor(() => { expect(controller.store.getSnapshot().selection?.phase).toBe('ready') })
    controller.actions.viewFull()
    await vi.waitFor(() => { expect(controller.store.getSnapshot().selection?.full).toBe('# Body') })
    controller.actions.hideFull()
    expect(controller.store.getSnapshot().selection?.full).toBeUndefined()
    expect(controller.store.getSnapshot().selection?.truncated).toBeUndefined()
  })

  it('records a failed block read and retries it', async () => {
    const { fetcher } = server({
      status: connected(),
      document: mode => (mode === 'blocks' ? failure('upstream') : documents(mode)),
    })
    const controller = new DocsController(fetcher)
    controller.actions.openDoc(ITEM)
    await vi.waitFor(() => { expect(controller.store.getSnapshot().selection?.phase).toBe('ready') })
    controller.actions.startEdit()
    await vi.waitFor(() => { expect(controller.store.getSnapshot().selection?.blocksPhase).toBe('error') })
    controller.actions.startEdit()
    await vi.waitFor(() => { expect(controller.store.getSnapshot().selection?.blocksPhase).toBe('error') })
  })

  it('ignores drawer actions without an open drawer', async () => {
    const controller = new DocsController(server({ status: connected() }).fetcher)
    controller.actions.closeDoc()
    controller.actions.retryDetail()
    controller.actions.viewFull()
    controller.actions.hideFull()
    controller.actions.startEdit()
    controller.actions.closeEdit()
    controller.actions.editBlock('p1')
    controller.actions.startAppend()
    controller.actions.updateDraft('x')
    controller.actions.cancelDraft()
    controller.actions.saveDraft()
    controller.actions.deleteBlock('p1')
    expect(controller.store.getSnapshot().selection).toBeUndefined()
  })
})

describe('DocsController editor guards', () => {
  it('refuses to edit a read-only type', async () => {
    const { fetcher } = server({ status: connected(), document: documents })
    const controller = new DocsController(fetcher)
    controller.actions.openDoc({ ...ITEM, type: 'sheet' })
    await vi.waitFor(() => { expect(controller.store.getSnapshot().selection?.phase).toBe('ready') })
    controller.actions.startEdit()
    expect(controller.store.getSnapshot().selection?.editing).toBe(false)
  })

  it('offers no draft for a resource block or an unknown block', async () => {
    const { fetcher } = server({ status: connected(), document: documents })
    const controller = new DocsController(fetcher)
    controller.actions.openDoc(ITEM)
    await vi.waitFor(() => { expect(controller.store.getSnapshot().selection?.phase).toBe('ready') })
    controller.actions.startEdit()
    await vi.waitFor(() => { expect(controller.store.getSnapshot().selection?.blocksPhase).toBe('ready') })
    controller.actions.editBlock('i1')
    expect(controller.store.getSnapshot().selection?.editor).toBeUndefined()
    controller.actions.editBlock('missing')
    expect(controller.store.getSnapshot().selection?.editor).toBeUndefined()
  })

  it('cancels the current draft', async () => {
    const { fetcher } = server({ status: connected(), document: documents })
    const controller = new DocsController(fetcher)
    controller.actions.openDoc(ITEM)
    await vi.waitFor(() => { expect(controller.store.getSnapshot().selection?.phase).toBe('ready') })
    controller.actions.startEdit()
    await vi.waitFor(() => { expect(controller.store.getSnapshot().selection?.blocksPhase).toBe('ready') })
    controller.actions.startAppend()
    controller.actions.updateDraft('# draft')
    expect(controller.store.getSnapshot().selection?.editor?.text).toBe('# draft')
    controller.actions.cancelDraft()
    expect(controller.store.getSnapshot().selection?.editor).toBeUndefined()
    controller.actions.cancelDraft()
    expect(controller.store.getSnapshot().selection?.editor).toBeUndefined()
    controller.actions.closeEdit()
    expect(controller.store.getSnapshot().selection?.editing).toBe(false)
  })

  it('refuses a draft beyond the content bound before sending it', async () => {
    const { calls, fetcher } = server({ status: connected(), document: documents })
    const controller = new DocsController(fetcher)
    controller.actions.openDoc(ITEM)
    await vi.waitFor(() => { expect(controller.store.getSnapshot().selection?.phase).toBe('ready') })
    controller.actions.startEdit()
    await vi.waitFor(() => { expect(controller.store.getSnapshot().selection?.blocksPhase).toBe('ready') })
    controller.actions.startAppend()
    controller.actions.updateDraft('x'.repeat(20_001))
    const writesBefore = calls.filter(call => call.body !== undefined).length
    controller.actions.saveDraft()
    await vi.waitFor(() => {
      expect(controller.store.getSnapshot().selection?.editor?.errorCode).toBe('invalid-input')
    })
    expect(calls.filter(call => call.body !== undefined)).toHaveLength(writesBefore)
  })

  it('refuses a write reader without a base revision', async () => {
    const { fetcher } = server({
      status: connected(),
      document: mode => (mode === 'blocks'
        ? ok({ mode: 'blocks', token: 'd1', blocks: [] })
        : ok({ mode: 'outline', token: 'd1', content: '## A', truncated: false, revisionId: 2 })),
    })
    const controller = new DocsController(fetcher)
    controller.actions.openDoc(ITEM)
    await vi.waitFor(() => { expect(controller.store.getSnapshot().selection?.phase).toBe('ready') })
    controller.actions.startEdit()
    await vi.waitFor(() => { expect(controller.store.getSnapshot().selection?.blocksPhase).toBe('ready') })
    controller.actions.startAppend()
    controller.actions.updateDraft('# draft')
    controller.actions.saveDraft()
    await vi.waitFor(() => {
      expect(controller.store.getSnapshot().selection?.editor?.errorCode).toBe('upstream')
    })
  })
})

describe('DocsController write failures', () => {
  it('reports a failed draft write in the editor', async () => {
    const { fetcher } = server({
      status: connected(),
      document: documents,
      mutate: () => failure('upstream'),
    })
    const controller = new DocsController(fetcher)
    controller.actions.openDoc(ITEM)
    await vi.waitFor(() => { expect(controller.store.getSnapshot().selection?.phase).toBe('ready') })
    controller.actions.startEdit()
    await vi.waitFor(() => { expect(controller.store.getSnapshot().selection?.blocksPhase).toBe('ready') })
    controller.actions.startAppend()
    controller.actions.updateDraft('# draft')
    controller.actions.saveDraft()
    await vi.waitFor(() => {
      expect(controller.store.getSnapshot().selection?.editor?.errorCode).toBe('upstream')
    })
    expect(controller.store.getSnapshot().selection?.editor?.saving).toBe(false)
  })

  it('refuses to delete a block without a base revision', async () => {
    const { fetcher } = server({
      status: connected(),
      document: mode => (mode === 'blocks'
        ? ok({ mode: 'blocks', token: 'd1', blocks: [{ blockId: 'p1', tag: 'p', text: 'x', editable: true }] })
        : ok({ mode: 'outline', token: 'd1', content: '## A', truncated: false, revisionId: 2 })),
    })
    const controller = new DocsController(fetcher)
    controller.actions.openDoc(ITEM)
    await vi.waitFor(() => { expect(controller.store.getSnapshot().selection?.phase).toBe('ready') })
    controller.actions.startEdit()
    await vi.waitFor(() => { expect(controller.store.getSnapshot().selection?.blocksPhase).toBe('ready') })
    controller.actions.deleteBlock('p1')
    await vi.waitFor(() => { expect(controller.store.getSnapshot().selection?.errorCode).toBe('upstream') })
  })

  it('reports a failed block delete in the drawer', async () => {
    const { fetcher } = server({
      status: connected(),
      document: documents,
      mutate: () => failure('upstream'),
    })
    const controller = new DocsController(fetcher)
    controller.actions.openDoc(ITEM)
    await vi.waitFor(() => { expect(controller.store.getSnapshot().selection?.phase).toBe('ready') })
    controller.actions.startEdit()
    await vi.waitFor(() => { expect(controller.store.getSnapshot().selection?.blocksPhase).toBe('ready') })
    controller.actions.deleteBlock('p1')
    await vi.waitFor(() => { expect(controller.store.getSnapshot().selection?.errorCode).toBe('upstream') })
  })

  it('addresses a write by token and keeps the revision when the answer omits one', async () => {
    const { calls, fetcher } = server({
      status: connected(),
      document: documents,
      mutate: () => ok({ token: 'd1', warnings: [] }),
    })
    const controller = new DocsController(fetcher)
    controller.actions.openDoc(itemWithoutUrl())
    await vi.waitFor(() => { expect(controller.store.getSnapshot().selection?.phase).toBe('ready') })
    controller.actions.startEdit()
    await vi.waitFor(() => { expect(controller.store.getSnapshot().selection?.blocksPhase).toBe('ready') })
    controller.actions.deleteBlock('p1')
    await vi.waitFor(() => {
      const selection = controller.store.getSnapshot().selection
      expect(selection?.revisionId).toBe(2)
      expect(selection?.banner).toBeUndefined()
    })
    expect(calls.find(call => call.body?.action === 'delete-block')?.body).toMatchObject({ token: 'd1' })
  })

  it('re-reads the visible full body after a write', async () => {
    let revision = 2
    const { calls, fetcher } = server({
      status: connected(),
      document: documentsAt(() => revision),
      mutate: () => {
        revision = 3
        return ok({ token: 'd1', revisionId: 3, result: 'success', warnings: [] })
      },
    })
    const controller = new DocsController(fetcher)
    controller.actions.openDoc(ITEM)
    await vi.waitFor(() => { expect(controller.store.getSnapshot().selection?.phase).toBe('ready') })
    controller.actions.viewFull()
    await vi.waitFor(() => { expect(controller.store.getSnapshot().selection?.full).toBe('# Body') })
    controller.actions.startEdit()
    await vi.waitFor(() => { expect(controller.store.getSnapshot().selection?.blocksPhase).toBe('ready') })
    controller.actions.startAppend()
    controller.actions.updateDraft('# new')
    controller.actions.saveDraft()
    await vi.waitFor(() => { expect(controller.store.getSnapshot().selection?.revisionId).toBe(3) })
    await vi.waitFor(() => {
      expect(calls.filter(call => call.route.includes('mode=full') && call.route.includes('refresh=1')).length)
        .toBeGreaterThan(0)
    })
  })

  it('ignores a write that lands after the drawer closed', async () => {
    const { fetcher, writes } = heldWrite()
    const controller = new DocsController(fetcher)
    controller.actions.openDoc(ITEM)
    await vi.waitFor(() => { expect(controller.store.getSnapshot().selection?.phase).toBe('ready') })
    controller.actions.startEdit()
    await vi.waitFor(() => { expect(controller.store.getSnapshot().selection?.blocksPhase).toBe('ready') })
    controller.actions.startAppend()
    controller.actions.updateDraft('# draft')
    controller.actions.saveDraft()
    await vi.waitFor(() => { expect(writes).toHaveLength(1) })
    controller.actions.closeDoc()
    writes[0]?.(ok({ token: 'd1', revisionId: 3, warnings: [] }))
    await new Promise((resolve) => { setTimeout(resolve, 0) })
    expect(controller.store.getSnapshot().selection).toBeUndefined()
  })

  it('stops re-reading when the panel goes away during a write', async () => {
    let blockReads = 0
    const fetcher: typeof fetch = async (input, init) => {
      if (init?.method === 'POST') return respond(ok({ token: 'd1', revisionId: 3, warnings: [] }))
      const route = String(input)
      if (route.startsWith(STATUS_ROUTE)) return respond(connected())
      if (route.includes('mode=blocks')) {
        blockReads += 1
        if (blockReads > 1) {
          controller.dispose()
          throw new Error('offline')
        }
        return respond(ok({
          mode: 'blocks',
          token: 'd1',
          revisionId: 2,
          blocks: [{ blockId: 'p1', tag: 'p', text: 'old', editable: true }],
        }))
      }
      return respond(documents('outline'))
    }
    const controller = new DocsController(fetcher)
    controller.actions.openDoc(ITEM)
    await vi.waitFor(() => { expect(controller.store.getSnapshot().selection?.phase).toBe('ready') })
    controller.actions.startEdit()
    await vi.waitFor(() => { expect(controller.store.getSnapshot().selection?.blocksPhase).toBe('ready') })
    controller.actions.startAppend()
    controller.actions.updateDraft('# draft')
    controller.actions.saveDraft()
    await vi.waitFor(() => { expect(controller.store.getSnapshot().selection?.revisionId).toBe(3) })
  })
})

describe('DocsController rename', () => {
  it('refuses a rename without an open drawer or with a blank title', async () => {
    const { fetcher } = server({ status: connected(), document: documents })
    const controller = new DocsController(fetcher)
    await expect(controller.actions.rename('New')).resolves.toBe(false)
    controller.actions.openDoc(ITEM)
    await vi.waitFor(() => { expect(controller.store.getSnapshot().selection?.phase).toBe('ready') })
    await expect(controller.actions.rename('   ')).resolves.toBe(false)
    await expect(controller.actions.rename('a'.repeat(201))).resolves.toBe(false)
    expect(controller.store.getSnapshot().selection?.renameState?.errorCode).toBe('invalid-input')
  })

  it('names the new title from the request when the answer omits one', async () => {
    const { fetcher } = server({
      status: connected(),
      document: documents,
      mutate: () => ok({ token: 'd1', warnings: [] }),
    })
    const controller = new DocsController(fetcher)
    controller.actions.openDoc(ITEM)
    await vi.waitFor(() => { expect(controller.store.getSnapshot().selection?.phase).toBe('ready') })
    await expect(controller.actions.rename('  Renamed  ')).resolves.toBe(true)
    expect(controller.store.getSnapshot().selection?.item.title).toEqual([{ text: 'Renamed', highlighted: false }])
    expect(controller.store.getSnapshot().selection?.renameState).toBeUndefined()
  })

  it('keeps a rename failure visible and marks a conflict', async () => {
    const { fetcher } = server({
      status: connected(),
      document: documents,
      mutate: () => failure('conflict'),
    })
    const controller = new DocsController(fetcher)
    controller.actions.openDoc(ITEM)
    await vi.waitFor(() => { expect(controller.store.getSnapshot().selection?.phase).toBe('ready') })
    await expect(controller.actions.rename('Renamed')).resolves.toBe(false)
    expect(controller.store.getSnapshot().selection?.renameState).toEqual({ pending: false, errorCode: 'conflict' })
    expect(controller.store.getSnapshot().selection?.banner).toEqual({ kind: 'conflict', warnings: [] })
  })

  it('ignores a rename that lands after the drawer closed', async () => {
    const { fetcher, writes } = heldWrite()
    const controller = new DocsController(fetcher)
    controller.actions.openDoc(ITEM)
    await vi.waitFor(() => { expect(controller.store.getSnapshot().selection?.phase).toBe('ready') })
    const pending = controller.actions.rename('Renamed')
    await vi.waitFor(() => { expect(writes).toHaveLength(1) })
    controller.actions.closeDoc()
    writes[0]?.(ok({ token: 'd1', title: 'Renamed', warnings: [] }))
    await expect(pending).resolves.toBe(false)
  })

  it('ignores a failed rename that lands after the drawer closed', async () => {
    const { fetcher, writes } = heldWrite()
    const controller = new DocsController(fetcher)
    controller.actions.openDoc(ITEM)
    await vi.waitFor(() => { expect(controller.store.getSnapshot().selection?.phase).toBe('ready') })
    const pending = controller.actions.rename('Renamed')
    await vi.waitFor(() => { expect(writes).toHaveLength(1) })
    controller.actions.closeDoc()
    writes[0]?.(failure('conflict'))
    await expect(pending).resolves.toBe(false)
  })

  it('ignores a second rename while the first is pending', async () => {
    const { fetcher, writes } = heldWrite()
    const controller = new DocsController(fetcher)
    controller.actions.openDoc(ITEM)
    await vi.waitFor(() => { expect(controller.store.getSnapshot().selection?.phase).toBe('ready') })
    const first = controller.actions.rename('One')
    await vi.waitFor(() => { expect(writes).toHaveLength(1) })
    await expect(controller.actions.rename('Two')).resolves.toBe(false)
    writes[0]?.(ok({ token: 'd1', title: 'One', warnings: [] }))
    await expect(first).resolves.toBe(true)
  })
})

describe('DocsController create dialog', () => {
  it('places the new document in the browsed folder', async () => {
    const { calls, fetcher } = server({
      status: connected(),
      files: page([]),
      document: documents,
      create: ok({ documentId: 'new1' }),
    })
    const controller = new DocsController(fetcher)
    controller.actions.openFolder('f1', 'Folder')
    await vi.waitFor(() => { expect(controller.store.getSnapshot().crumbs).toHaveLength(1) })
    controller.actions.openCreate()
    expect(controller.store.getSnapshot().composer).toEqual({ open: true, pending: false, parentToken: 'f1' })
    controller.actions.submitCreate({ title: 'New', content: '# body' })
    await vi.waitFor(() => { expect(controller.store.getSnapshot().composer).toBeUndefined() })
    expect(calls.find(call => call.route.endsWith(DOCUMENTS_ROUTE))?.body).toMatchObject({
      title: 'New',
      content: '# body',
      parentToken: 'f1',
    })
    expect(controller.store.getSnapshot().selection?.item).toMatchObject({ token: 'new1', type: 'docx' })
    expect(controller.store.getSnapshot().selection?.item.url).toBeUndefined()
  })

  it('opens at the cloud-space root when no folder is browsed', () => {
    const controller = new DocsController(server({ status: connected() }).fetcher)
    controller.actions.openCreate()
    expect(controller.store.getSnapshot().composer).toEqual({ open: true, pending: false })
  })

  it('closes the form only when no create is running', async () => {
    const { fetcher } = server({ status: connected(), create: ok({ documentId: 'new1' }), document: documents })
    const controller = new DocsController(fetcher)
    controller.actions.openCreate()
    controller.actions.closeCreate()
    expect(controller.store.getSnapshot().composer).toBeUndefined()
    controller.actions.openCreate()
    controller.actions.submitCreate({ title: 'New' })
    controller.actions.closeCreate()
    expect(controller.store.getSnapshot().composer?.pending).toBe(true)
    await vi.waitFor(() => { expect(controller.store.getSnapshot().selection?.item.token).toBe('new1') })
  })

  it('refuses a create without a title or beyond the content bound', () => {
    const controller = new DocsController(server({ status: connected() }).fetcher)
    controller.actions.submitCreate({ title: 'New' })
    expect(controller.store.getSnapshot().composer).toBeUndefined()
    controller.actions.openCreate()
    controller.actions.submitCreate({ title: '   ' })
    expect(controller.store.getSnapshot().composer?.errorCode).toBe('invalid-input')
    controller.actions.submitCreate({ title: 'New', content: 'x'.repeat(20_001) })
    expect(controller.store.getSnapshot().composer?.errorCode).toBe('invalid-input')
    expect(controller.store.getSnapshot().composer?.pending).toBe(false)
  })
})

describe('DocsController cancelled paging', () => {
  it('ignores a next page that lands after the panel went away', async () => {
    const d = deferred()
    const controller = new DocsController(d.fetcher)
    controller.load()
    await vi.waitFor(() => { expect(d.held).toHaveLength(1) })
    d.held[0]?.settle(connected())
    await vi.waitFor(() => { expect(d.held).toHaveLength(2) })
    d.held[1]?.settle(ok({ items: [ITEM], hasMore: true, pageToken: 'p2', fetchedAt: 'now' }))
    await vi.waitFor(() => { expect(controller.store.getSnapshot().hasMore).toBe(true) })
    controller.actions.loadMore()
    await vi.waitFor(() => { expect(d.held).toHaveLength(3) })
    controller.dispose()
    d.held[2]?.settle(ok({ items: [{ ...ITEM, token: 'd2' }], hasMore: false, fetchedAt: 'now' }))
    await new Promise(resolve => setTimeout(resolve, 0))
    expect(controller.store.getSnapshot().items).toHaveLength(1)
  })

  it('ignores a next-page failure that lands after the panel went away', async () => {
    let listReads = 0
    const fetcher: typeof fetch = async (input) => {
      if (String(input).startsWith(STATUS_ROUTE)) return respond(connected())
      listReads += 1
      if (listReads === 1) {
        return respond(ok({ items: [ITEM], hasMore: true, pageToken: 'p2', fetchedAt: 'now' }))
      }
      controller.dispose()
      throw new Error('offline')
    }
    const controller = new DocsController(fetcher)
    controller.load()
    await vi.waitFor(() => { expect(controller.store.getSnapshot().hasMore).toBe(true) })
    controller.actions.loadMore()
    await new Promise(resolve => setTimeout(resolve, 0))
    expect(controller.store.getSnapshot().loadingMore).toBe(true)
  })

  it('surfaces a view outside the closed union instead of guessing one', async () => {
    const { fetcher } = server({ status: connected() })
    const controller = new DocsController(fetcher)
    controller.actions.setView('bogus' as never)
    await vi.waitFor(() => { expect(controller.store.getSnapshot().phase).toBe('error') })
    expect(controller.store.getSnapshot().errorCode).toBe('upstream')
  })
})

describe('DocsController writes by token', () => {
  it('appends through the token when the row has no URL', async () => {
    let revision = 2
    const { calls, fetcher } = server({
      status: connected(),
      document: documentsAt(() => revision),
      mutate: () => {
        revision = 3
        return ok({ token: 'd1', revisionId: 3, warnings: [] })
      },
    })
    const controller = new DocsController(fetcher)
    controller.actions.openDoc(itemWithoutUrl())
    await vi.waitFor(() => { expect(controller.store.getSnapshot().selection?.phase).toBe('ready') })
    controller.actions.startEdit()
    await vi.waitFor(() => { expect(controller.store.getSnapshot().selection?.blocksPhase).toBe('ready') })
    controller.actions.startAppend()
    controller.actions.updateDraft('# draft')
    controller.actions.saveDraft()
    await vi.waitFor(() => { expect(controller.store.getSnapshot().selection?.revisionId).toBe(3) })
    expect(calls.find(call => call.body?.action === 'append')?.body).toMatchObject({ token: 'd1' })
  })

  it('renames through the token when the row has no URL', async () => {
    const { calls, fetcher } = server({
      status: connected(),
      document: documents,
      mutate: () => ok({ token: 'd1', title: 'Renamed', warnings: [] }),
    })
    const controller = new DocsController(fetcher)
    controller.actions.openDoc(itemWithoutUrl())
    await vi.waitFor(() => { expect(controller.store.getSnapshot().selection?.phase).toBe('ready') })
    await expect(controller.actions.rename('Renamed')).resolves.toBe(true)
    expect(calls.find(call => call.body?.action === 'rename')?.body).toMatchObject({ token: 'd1' })
  })

  it('updates the listed row it renamed and leaves the other rows alone', async () => {
    const { fetcher } = server({
      status: connected(),
      recent: page([ITEM, { ...ITEM, token: 'd2', title: [{ text: 'Other', highlighted: false }] }]),
      document: documents,
      mutate: () => ok({ token: 'd1', title: 'Renamed', warnings: [] }),
    })
    const controller = new DocsController(fetcher)
    controller.load()
    await vi.waitFor(() => { expect(controller.store.getSnapshot().items).toHaveLength(2) })
    controller.actions.openDoc(ITEM)
    await vi.waitFor(() => { expect(controller.store.getSnapshot().selection?.phase).toBe('ready') })
    await expect(controller.actions.rename('Renamed')).resolves.toBe(true)
    expect(controller.store.getSnapshot().items.map(item => item.token)).toEqual(['d1', 'd2'])
    expect(controller.store.getSnapshot().items[0]?.title).toEqual([{ text: 'Renamed', highlighted: false }])
    expect(controller.store.getSnapshot().items[1]?.title).toEqual([{ text: 'Other', highlighted: false }])
  })

  it('keeps a non-conflict rename failure without a conflict banner', async () => {
    const { fetcher } = server({
      status: connected(),
      document: documents,
      mutate: () => failure('upstream'),
    })
    const controller = new DocsController(fetcher)
    controller.actions.openDoc(ITEM)
    await vi.waitFor(() => { expect(controller.store.getSnapshot().selection?.phase).toBe('ready') })
    await expect(controller.actions.rename('Renamed')).resolves.toBe(false)
    expect(controller.store.getSnapshot().selection?.renameState).toEqual({ pending: false, errorCode: 'upstream' })
    expect(controller.store.getSnapshot().selection?.banner).toBeUndefined()
  })

  it('ignores a failed write that lands after the drawer closed', async () => {
    const { fetcher, writes } = heldWrite()
    const controller = new DocsController(fetcher)
    controller.actions.openDoc(ITEM)
    await vi.waitFor(() => { expect(controller.store.getSnapshot().selection?.phase).toBe('ready') })
    controller.actions.startEdit()
    await vi.waitFor(() => { expect(controller.store.getSnapshot().selection?.blocksPhase).toBe('ready') })
    controller.actions.startAppend()
    controller.actions.updateDraft('# draft')
    controller.actions.saveDraft()
    await vi.waitFor(() => { expect(writes).toHaveLength(1) })
    controller.actions.closeDoc()
    writes[0]?.(failure('upstream'))
    await new Promise((resolve) => { setTimeout(resolve, 0) })
    expect(controller.store.getSnapshot().selection).toBeUndefined()
  })

  it('marks a conflict on a block delete without a draft and reloads the blocks', async () => {
    const { calls, fetcher } = server({
      status: connected(),
      document: documents,
      mutate: () => failure('conflict'),
    })
    const controller = new DocsController(fetcher)
    controller.actions.openDoc(ITEM)
    await vi.waitFor(() => { expect(controller.store.getSnapshot().selection?.phase).toBe('ready') })
    controller.actions.startEdit()
    await vi.waitFor(() => { expect(controller.store.getSnapshot().selection?.blocksPhase).toBe('ready') })
    const reads = calls.length
    controller.actions.deleteBlock('p1')
    await vi.waitFor(() => { expect(controller.store.getSnapshot().selection?.banner?.kind).toBe('conflict') })
    expect(controller.store.getSnapshot().selection?.editor).toBeUndefined()
    await vi.waitFor(() => { expect(calls.length).toBeGreaterThan(reads + 1) })
  })
})
