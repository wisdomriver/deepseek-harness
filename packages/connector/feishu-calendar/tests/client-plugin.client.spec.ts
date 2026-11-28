// Browser plugin wiring: the dictionary, the panel entry, the sidebar entry, and the first month read,
// all withdrawn together when the plugin unloads.

import { Context, type Fiber } from '@deepseek-ai/cordis'
import { LocaleRuntime } from '@deepseek-ai/dsh-client-locale/client'
import { SlotRegistry } from '@deepseek-ai/dsh-client-ui-renderer/client'
import { resolveSlotLabel, type StoredEntry } from '@deepseek-ai/dsh-client-ui-slots'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { CalendarIcon } from '../src/client/CalendarIcon.tsx'
import { CalendarPanel } from '../src/client/CalendarPanel.tsx'
import { apply, inject } from '../src/client/index.ts'
import { EVENTS_ROUTE, STATUS_ROUTE } from '../src/paths.ts'

/** Every context a test started, disposed afterwards. */
const started: Context[] = []

afterEach(async () => {
  vi.unstubAllGlobals()
  for (const ctx of started.splice(0)) await ctx.fiber.dispose()
})

const STATUS = {
  cli: true,
  configured: true,
  connected: true,
  userName: 'Ada',
  missingScopes: [],
  weekStart: 'monday',
}

/** The month the panel reads once it knows the account. */
const MONTH = { events: [], fetchedAt: 'now' }

/** One slot registration as the registry stores it. */
type Entry = StoredEntry

/**
 * Build the browser context the plugin expects and mount it.
 * @returns the context, the mounted plugin, the fetch stub, and every entry each slot holds.
 */
async function mount(): Promise<{
  readonly ctx: Context
  readonly fiber: Fiber
  readonly fetched: string[]
  readonly main: () => readonly Entry[]
  readonly sidebar: () => readonly Entry[]
}> {
  const ctx = new Context()
  started.push(ctx)
  const fetched: string[] = []
  vi.stubGlobal('fetch', async (input: RequestInfo | URL) => {
    const route = String(input)
    fetched.push(route)
    const data = route.startsWith(STATUS_ROUTE) ? STATUS : MONTH
    return new Response(JSON.stringify({ ok: true, data }), { status: 200 })
  })
  const locale = new LocaleRuntime(ctx)
  locale.setLocale('en')
  ctx.provide('locale', locale)
  await ctx.plugin(SlotRegistry)
  ctx.slots.register({
    name: 'root',
    children: {
      'main': { kind: 'keyed', scope: 'root' },
      'sidebar.panellist': { kind: 'list', scope: 'root' },
    },
  } as never, () => null)
  const fiber = await ctx.plugin({ inject: [...inject], apply })
  return {
    ctx,
    fiber,
    fetched,
    main: () => ctx.slots.entries('main'),
    sidebar: () => ctx.slots.entries('sidebar.panellist'),
  }
}

describe('calendar browser plugin', () => {
  it('registers the dictionary, the panel entry, and the sidebar entry', async () => {
    const harness = await mount()
    expect(harness.ctx.locale.bind('feishuCalendar')('panel')).toBe('Calendar')
    const [panel] = harness.main()
    expect(panel).toMatchObject({ locale: 'feishuCalendar', component: CalendarPanel })
    expect(panel?.options.key).toBe('feishu-calendar')
    const [entry] = harness.sidebar()
    expect(entry).toMatchObject({ component: CalendarIcon, locale: 'feishuCalendar' })
    expect(entry?.options).toMatchObject({ id: 'feishu-calendar', order: 100 })
    expect(resolveSlotLabel(entry!.options.label)).toBe('Calendar')
  })

  it('injects the controller store and actions into the panel', async () => {
    const harness = await mount()
    const [entry] = harness.main()
    const face = entry?.inject?.() as {
      hooks: { calendar: { getSnapshot: () => { phase: string } } }
      actions: { previousMonth: () => void }
    } | undefined
    expect(face).toBeDefined()
    expect(typeof face?.actions.previousMonth).toBe('function')
    // The panel reads the month through the store the controller owns.
    await vi.waitFor(() => { expect(face?.hooks.calendar.getSnapshot().phase).toBe('ready') })
  })

  it('reads the account and the shown month as soon as it loads', async () => {
    const harness = await mount()
    await vi.waitFor(() => { expect(harness.fetched.length).toBeGreaterThanOrEqual(2) })
    expect(harness.fetched[0]).toBe(STATUS_ROUTE)
    expect(harness.fetched[1]?.startsWith(`${EVENTS_ROUTE}?start=`)).toBe(true)
  })

  it('withdraws both entries, the dictionary, and the controller on unload', async () => {
    const harness = await mount()
    expect(harness.main()).toHaveLength(1)
    expect(harness.sidebar()).toHaveLength(1)
    await harness.fiber.dispose()
    expect(harness.main()).toHaveLength(0)
    expect(harness.sidebar()).toHaveLength(0)
    expect(harness.ctx.locale.bind('feishuCalendar')('panel')).toBe('panel')
  })
})
