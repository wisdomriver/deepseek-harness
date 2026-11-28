// @vitest-environment jsdom
// Dialog focus handling: initial focus, Escape, Tab trapping, and focus restoration.

import { useRef, type ReactNode } from 'react'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { focusables, useDialogFocus } from '../src/client/dialog.ts'

afterEach(cleanup)

/**
 * A dialog-shaped probe the focus hook can own.
 * @param props - close callback and how many enabled stops to render.
 * @returns the dialog.
 */
function Probe({ onClose, stops = 2 }: { readonly onClose: () => void; readonly stops?: number }): ReactNode {
  const panel = useRef<HTMLDivElement>(null)
  useDialogFocus(panel, onClose)
  return (
    <div ref={panel}>
      {Array.from({ length: stops }, (_, index) => (
        <button key={index} type="button">{`stop ${index}`}</button>
      ))}
    </div>
  )
}

describe('focusables', () => {
  it('returns nothing for a dialog that has not mounted', () => {
    expect(focusables(null)).toEqual([])
  })

  it('collects the enabled stops in reading order', () => {
    const { container } = render(
      <form>
        <button type="button">first</button>
        <button type="button" disabled>skipped</button>
        <a href="https://example.test">link</a>
        <input aria-label="title" />
        <select aria-label="kind"><option>one</option></select>
        <textarea aria-label="body" />
      </form>,
    )
    expect(focusables(container.querySelector('form')).map(element => element.tagName))
      .toEqual(['BUTTON', 'A', 'INPUT', 'SELECT', 'TEXTAREA'])
  })
})

describe('useDialogFocus', () => {
  it('focuses the first stop when the dialog mounts', () => {
    render(<Probe onClose={() => {}} />)
    expect(document.activeElement?.textContent).toBe('stop 0')
  })

  it('closes on Escape and swallows the key', () => {
    const onClose = vi.fn()
    render(<Probe onClose={onClose} />)
    const event = new KeyboardEvent('keydown', { key: 'Escape', cancelable: true, bubbles: true })
    document.dispatchEvent(event)
    expect(onClose).toHaveBeenCalledOnce()
    expect(event.defaultPrevented).toBe(true)
  })

  it('wraps Tab from the last stop to the first and Shift+Tab back from the first', () => {
    render(<Probe onClose={() => {}} />)
    const first = screen.getByText('stop 0')
    const last = screen.getByText('stop 1')
    last.focus()
    fireEvent.keyDown(document, { key: 'Tab' })
    expect(document.activeElement).toBe(first)
    fireEvent.keyDown(document, { key: 'Tab', shiftKey: true })
    expect(document.activeElement).toBe(last)
  })

  it('leaves Tab inside the dialog alone', () => {
    render(<Probe onClose={() => {}} stops={3} />)
    const middle = screen.getByText('stop 1')
    middle.focus()
    fireEvent.keyDown(document, { key: 'Tab' })
    expect(document.activeElement).toBe(middle)
    fireEvent.keyDown(document, { key: 'a' })
    expect(document.activeElement).toBe(middle)
  })

  it('ignores Tab when the dialog offers no stop', () => {
    render(<Probe onClose={() => {}} stops={0} />)
    fireEvent.keyDown(document, { key: 'Tab' })
    fireEvent.keyDown(document, { key: 'Tab', shiftKey: true })
    expect(document.activeElement?.tagName).toBe('BODY')
  })

  it('restores the previously focused element when the dialog unmounts', () => {
    const trigger = render(<button type="button">trigger</button>)
    trigger.getByText('trigger').focus()
    const dialog = render(<Probe onClose={() => {}} />)
    expect(document.activeElement?.textContent).toBe('stop 0')
    dialog.unmount()
    expect(document.activeElement?.textContent).toBe('trigger')
    trigger.unmount()
  })
})
