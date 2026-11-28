// @vitest-environment jsdom
// Sidebar glyph: the checklist draws at the requested size and thickens while selected.

import { cleanup, render } from '@testing-library/react'
import { afterEach, describe, expect, it } from 'vitest'
import { TaskIcon } from '../src/client/TaskIcon.tsx'
import { standardSeats } from './panel-seats.client.ts'

afterEach(cleanup)

/**
 * Render the glyph in one sidebar state.
 * @param active - whether the tasks panel is the selected one.
 * @returns the rendered SVG.
 */
function draw(active: boolean): SVGElement {
  const { container } = render(<TaskIcon {...standardSeats} size={20} active={active} />)
  return container.querySelector('svg')!
}

describe('TaskIcon', () => {
  it('draws the checklist at the sidebar size, hidden from assistive technology', () => {
    const svg = draw(false)
    expect(svg.getAttribute('width')).toBe('20')
    expect(svg.getAttribute('height')).toBe('20')
    expect(svg.getAttribute('aria-hidden')).toBe('true')
    expect(svg.querySelectorAll('rect')).toHaveLength(1)
  })

  it('thickens the outline and the check while the panel is selected', () => {
    const idle = draw(false)
    const active = draw(true)
    expect(idle.querySelector('rect')?.getAttribute('stroke-width')).toBe('1.4')
    expect(active.querySelector('rect')?.getAttribute('stroke-width')).toBe('1.8')
    expect(idle.querySelector('path')?.getAttribute('stroke-width')).toBe('1.4')
    expect(active.querySelector('path')?.getAttribute('stroke-width')).toBe('1.8')
  })
})
