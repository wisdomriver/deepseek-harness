// @vitest-environment jsdom
// Detail drawer: fields, Feishu link, Escape close, retry, and loading state.

import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { EventDetail } from '../src/client/EventDetail.tsx'
import { en, type CalendarLocaleKey } from '../src/client/locales.ts'
import type { CalendarEventDetail } from '../src/types.ts'

afterEach(cleanup)

const t = (key: CalendarLocaleKey, params?: Record<string, unknown>): string =>
  Object.entries(params ?? {}).reduce((text, [name, value]) => text.replaceAll(`{${name}}`, String(value)), en[key])

const detail: CalendarEventDetail = {
  eventId: 'e1',
  summary: 'Sync',
  allDay: false,
  start: '2026-11-25T10:00:00+08:00',
  end: '2026-11-25T11:00:00+08:00',
  sourceTimezone: 'Asia/Shanghai',
  status: 'confirmed',
  isException: false,
  organizer: 'Ada',
  selfRsvpStatus: 'accept',
  recurrence: 'FREQ=WEEKLY;COUNT=3',
  appLink: 'https://applink.feishu.cn/event/e1',
}

describe('EventDetail', () => {
  it('renders the fields and the Feishu link', () => {
    render(<EventDetail selection={{ eventId: 'e1', phase: 'ready', detail }} t={t} onClose={() => {}} onRetry={() => {}} onEdit={() => {}} onDelete={() => {}} />)
    expect(screen.getByRole('heading', { name: 'Sync' })).toBeTruthy()
    expect(screen.getByText('Asia/Shanghai')).toBeTruthy()
    expect(screen.getByText('Ada')).toBeTruthy()
    expect(screen.getByText('Accepted')).toBeTruthy()
    expect(screen.getByText('Weekly · 3 times')).toBeTruthy()
    expect(screen.getByRole('link', { name: 'Open in Feishu' }).getAttribute('href')).toBe(detail.appLink)
  })

  it('falls back to copying when the detail carries no link', () => {
    const { appLink: _dropped, ...withoutLink } = detail
    render(
      <EventDetail
        selection={{ eventId: 'e1', phase: 'ready', detail: withoutLink }}
        t={t}
        onClose={() => {}}
        onRetry={() => {}}
        onEdit={() => {}}
        onDelete={() => {}}
      />,
    )
    expect(screen.getByRole('button', { name: 'Copy event info' })).toBeTruthy()
  })

  it('closes on Escape', () => {
    const onClose = vi.fn()
    render(<EventDetail selection={{ eventId: 'e1', phase: 'loading' }} t={t} onClose={onClose} onRetry={() => {}} onEdit={() => {}} onDelete={() => {}} />)
    fireEvent.keyDown(document, { key: 'Escape' })
    expect(onClose).toHaveBeenCalledTimes(1)
  })

  it('offers a retry after a failed read', () => {
    const onRetry = vi.fn()
    render(<EventDetail selection={{ eventId: 'e1', phase: 'error', errorCode: 'not-found' }} t={t} onClose={() => {}} onRetry={onRetry} onEdit={() => {}} onDelete={() => {}} />)
    fireEvent.click(screen.getByRole('button', { name: 'Retry' }))
    expect(onRetry).toHaveBeenCalledTimes(1)
  })
})
describe('EventDetail actions', () => {
  it('edits the loaded detail', () => {
    const onEdit = vi.fn()
    render(
      <EventDetail
        selection={{ eventId: 'e1', phase: 'ready', detail }}
        t={t}
        onClose={() => {}}
        onRetry={() => {}}
        onEdit={onEdit}
        onDelete={() => {}}
      />,
    )
    fireEvent.click(screen.getByRole('button', { name: 'Edit' }))
    expect(onEdit).toHaveBeenCalledWith(detail)
  })

  it('confirms a series delete before calling back', () => {
    const onDelete = vi.fn()
    render(
      <EventDetail
        selection={{ eventId: 'e1', phase: 'ready', detail: { ...detail, recurringEventId: 'master_0' } }}
        t={t}
        onClose={() => {}}
        onRetry={() => {}}
        onEdit={() => {}}
        onDelete={onDelete}
      />,
    )
    fireEvent.click(screen.getByRole('button', { name: 'Delete' }))
    expect(onDelete).not.toHaveBeenCalled()
    expect(screen.getByRole('combobox')).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: 'Confirm delete' }))
    expect(onDelete).toHaveBeenCalledWith('all')
  })

  it('deletes a single event without asking for a scope', () => {
    const onDelete = vi.fn()
    render(
      <EventDetail
        selection={{ eventId: 'e1', phase: 'ready', detail }}
        t={t}
        onClose={() => {}}
        onRetry={() => {}}
        onEdit={() => {}}
        onDelete={onDelete}
      />,
    )
    fireEvent.click(screen.getByRole('button', { name: 'Delete' }))
    expect(screen.queryByRole('combobox')).toBeNull()
    fireEvent.click(screen.getByRole('button', { name: 'Confirm delete' }))
    expect(onDelete).toHaveBeenCalledWith(undefined)
  })

  it('sends the scope the user picked for a series', () => {
    const onDelete = vi.fn()
    render(
      <EventDetail
        selection={{ eventId: 'e1', phase: 'ready', detail: { ...detail, recurringEventId: 'master_0' } }}
        t={t}
        onClose={() => {}}
        onRetry={() => {}}
        onEdit={() => {}}
        onDelete={onDelete}
      />,
    )
    fireEvent.click(screen.getByRole('button', { name: 'Delete' }))
    fireEvent.change(screen.getByRole('combobox'), { target: { value: 'this-and-following' } })
    fireEvent.click(screen.getByRole('button', { name: 'Confirm delete' }))
    expect(onDelete).toHaveBeenCalledWith('this-and-following')
  })
})

