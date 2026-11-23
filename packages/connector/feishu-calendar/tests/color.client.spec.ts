// @vitest-environment jsdom
// Feishu color mapping: signed ARGB integers onto the theme's eight accents.

import { describe, expect, it } from 'vitest'
import { calendarAccent } from '../src/client/color.ts'

/** Build the signed ARGB integer Feishu reports for one opaque color. */
function argb(red: number, green: number, blue: number): number {
  return (0xFF000000 | (red << 16) | (green << 8) | blue) | 0
}

describe('calendarAccent', () => {
  it('keeps the default brand accent for absent or default colors', () => {
    expect(calendarAccent(undefined)).toBe(0)
    expect(calendarAccent(-1)).toBe(0)
  })

  it('maps the hues onto the accent order', () => {
    expect(calendarAccent(argb(63, 128, 255))).toBe(1)
    expect(calendarAccent(argb(0, 214, 185))).toBe(2)
    expect(calendarAccent(argb(52, 199, 36))).toBe(3)
    expect(calendarAccent(argb(255, 198, 10))).toBe(4)
    expect(calendarAccent(argb(245, 74, 69))).toBe(5)
    expect(calendarAccent(argb(122, 85, 255))).toBe(6)
    expect(calendarAccent(argb(255, 119, 185))).toBe(7)
  })

  it('treats low-saturation values as the neutral accent', () => {
    expect(calendarAccent(argb(143, 149, 158))).toBe(8)
    expect(calendarAccent(argb(0, 0, 0))).toBe(8)
  })

  it('accepts the unsigned spelling of the same integer', () => {
    expect(calendarAccent(argb(63, 128, 255) >>> 0)).toBe(1)
  })
})
