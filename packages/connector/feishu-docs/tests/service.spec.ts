// Docs service behavior over a recorded command runner: command construction, field
// normalization, caching, bounds, block writes, conflict mapping, and creation.

import { afterEach, describe, expect, it, vi } from 'vitest'
import { authStatus, fail, searchResult, serviceOver, succeed } from './harness.ts'

describe('DocsService.status', () => {
  it('reports the scopes the token lacks', async () => {
    const { service } = serviceOver(() => authStatus('docx:document:readonly'))
    await expect(service.status()).resolves.toMatchObject({
      cli: true,
      configured: true,
      connected: true,
      userName: 'Ada',
      missingScopes: [
        'docs:document.content:read',
        'drive:drive.metadata:readonly',
        'search:docs:read',
        'wiki:node:read',
      ],
    })
  })
})

describe('DocsService.recent', () => {
  it('reads the window with the requested ordering and normalizes rows', async () => {
    const { service, calls } = serviceOver(() => succeed({
      results: [
        searchResult(),
        {
          entity_type: 'WIKI',
          result_meta: { token: 'wik1', url: 'https://example.test/wiki/wik1', owner_name: 'Zoe' },
          title_highlighted: 'Wiki',
        },
      ],
      has_more: true,
      page_token: 'p2',
      total: 5,
    }))
    const data = await service.recent(30, 'open')
    expect(calls[0]?.args).toEqual([
      'drive', '+search', '--opened-since', '30d', '--sort', 'open_time', '--page-size', '20',
    ])
    expect(data.items[0]).toMatchObject({
      token: 'doccn1',
      type: 'docx',
      entityType: 'DOC',
      url: 'https://example.test/docx/doccn1',
      ownerName: 'Ada',
      editorName: 'Bo',
      lastOpenedAt: '2026-11-26T08:13:11+08:00',
      updatedAt: '2026-11-25T23:12:18+08:00',
      isFolder: false,
    })
    expect(data.items[0]?.title).toEqual([{ text: 'Doc', highlighted: false }])
    expect(data.items[1]).toMatchObject({ token: 'wik1', type: 'wiki', entityType: 'WIKI' })
    expect(data).toMatchObject({ hasMore: true, pageToken: 'p2', total: 5 })
  })

  it('sorts by edit time when asked', async () => {
    const { service, calls } = serviceOver(() => succeed({ results: [] }))
    await service.recent(7, 'edit')
    expect(calls[0]?.args).toEqual([
      'drive', '+search', '--opened-since', '7d', '--sort', 'edit_time', '--page-size', '20',
    ])
  })

  it('rejects an unsupported window before starting a process', async () => {
    const { service, calls } = serviceOver(() => succeed({ results: [] }))
    await expect(service.recent(14 as 7, 'open')).rejects.toMatchObject({ code: 'invalid-input' })
    expect(calls).toHaveLength(0)
  })

  it('serves a repeated read from cache and honors refresh', async () => {
    const { service, calls } = serviceOver(() => succeed({ results: [] }))
    await service.recent(30, 'open')
    await service.recent(30, 'open')
    expect(calls).toHaveLength(1)
    await service.recent(30, 'open', true)
    expect(calls).toHaveLength(2)
  })
})

describe('DocsService.search', () => {
  it('passes the keyword, types, and ownership filter', async () => {
    const { service, calls } = serviceOver(() => succeed({ results: [searchResult()], has_more: false, total: 1 }))
    const data = await service.search('DSH 工作流', { types: ['docx', 'wiki'], mine: true })
    expect(calls[0]?.args).toEqual([
      'drive', '+search', '--query', 'DSH 工作流', '--page-size', '20',
      '--doc-types', 'docx,wiki', '--mine',
    ])
    expect(data.total).toBe(1)
  })

  it('rejects a query longer than 30 code points before starting a process', async () => {
    const { service, calls } = serviceOver(() => succeed({ results: [] }))
    await expect(service.search('a'.repeat(31))).rejects.toMatchObject({ code: 'invalid-input' })
    expect(calls).toHaveLength(0)
  })

  it('accepts a 30-code-point query, counting CJK as one each', async () => {
    const { service, calls } = serviceOver(() => succeed({ results: [] }))
    await service.search('云'.repeat(30))
    expect(calls[0]?.args[3]).toBe('云'.repeat(30))
  })

  it('rejects an empty query and an unknown type', async () => {
    const { service } = serviceOver(() => succeed({ results: [] }))
    await expect(service.search('  ')).rejects.toMatchObject({ code: 'invalid-input' })
    await expect(service.search('x', { types: ['nope'] })).rejects.toMatchObject({ code: 'invalid-input' })
  })
})

