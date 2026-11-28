// @vitest-environment jsdom
// The browser entry through real composition: the sidebar entry and the panel it opens
// register through the Slot registry, read through the panel's own routes, and leave with
// the plugin fiber.

import { Context } from '@deepseek-ai/cordis'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { LocaleRuntime } from '@deepseek-ai/dsh-client-locale/client'
import { SlotRegistry } from '@deepseek-ai/dsh-client-ui-renderer/client'
import { resolveSlotLabel } from '@deepseek-ai/dsh-client-ui-slots'
import { apply, inject } from '../src/client/index.ts'
import type { TaskFace } from '../src/client/TaskPanel.tsx'
import { en } from '../src/client/locales.ts'
import { STATUS_ROUTE, TASKS_ROUTE } from '../src/paths.ts'

afterEach(() => { vi.unstubAllGlobals() })

/**
 * Build one route answer.
 * @param data - successful payload.
 * @returns the response.
 */
function respond(data: unknown): Response {
  return new Response(JSON.stringify({ ok: true, data }), { status: 200 })
}

/**
 * Mount the slot registry, the locale runtime, and the routes the panel reads at load.
 * @param navigation - false to leave the Plugins page and its navigation service absent.
 * @returns the Context, its registry, and the recorded route answers.
 */
async function bench(navigation = true) {
  const ctx = new Context()
  const openBundle = vi.fn()
  const fetchStub = vi.fn(async (input: RequestInfo | URL) => String(input) === STATUS_ROUTE
    ? respond({ cli: true, configured: true, connected: true, userName: 'Ada', missingScopes: [] })
    : respond({ tasks: [], view: 'pending', fetchedAt: 'now' }))
  vi.stubGlobal('fetch', fetchStub)
  await ctx.plugin(SlotRegistry).await()
  const locale = new LocaleRuntime(ctx)
  locale.setLocale('en')
  ctx.provide('locale', locale)
  if (navigation) ctx.provide('pluginNavigation', { openBundle, openList: vi.fn() })
  const slots = ctx.get('slots') as SlotRegistry
  slots.register({
    name: 'root',
    children: {
      main: { kind: 'keyed', scope: 'root' },
      'sidebar.panellist': { kind: 'list', scope: 'root' },
    },
  } as never, () => null)
  return { ctx, slots, locale, openBundle, fetchStub }
}

describe('feishu-task browser plugin', () => {
  it('registers the panel and its sidebar entry under the shared id', async () => {
    const b = await bench()
    const fiber = b.ctx.plugin({ inject: [...inject], apply })
    await fiber.await()

    await vi.waitFor(() => { expect(b.slots.entries('main')).toHaveLength(1) })
    expect(b.slots.entries('main')[0]?.options).toMatchObject({ key: 'feishu-task' })
    expect(b.slots.entries('main')[0]?.locale).toBe('feishuTask')
    const entry = b.slots.entries('sidebar.panellist')[0]!
    expect(entry.options).toMatchObject({ id: 'feishu-task', order: 110 })
    expect(entry.locale).toBe('feishuTask')
    expect(resolveSlotLabel(entry.options.label)).toBe(en.panel)

    await fiber.dispose()
    await b.ctx.fiber.dispose()
  })

  it('reads status and the list through the panel routes at load', async () => {
    const b = await bench()
    const fiber = b.ctx.plugin({ inject: [...inject], apply })
    await fiber.await()
    await vi.waitFor(() => { expect(b.slots.entries('main')).toHaveLength(1) })

    const injected: object = b.slots.entries('main')[0]!.inject!()
    const face = injected as TaskFace
    await vi.waitFor(() => { expect(face.hooks.task.getSnapshot().phase).toBe('ready') })
    expect(b.fetchStub.mock.calls.map(call => String(call[0]))).toEqual([STATUS_ROUTE, `${TASKS_ROUTE}?view=pending`])
    expect(face.hooks.task.getSnapshot().userName).toBe('Ada')

    await fiber.dispose()
    await b.ctx.fiber.dispose()
  })

  it('asks the Plugins page for the Feishu bundle when the connect prompt is used', async () => {
    const b = await bench()
    const fiber = b.ctx.plugin({ inject: [...inject], apply })
    await fiber.await()
    await vi.waitFor(() => { expect(b.slots.entries('main')).toHaveLength(1) })

    const injected: object = b.slots.entries('main')[0]!.inject!()
    const face = injected as TaskFace
    expect(face.hooks.pluginNavigation.getSnapshot()).toBe(true)
    face.navigation.connectFeishu()
    expect(b.openBundle).toHaveBeenCalledWith('@deepseek-ai/dsh-feishu')

    await fiber.dispose()
    expect(face.hooks.pluginNavigation.getSnapshot()).toBe(false)
    await b.ctx.fiber.dispose()
  })

  it('reports a missing Plugins page instead of offering navigation', async () => {
    const b = await bench(false)
    const fiber = b.ctx.plugin({ inject: [...inject], apply })
    await fiber.await()
    await vi.waitFor(() => { expect(b.slots.entries('main')).toHaveLength(1) })

    const injected: object = b.slots.entries('main')[0]!.inject!()
    const face = injected as TaskFace
    expect(face.hooks.pluginNavigation.getSnapshot()).toBe(false)
    expect(() => { face.navigation.connectFeishu() }).not.toThrow()

    await fiber.dispose()
    await b.ctx.fiber.dispose()
  })

  it('contributes its dictionaries and withdraws everything with the fiber', async () => {
    const b = await bench()
    const fiber = b.ctx.plugin({ inject: [...inject], apply })
    await fiber.await()
    expect(b.locale.bind('feishuTask')('title')).toBe(en.title)

    await fiber.dispose()

    expect(b.locale.bind('feishuTask')('title')).not.toBe(en.title)
    expect(b.slots.entries('main')).toEqual([])
    expect(b.slots.entries('sidebar.panellist')).toEqual([])
    await b.ctx.fiber.dispose()
  })
})
