// @vitest-environment jsdom
// Panel presentation: the five states, month controls, the agenda and grid, the drawer, the dialog,
// and the sidebar glyph.

import { cleanup, fireEvent, render, screen, within } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots'
import type { CalendarActions, CalendarViewState } from '../src/client/controller.ts'
import { CalendarIcon } from '../src/client/CalendarIcon.tsx'
import { CalendarPanel, type CalendarPanelProps } from '../src/client/CalendarPanel.tsx'
import { localDay } from '../src/client/format.ts'
import { en, type CalendarLocaleKey } from '../src/client/locales.ts'
import { monthKey } from '../src/client/month.ts'
import type { CalendarEvent, CalendarEventDetail } from '../src/types.ts'

afterEach(cleanup)

const t = (key: string, params?: Record<string, unknown>): string =>
  Object.entries(params ?? {}).reduce((text, [name, value]) => text.replaceAll(`{${name}}`, String(value)), en[key as CalendarLocaleKey] ?? key)

const today = localDay(new Date())
const thisMonth = monthKey(new Date())

/** One loaded month. */
function stateOf(overrides: Partial<CalendarViewState> = {}): CalendarViewState {
  return { phase: 'ready', month: thisMonth, weekStart: 'monday', events: [], ...overrides }
}

/** Every action as a no-op unless the case replaces it. */
function actionsStub(overrides: Partial<CalendarActions> = {}): CalendarActions {
  const noop = (): void => {}
  return {
    previousMonth: noop,
    nextMonth: noop,
    goToToday: noop,
    refresh: noop,
    openEvent: noop,
    closeEvent: noop,
    retryDetail: noop,
    openCreate: noop,
    openEdit: noop,
    closeCreate: noop,
    submitCreate: noop,
    deleteEvent: noop,
    ...overrides,
  }
}

/** The props the panel reads; the framework seats it never touches stay out of the fixture. */
type PanelReads = Pick<CalendarPanelProps, 't' | 'actions' | 'useCalendar'>

/** The props the renderer assembles for the panel. */
function panelProps(state: CalendarViewState, overrides: Partial<CalendarActions> = {}): CalendarPanelProps {
  const reads: PanelReads = {
    t,
    actions: actionsStub(overrides),
    useCalendar: selector => selector(state),
  }
  return reads as CalendarPanelProps
}

/** One all-day event on today's date. */
const TODAY_EVENT: CalendarEvent = {
  eventId: 'today',
  summary: 'Offsite',
  allDay: true,
  start: today,
  end: today,
  sourceTimezone: 'Asia/Shanghai',
  status: 'confirmed',
  isException: false,
}

const DETAIL: CalendarEventDetail = {
  eventId: 'today',
  summary: 'Offsite',
  allDay: true,
  start: today,
  end: today,
  sourceTimezone: 'Asia/Shanghai',
  status: 'confirmed',
  isException: false,
}

describe('CalendarPanel states', () => {
  it('shows the loading notice', () => {
    render(<CalendarPanel {...panelProps(stateOf({ phase: 'loading' }))} />)
    expect(screen.getByRole('status').textContent).toBe('Loading events…')
    expect(screen.queryByRole('grid')).toBeNull()
  })

  it('names a missing permission, a missing configuration, and a signed-out account', () => {
    const { unmount } = render(<CalendarPanel {...panelProps(stateOf({ phase: 'unavailable', errorCode: 'permission-denied' }))} />)
    expect(screen.getByRole('status').textContent).toBe('The Feishu app is missing calendar permissions')
    unmount()
    const configured = render(<CalendarPanel {...panelProps(stateOf({ phase: 'unavailable', errorCode: 'not-configured' }))} />)
    expect(screen.getByRole('status').textContent).toBe('No Feishu app is configured yet')
    configured.unmount()
    render(<CalendarPanel {...panelProps(stateOf({ phase: 'unavailable', errorCode: 'not-connected' }))} />)
    expect(screen.getByRole('status').textContent).toBe('Connect Feishu to see your calendar')
  })

  it('names a missing CLI and retries', () => {
    const refresh = vi.fn()
    render(<CalendarPanel {...panelProps(stateOf({ phase: 'error', errorCode: 'cli-missing' }), { refresh })} />)
    expect(screen.getByRole('alert').textContent).toContain('lark-cli is missing; check the Feishu plugin install')
    fireEvent.click(screen.getByRole('button', { name: 'Retry' }))
    expect(refresh).toHaveBeenCalledTimes(1)
  })

  it('reports a failed read and retries', () => {
    const refresh = vi.fn()
    render(<CalendarPanel {...panelProps(stateOf({ phase: 'error', errorCode: 'upstream' }), { refresh })} />)
    expect(screen.getByRole('alert').textContent).toContain('Could not read the calendar')
    fireEvent.click(screen.getByRole('button', { name: 'Retry' }))
    expect(refresh).toHaveBeenCalledTimes(1)
  })

  it('renders the agenda and the stacked grid when the month is ready', () => {
    render(<CalendarPanel {...panelProps(stateOf({ events: [TODAY_EVENT] }))} />)
    expect(screen.getByRole('grid')).toBeTruthy()
    expect(screen.getAllByRole('gridcell')).toHaveLength(42)
    // Today's event appears once in the agenda and once as the day's chip.
    expect(screen.getAllByRole('button', { name: /Offsite/ })).toHaveLength(2)
  })

  it('names the shown month in the header', () => {
    render(<CalendarPanel {...panelProps(stateOf())} />)
    expect(screen.getByRole('heading', { level: 2 }).textContent).toBe('Calendar')
    expect(screen.getByText(new RegExp(String(new Date().getFullYear())))).toBeTruthy()
  })
})