describe('DocsService.files', () => {
  it('reads one folder page with the requested ordering', async () => {
    const { service, calls } = serviceOver(() => succeed({
      files: [{ name: '个人任务', type: 'bitable', token: 'b1', url: 'https://example.test/base/b1', modified_time: '1781530248' }],
      has_more: false,
    }))
    const data = await service.files('f1', 'EditedTime', 'p2')
    expect(calls[0]?.args).toEqual([
      'drive', 'files', 'list', '--folder-token', 'f1', '--order-by', 'EditedTime', '--page-token', 'p2',
    ])
    expect(data.items[0]).toMatchObject({ token: 'b1', type: 'bitable', isFolder: false })
    expect(data.items[0]?.updatedAt).toBe(new Date(1781530248 * 1000).toISOString())
  })

  it('reads the cloud-space root without a folder token', async () => {
    const { service, calls } = serviceOver(() => succeed({ files: [], has_more: false }))
    await service.files(undefined, undefined, undefined)
    expect(calls[0]?.args).toEqual(['drive', 'files', 'list'])
  })
})

describe('DocsService.document', () => {
  it('reads an outline body as simple Markdown', async () => {
    const { service, calls } = serviceOver(() => succeed({
      document: { content: '## A', document_id: 'd1', revision_id: 3 },
    }))
    const data = await service.document('d1', 'outline')
    expect(calls[0]?.args).toEqual([
      'docs', '+fetch', '--doc', 'd1', '--scope', 'outline',
      '--doc-format', 'markdown', '--detail', 'simple',
    ])
    expect(data).toEqual({ mode: 'outline', token: 'd1', content: '## A', truncated: false, revisionId: 3 })
  })

  it('bounds the full body at 4000 code points and marks it', async () => {
    const { service } = serviceOver(() => succeed({
      document: { content: 'x'.repeat(4001), document_id: 'd1', revision_id: 4 },
    }))
    const data = await service.document('d1', 'full')
    expect(data).toMatchObject({ mode: 'full', truncated: true, revisionId: 4 })
    expect(data.mode === 'full' ? data.content.length : 0).toBe(4000)
  })

  it('parses the with-ids XML into the block list', async () => {
    const { service, calls } = serviceOver(() => succeed({
      document: {
        content: '<title id="t">Doc</title><p id="p1">one</p><img id="i1" src="x"/>',
        document_id: 'd1',
        revision_id: 9,
      },
    }))
    const data = await service.document('d1', 'blocks')
    expect(calls[0]?.args).toEqual([
      'docs', '+fetch', '--doc', 'd1', '--scope', 'full',
      '--detail', 'with-ids', '--doc-format', 'xml',
    ])
    expect(data).toEqual({
      mode: 'blocks',
      token: 'd1',
      title: 'Doc',
      revisionId: 9,
      blocks: [
        { blockId: 'p1', tag: 'p', text: 'one', editable: true },
        { blockId: 'i1', tag: 'img', text: '', editable: false },
      ],
    })
  })

  it('rejects a blank token', async () => {
    const { service } = serviceOver(() => succeed({}))
    await expect(service.document('  ', 'outline')).rejects.toMatchObject({ code: 'invalid-input' })
  })
})