describe('EventDetail content', () => {
  it('tags an all-day event and names its recurrence', () => {
    render(
      <EventDetail
        selection={{ eventId: 'e1', phase: 'ready', detail: { ...detail, allDay: true, start: '2026-11-25', end: '2026-11-26' } }}
        t={t}
        onClose={() => {}}
        onRetry={() => {}}
        onEdit={() => {}}
        onDelete={() => {}}
      />,
    )
    expect(screen.getByText('All day')).toBeTruthy()
    expect(screen.getByText('Repeats')).toBeTruthy()
    expect(screen.getByText('Weekly · 3 times')).toBeTruthy()
  })

  it('shows a dash for an untitled event and omits the empty fields', () => {
    const { appLink: _link, organizer: _organizer, selfRsvpStatus: _rsvp, recurrence: _rule, ...bare } = detail
    render(
      <EventDetail
        selection={{ eventId: 'e1', phase: 'ready', detail: { ...bare, summary: '', description: '' } }}
        t={t}
        onClose={() => {}}
        onRetry={() => {}}
        onEdit={() => {}}
        onDelete={() => {}}
      />,
    )
    expect(screen.getByRole('heading', { level: 3 }).textContent).toBe('—')
    expect(screen.queryByText('Organizer')).toBeNull()
    expect(screen.queryByText('Your response')).toBeNull()
    expect(screen.queryByText('Repeats')).toBeNull()
    // An empty description body renders no paragraph.
    expect(screen.getByRole('dialog').querySelectorAll('p.description')).toHaveLength(0)
  })

  it('renders the description when the event carries one', () => {
    render(
      <EventDetail
        selection={{ eventId: 'e1', phase: 'ready', detail: { ...detail, description: 'Bring the deck' } }}
        t={t}
        onClose={() => {}}
        onRetry={() => {}}
        onEdit={() => {}}
        onDelete={() => {}}
      />,
    )
    expect(screen.getByText('Bring the deck')).toBeTruthy()
  })

  it('copies the event details and confirms it', async () => {
    const writeText = vi.fn(async () => {})
    Object.defineProperty(navigator, 'clipboard', { configurable: true, value: { writeText } })
    const { appLink: _dropped, ...withoutLink } = detail
    render(
      <EventDetail
        selection={{ eventId: 'e1', phase: 'ready', detail: withoutLink }}
        t={t}
        onClose={() => {}}
        onRetry={() => {}}
        onEdit={() => {}}
        onDelete={() => {}}
      />,
    )
    fireEvent.click(screen.getByRole('button', { name: 'Copy event info' }))
    expect(writeText).toHaveBeenCalledWith(expect.stringContaining('Sync'))
    await vi.waitFor(() => { expect(screen.getByRole('button', { name: 'Copied' })).toBeTruthy() })
  })

  it('reports a failed delete and locks the action while one runs', () => {
    const { rerender } = render(
      <EventDetail
        selection={{ eventId: 'e1', phase: 'ready', detail }}
        t={t}
        onClose={() => {}}
        onRetry={() => {}}
        onEdit={() => {}}
        onDelete={() => {}}
        deleting={{ eventId: 'e1', pending: false, errorCode: 'conflict' }}
      />,
    )
    expect(screen.getByRole('alert').textContent).toBe('Could not delete the event; try again')
    rerender(
      <EventDetail
        selection={{ eventId: 'e1', phase: 'ready', detail }}
        t={t}
        onClose={() => {}}
        onRetry={() => {}}
        onEdit={() => {}}
        onDelete={() => {}}
        deleting={{ eventId: 'e1', pending: true }}
      />,
    )
    expect(screen.getByRole('button', { name: 'Delete' })).toHaveProperty('disabled', true)
  })

  it('closes when the backdrop outside the drawer is clicked', () => {
    const onClose = vi.fn()
    render(
      <EventDetail
        selection={{ eventId: 'e1', phase: 'ready', detail }}
        t={t}
        onClose={onClose}
        onRetry={() => {}}
        onEdit={() => {}}
        onDelete={() => {}}
      />,
    )
    const backdrop = screen.getByRole('dialog').parentElement as HTMLElement
    fireEvent.click(backdrop)
    expect(onClose).toHaveBeenCalledTimes(1)
    // A click inside the drawer does not close it.
    fireEvent.click(screen.getByRole('dialog'))
    expect(onClose).toHaveBeenCalledTimes(1)
  })
})