describe('CalendarPanel controls', () => {
  it('forwards every header control', () => {
    const previousMonth = vi.fn()
    const nextMonth = vi.fn()
    const goToToday = vi.fn()
    const refresh = vi.fn()
    const openCreate = vi.fn()
    render(<CalendarPanel {...panelProps(stateOf(), { previousMonth, nextMonth, goToToday, refresh, openCreate })} />)
    fireEvent.click(screen.getByRole('button', { name: 'Previous month' }))
    fireEvent.click(screen.getByRole('button', { name: 'Next month' }))
    fireEvent.click(screen.getByRole('button', { name: 'Today' }))
    fireEvent.click(screen.getByRole('button', { name: 'Refresh' }))
    fireEvent.click(screen.getByRole('button', { name: 'New event' }))
    expect(previousMonth).toHaveBeenCalledTimes(1)
    expect(nextMonth).toHaveBeenCalledTimes(1)
    expect(goToToday).toHaveBeenCalledTimes(1)
    expect(refresh).toHaveBeenCalledTimes(1)
    // The header button opens the dialog for today, not for a cell.
    expect(openCreate).toHaveBeenCalledWith()
  })

  it('opens a day from the grid and the agenda', () => {
    const openEvent = vi.fn()
    render(<CalendarPanel {...panelProps(stateOf({ events: [TODAY_EVENT] }), { openEvent })} />)
    const [agendaRow, chip] = screen.getAllByRole('button', { name: /Offsite/ })
    fireEvent.click(agendaRow as HTMLElement)
    fireEvent.click(chip as HTMLElement)
    expect(openEvent).toHaveBeenCalledTimes(2)
    expect(openEvent).toHaveBeenCalledWith('today')
  })

  it('highlights the event created by the last submit', () => {
    render(<CalendarPanel {...panelProps(stateOf({ events: [TODAY_EVENT], highlightEventId: 'today' }))} />)
    const chip = within(screen.getByRole('grid')).getByRole('button', { name: /Offsite/ })
    expect(chip.className).toContain('chipHighlight')
  })
})

describe('CalendarPanel overlays', () => {
  it('shows the drawer for the open event', () => {
    const closeEvent = vi.fn()
    render(<CalendarPanel {...panelProps(stateOf({ selection: { eventId: 'today', phase: 'ready', detail: DETAIL } }), { closeEvent })} />)
    const drawer = screen.getByRole('dialog', { name: 'Offsite' })
    expect(drawer).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }))
    expect(closeEvent).toHaveBeenCalledTimes(1)
  })

  it('shows the create dialog for the open composer', () => {
    const closeCreate = vi.fn()
    render(<CalendarPanel {...panelProps(stateOf({ composer: { open: true, mode: 'create', pending: false } }), { closeCreate })} />)
    expect(screen.getByRole('dialog', { name: 'New event' })).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }))
    expect(closeCreate).toHaveBeenCalledTimes(1)
  })
})

describe('CalendarIcon', () => {
  it('draws the month glyph at the sidebar size', () => {
    const props = { size: 16, active: false } as PropsRuntime<'sidebar.panellist'>
    const { container } = render(<CalendarIcon {...props} />)
    const svg = container.querySelector('svg')
    expect(svg?.getAttribute('width')).toBe('16')
    expect(svg?.getAttribute('aria-hidden')).toBe('true')
  })
})
