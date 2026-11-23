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
    render(<EventDetail selection={{ eventId: 'e1', phase: 'ready', detail }} t={t} onClose={() => {}} onRetry={() => {}} />)
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
      />,
    )
    expect(screen.getByRole('button', { name: 'Copy event info' })).toBeTruthy()
  })

  it('closes on Escape', () => {
    const onClose = vi.fn()
    render(<EventDetail selection={{ eventId: 'e1', phase: 'loading' }} t={t} onClose={onClose} onRetry={() => {}} />)
    fireEvent.keyDown(document, { key: 'Escape' })
    expect(onClose).toHaveBeenCalledTimes(1)
  })

  it('offers a retry after a failed read', () => {
    const onRetry = vi.fn()
    render(<EventDetail selection={{ eventId: 'e1', phase: 'error', errorCode: 'not-found' }} t={t} onClose={() => {}} onRetry={onRetry} />)
    fireEvent.click(screen.getByRole('button', { name: 'Retry' }))
    expect(onRetry).toHaveBeenCalledTimes(1)
  })
})