describe('DocsService.mutate', () => {
  it('appends Markdown through stdin with the base revision', async () => {
    const { service, calls } = serviceOver(() => succeed({
      document: { revision_id: 4 },
      result: 'success',
      updated_blocks_count: 1,
      warnings: [],
    }))
    const result = await service.mutate({
      action: 'append',
      token: 'https://example.test/docx/d1',
      revisionId: 3,
      content: '# hi',
    })
    expect(calls[0]?.args).toEqual([
      'docs', '+update', '--doc', 'https://example.test/docx/d1', '--command', 'append',
      '--doc-format', 'markdown', '--content', '-', '--revision-id', '3',
    ])
    expect(calls[0]?.stdin).toBe('# hi')
    expect(result).toEqual({ token: 'https://example.test/docx/d1', revisionId: 4, result: 'success', updatedBlocks: 1, warnings: [] })
  })

  it('rewrites one block with escaped XML in the argument list', async () => {
    const { service, calls } = serviceOver(() => succeed({ document: { revision_id: 5 }, result: 'success', warnings: [] }))
    await service.mutate({
      action: 'replace-block',
      token: 'd1',
      revisionId: 4,
      blockId: 'b1',
      tag: 'p',
      content: 'a < b & c',
    })
    expect(calls[0]?.args).toEqual([
      'docs', '+update', '--doc', 'd1', '--command', 'block_replace', '--block-id', 'b1',
      '--content', '<p>a &lt; b &amp; c</p>', '--revision-id', '4',
    ])
  })

  it('deletes one block with the base revision', async () => {
    const { service, calls } = serviceOver(() => succeed({ document: { revision_id: 6 }, result: 'success', warnings: [] }))
    await service.mutate({ action: 'delete-block', token: 'd1', revisionId: 5, blockId: 'b9' })
    expect(calls[0]?.args).toEqual([
      'docs', '+update', '--doc', 'd1', '--command', 'block_delete', '--block-id', 'b9', '--revision-id', '5',
    ])
  })

  it('maps a stale base revision to conflict', async () => {
    const { service } = serviceOver(() => fail({ type: 'api', code: 1200000, message: 'revision conflict' }))
    await expect(service.mutate({
      action: 'append',
      token: 'd1',
      revisionId: 1,
      content: 'x',
    })).rejects.toMatchObject({ code: 'conflict' })
  })

  it('keeps partial success and its warnings', async () => {
    const { service } = serviceOver(() => succeed({
      document: { revision_id: 7 },
      result: 'partial_success',
      updated_blocks_count: 2,
      warnings: ['one block skipped', 'second warning'],
    }))
    const result = await service.mutate({ action: 'append', token: 'd1', revisionId: 6, content: 'x' })
    expect(result.result).toBe('partial_success')
    expect(result.warnings).toEqual(['one block skipped', 'second warning'])
    expect(result.revisionId).toBe(7)
  })

  it('rejects a block tag outside the whitelist before starting a process', async () => {
    const { service, calls } = serviceOver(() => succeed({}))
    await expect(service.mutate({
      action: 'replace-block',
      token: 'd1',
      revisionId: 1,
      blockId: 'b1',
      tag: 'sheet',
      content: 'x',
    })).rejects.toMatchObject({ code: 'invalid-input' })
    expect(calls).toHaveLength(0)
  })

  it('renames through the drive shortcut and rejects an empty title', async () => {
    const { service, calls } = serviceOver(() => succeed({ data: {} }))
    await expect(service.mutate({ action: 'rename', token: 'https://example.test/docx/d1', title: 'New' }))
      .resolves.toMatchObject({ title: 'New', warnings: [] })
    expect(calls[0]?.args).toEqual([
      'drive', '+update-title', '--url', 'https://example.test/docx/d1', '--title', 'New',
    ])
    await expect(service.mutate({ action: 'rename', token: 'd1', title: '  ' }))
      .rejects.toMatchObject({ code: 'invalid-input' })
    expect(calls).toHaveLength(1)
  })
})

describe('DocsService.create', () => {
  afterEach(() => { vi.useRealTimers() })

  it('creates one document synchronously with its Markdown body through stdin', async () => {
    const { service, calls } = serviceOver(() => succeed({
      document: { document_id: 'new1', url: 'https://example.test/docx/new1' },
    }))
    await expect(service.create({ title: 'New', content: 'body' })).resolves.toEqual({
      documentId: 'new1',
      url: 'https://example.test/docx/new1',
      pending: false,
    })
    expect(calls[0]?.args).toEqual([
      'docs', '+create', '--title', 'New', '--content', '-', '--doc-format', 'markdown',
    ])
    expect(calls[0]?.stdin).toBe('body')
  })

  it('places the document under the parent token when given', async () => {
    const { service, calls } = serviceOver(() => succeed({ document: { document_id: 'new2' } }))
    await service.create({ title: 'New', parentToken: 'f1' })
    expect(calls[0]?.args).toEqual([
      'docs', '+create', '--title', 'New', '--content', '-', '--doc-format', 'markdown', '--parent-token', 'f1',
    ])
  })

  it('polls an asynchronous create until it reports a document', async () => {
    vi.useFakeTimers()
    const { service } = serviceOver(({ args }) => (args[0] === 'docs' && args[1] === '+create'
      ? succeed({ task_id: 'task1' })
      : succeed({ task: { status: 'succeeded', document_id: 'new3', url: 'https://example.test/docx/new3' } })))
    const pending = service.create({ title: 'New' })
    await vi.runAllTimersAsync()
    await expect(pending).resolves.toEqual({
      documentId: 'new3',
      url: 'https://example.test/docx/new3',
      pending: false,
    })
  })

  it('reports unknown-outcome when the poll budget ends', async () => {
    vi.useFakeTimers()
    const { service } = serviceOver(({ args }) => (args[0] === 'docs' && args[1] === '+create'
      ? succeed({ task_id: 'task1' })
      : succeed({ task: { status: 'running' } })))
    const pending = service.create({ title: 'New' })
    const assertion = expect(pending).rejects.toMatchObject({ code: 'unknown-outcome' })
    await vi.runAllTimersAsync()
    await assertion
  })

  it('rejects an oversized title before starting a process', async () => {
    const { service, calls } = serviceOver(() => succeed({}))
    await expect(service.create({ title: 'a'.repeat(201) })).rejects.toMatchObject({ code: 'invalid-input' })
    expect(calls).toHaveLength(0)
  })
})
