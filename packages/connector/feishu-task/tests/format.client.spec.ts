// Locale-aware formatting: stable failure codes, malformed instants shown as sent, short ids
// kept whole, and the end of the local day a date-only due picker means.

import { describe, expect, it } from 'vitest'
import { abbreviateId, dueInstant, errorText, formatDue, formatTimestamp } from '../src/client/format.ts'
import { en, type TaskLocaleKey } from '../src/client/locales.ts'

/** Localized copy resolved from the English dictionary. */
const t = (key: TaskLocaleKey, params?: Record<string, unknown>): string =>
  Object.entries(params ?? {}).reduce((text, [name, value]) => text.replaceAll(`{${name}}`, String(value)), en[key])

describe('errorText', () => {
  it('names a failure code the panel knows', () => {
    expect(errorText('not-found', t)).toBe(en.notFound)
    expect(errorText('unknown-outcome', t)).toBe(en.unknownOutcome)
  })

  it('falls back to the generic copy for an absent or unrecognized code', () => {
    expect(errorText(undefined, t)).toBe(en.error)
    expect(errorText('a-code-from-a-newer-host', t)).toBe(en.error)
  })
})

describe('formatDue', () => {
  const instant = new Date(2026, 10, 10, 9, 5, 0).toISOString()

  it('shows a date alone for an all-day due and adds the clock otherwise', () => {
    const date = new Date(instant)
    expect(formatDue(instant, true)).toBe(new Intl.DateTimeFormat(undefined, { month: 'short', day: 'numeric' }).format(date))
    expect(formatDue(instant, false)).toBe(
      new Intl.DateTimeFormat(undefined, { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' }).format(date),
    )
  })

  it('shows a malformed due as sent rather than a fabricated instant', () => {
    expect(formatDue('not a due', true)).toBe('not a due')
  })
})

describe('formatTimestamp', () => {
  it('shows a date and clock time', () => {
    const instant = new Date(2026, 10, 9, 10, 30, 0).toISOString()
    expect(formatTimestamp(instant)).toBe(
      new Intl.DateTimeFormat(undefined, { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' })
        .format(new Date(instant)),
    )
  })

  it('shows a malformed instant as sent', () => {
    expect(formatTimestamp('not an instant')).toBe('not an instant')
  })
})

describe('abbreviateId', () => {
  it('keeps an id inside the budget whole and shortens a longer one to its prefix', () => {
    expect(abbreviateId('ou_a')).toBe('ou_a')
    expect(abbreviateId('ou_1234567')).toBe('ou_1234567')
    expect(abbreviateId('ou_12345678')).toBe('ou_1234…')
  })
})

describe('dueInstant', () => {
  it('reads a date-only due as the last minute of that local day', () => {
    const instant = dueInstant('2026-12-02')
    const parsed = new Date(instant)
    expect(parsed.getFullYear()).toBe(2026)
    expect(parsed.getMonth()).toBe(11)
    expect(parsed.getDate()).toBe(2)
    expect(parsed.getHours()).toBe(23)
    expect(parsed.getMinutes()).toBe(59)
  })

  it('answers an empty string for a day the picker never produces', () => {
    expect(dueInstant('not-a-day')).toBe('')
  })
})
