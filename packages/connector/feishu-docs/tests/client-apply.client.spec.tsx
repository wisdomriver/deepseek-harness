// @vitest-environment jsdom
// The docs browser half: dictionaries, the sidebar entry, the main panel registration, the
// controller it shares with them, and the first read the panel performs at load.

import { Context } from '@deepseek-ai/cordis'
import { LocaleRuntime } from '@deepseek-ai/dsh-client-locale/client'
import { SlotRegistry } from '@deepseek-ai/dsh-client-ui-renderer/client'
import { afterEach, describe, expect, it, onTestFinished, vi } from 'vitest'
import { DocIcon } from '../src/client/DocIcon.tsx'
import { DocPanel, type DocsFace } from '../src/client/DocPanel.tsx'
import { apply, inject } from '../src/client/index.ts'
import { RECENT_ROUTE, STATUS_ROUTE } from '../src/paths.ts'
import type { DocItem } from '../src/types.ts'

afterEach(() => { vi.unstubAllGlobals() })

/** One listed row the recorded recent page carries. */
const ITEM: DocItem = {
  token: 'd1',
  title: [{ text: 'Doc', highlighted: false }],
  type: 'docx',
  entityType: 'DOC',
  isFolder: false,
  url: 'https://example.test/docx/d1',
}

/**
 * Record one successful route answer.
 * @param data - payload the envelope carries.
 * @returns the response.
 */
function answer(data: unknown): Response {
  return new Response(JSON.stringify({ ok: true, data }), { status: 200 })
}

/**
 * Read one slot entry's injected face.
 * @param entry - slot entry the registry recorded.
 * @returns the face the entry's inject callback returns.
 */
function injectedOf(entry: { inject?: (() => object) | undefined } | undefined): object {
  if (entry?.inject === undefined) throw new Error('slot entry has no injection')
  return entry.inject()
}

/** A host context with slots, locale, a declared panel surface, and a recorded fetch. */
async function bench() {
  const ctx = new Context()
  onTestFinished(() => ctx.fiber.dispose())
  await ctx.plugin(SlotRegistry).await()
  const slots = ctx.get('slots') as SlotRegistry
  slots.register({
    name: 'root',
    children: {
      'main': { kind: 'keyed', scope: 'root' },
      'sidebar.panellist': { kind: 'list', scope: 'root' },
    },
  } as never, () => null)
  const locale = new LocaleRuntime(ctx)
  ctx.provide('locale', locale)
  const fetcher = vi.fn(async (input: string | URL) => (String(input).startsWith(STATUS_ROUTE)
    ? answer({ cli: true, configured: true, connected: true, missingScopes: [] })
    : answer({ items: [ITEM], hasMore: false, fetchedAt: 'now' })))
  vi.stubGlobal('fetch', fetcher)
  const fiber = ctx.plugin({ inject: [...inject], apply })
  await fiber.await()
  return { ctx, slots, locale, fetcher, fiber }
}

describe('feishu-docs browser plugin', () => {
  it('declares the two services it drives', () => {
    expect(inject).toEqual(['slots', 'locale'])
  })

  it('registers the panel and the sidebar entry for its lifetime', async () => {
    const b = await bench()
    const panel = b.slots.entries('main')[0]
    expect(panel?.component).toBe(DocPanel)
    expect(panel?.options).toMatchObject({ key: 'feishu-docs' })
    const entry = b.slots.entries('sidebar.panellist')[0]
    expect(entry?.component).toBe(DocIcon)
    expect(entry?.options).toMatchObject({ id: 'feishu-docs', order: 120 })
    const label = (entry?.options as { label?: () => string } | undefined)?.label
    expect(label?.()).toBe('Docs')
    b.locale.setLocale('zh')
    expect(label?.()).toBe('云文档')

    await b.fiber.dispose()
    expect(b.slots.entries('main')).toEqual([])
    expect(b.slots.entries('sidebar.panellist')).toEqual([])
    expect(b.locale.bind('feishuDocs')('panel')).toBe('panel')
  })

  it('shares one controller between the injected hooks and actions', async () => {
    const b = await bench()
    const face = injectedOf(b.slots.entries('main')[0]) as DocsFace
    await vi.waitFor(() => { expect(face.hooks.docs.getSnapshot().phase).toBe('ready') })
    expect(face.hooks.docs.getSnapshot().items).toEqual([ITEM])
    expect(b.fetcher.mock.calls.map(call => String(call[0]))[0]).toBe(STATUS_ROUTE)
    expect(String(b.fetcher.mock.calls[1]?.[0]).startsWith(`${RECENT_ROUTE}?days=30&sort=open`)).toBe(true)

    face.actions.setView('files')
    await vi.waitFor(() => {
      expect(String(b.fetcher.mock.calls.at(-1)?.[0])).toContain('api/feishu-docs/files?orderBy=EditedTime')
    })
    expect(face.hooks.docs.getSnapshot().view).toBe('files')
  })
})
