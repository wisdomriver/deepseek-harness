// @vitest-environment jsdom
// Dialog focus handling: initial focus, Escape, Tab trapping at both ends, focus restoration, and teardown.

import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { useRef, type ReactNode } from 'react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { focusables, useDialogFocus } from '../src/client/dialog.ts'

afterEach(cleanup)

/** A minimal dialog that uses the shared focus handling. */
function Dialog({ onClose, children }: { readonly onClose: () => void; readonly children?: ReactNode }): ReactNode {
  const panel = useRef<HTMLDivElement>(null)
  useDialogFocus(panel, onClose)
  return <div ref={panel} role="dialog" aria-label="Fixture dialog">{children}</div>
}

describe('useDialogFocus', () => {
  it('focuses the first stop when the dialog mounts', () => {
    render(
      <Dialog onClose={() => {}}>
        <button type="button">First</button>
        <button type="button">Second</button>
      </Dialog>,
    )
    expect(document.activeElement).toBe(screen.getByRole('button', { name: 'First' }))
  })

  it('closes on Escape', () => {
    const onClose = vi.fn()
    render(<Dialog onClose={onClose}><button type="button">Only</button></Dialog>)
    fireEvent.keyDown(document, { key: 'Escape' })
    expect(onClose).toHaveBeenCalledTimes(1)
  })

  it('wraps Tab forward from the last stop and backward from the first', () => {
    render(
      <Dialog onClose={() => {}}>
        <button type="button">First</button>
        <button type="button">Last</button>
      </Dialog>,
    )
    const first = screen.getByRole('button', { name: 'First' })
    const last = screen.getByRole('button', { name: 'Last' })
    last.focus()
    fireEvent.keyDown(document, { key: 'Tab' })
    expect(document.activeElement).toBe(first)
    fireEvent.keyDown(document, { key: 'Tab', shiftKey: true })
    expect(document.activeElement).toBe(last)
  })

  it('leaves an interior Tab alone and ignores other keys', () => {
    render(
      <Dialog onClose={() => {}}>
        <button type="button">First</button>
        <button type="button">Middle</button>
        <button type="button">Last</button>
      </Dialog>,
    )
    const middle = screen.getByRole('button', { name: 'Middle' })
    middle.focus()
    fireEvent.keyDown(document, { key: 'Tab' })
    expect(document.activeElement).toBe(middle)
    fireEvent.keyDown(document, { key: 'ArrowDown' })
    expect(document.activeElement).toBe(middle)
  })

  it('restores the focus it took when the dialog unmounts', () => {
    const outside = document.createElement('button')
    outside.textContent = 'Outside'
    document.body.append(outside)
    outside.focus()
    const { unmount } = render(<Dialog onClose={() => {}}><button type="button">Inside</button></Dialog>)
    expect(document.activeElement).toBe(screen.getByRole('button', { name: 'Inside' }))
    unmount()
    expect(document.activeElement).toBe(outside)
    outside.remove()
  })

  it('leaves focus alone when the document had none before the dialog opened', () => {
    const descriptor = Object.getOwnPropertyDescriptor(Document.prototype, 'activeElement')
    Object.defineProperty(document, 'activeElement', { configurable: true, get: () => null })
    try {
      const { unmount } = render(<Dialog onClose={() => {}}><button type="button">Inside</button></Dialog>)
      unmount()
      expect(document.activeElement).toBeNull()
    } finally {
      if (descriptor === undefined) Reflect.deleteProperty(document, 'activeElement')
      else Object.defineProperty(document, 'activeElement', descriptor)
    }
  })

  it('tolerates a dialog with no focusable stop', () => {
    const onClose = vi.fn()
    render(<Dialog onClose={onClose}><p>Nothing to focus</p></Dialog>)
    fireEvent.keyDown(document, { key: 'Tab' })
    fireEvent.keyDown(document, { key: 'Escape' })
    expect(onClose).toHaveBeenCalledTimes(1)
  })

  it('listens for keys only while mounted', () => {
    const added = vi.spyOn(document, 'addEventListener')
    const removed = vi.spyOn(document, 'removeEventListener')
    const { unmount } = render(<Dialog onClose={() => {}}><button type="button">Only</button></Dialog>)
    expect(added).toHaveBeenCalledWith('keydown', expect.any(Function))
    unmount()
    expect(removed).toHaveBeenCalledWith('keydown', expect.any(Function))
    added.mockRestore()
    removed.mockRestore()
  })
})

describe('focusables', () => {
  it('collects enabled controls in reading order and skips disabled ones', () => {
    const host = document.createElement('div')
    host.innerHTML = '<button>one</button><button disabled>two</button><a href="#">three</a>'
    expect(focusables(host).map(node => node.textContent)).toEqual(['one', 'three'])
    expect(focusables(null)).toEqual([])
  })
})
