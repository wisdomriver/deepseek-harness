// @vitest-environment jsdom
// Dialog focus handling: Escape, Tab trapping at both ends, focus restoration, and a dialog
// that holds no focusable stop.

import { useRef, type ReactNode } from 'react'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { TaskDetail } from '../src/client/TaskDetail.tsx'
import { focusables, useDialogFocus } from '../src/client/dialog.ts'
import { en } from '../src/client/locales.ts'
import type { TaskDetail as TaskDetailData } from '../src/types.ts'

afterEach(cleanup)

const DETAIL: TaskDetailData = {
  taskId: 't1',
  summary: 'Ship it',
  status: 'todo',
  assignees: [],
  followers: [],
  tasklists: [],
}

/** Localized copy resolved from the English dictionary. */
const t = (key: keyof typeof en): string => en[key]

/**
 * Render the detail drawer, whose buttons are the focus stops.
 * @returns the rendered drawer and its close callback.
 */
function openDrawer() {
  const onClose = vi.fn()
  const result = render(
    <TaskDetail
      selection={{ taskId: 't1', phase: 'ready', detail: DETAIL }}
      mark={undefined}
      t={t}
      onClose={onClose}
      onRetry={vi.fn()}
      onComplete={vi.fn()}
      onReopen={vi.fn()}
    />,
  )
  const drawer = screen.getByRole('dialog')
  return { ...result, onClose, drawer, stops: focusables(drawer) }
}

/** A dialog that holds no focusable stop, the shape a fully disabled form has. */
function EmptyDialog({ onClose }: { readonly onClose: () => void }): ReactNode {
  const panel = useRef<HTMLDivElement>(null)
  useDialogFocus(panel, onClose)
  return <div ref={panel} role="dialog" aria-label="empty" />
}

describe('focusables', () => {
  it('collects the enabled stops in reading order and skips a disabled one', () => {
    const container = document.createElement('div')
    container.innerHTML = '<button>first</button><button disabled>off</button><a href="/x">link</a><input><textarea></textarea>'
    expect(focusables(container).map(element => element.tagName)).toEqual(['BUTTON', 'A', 'INPUT', 'TEXTAREA'])
  })

  it('collects nothing before the dialog mounts', () => {
    expect(focusables(null)).toEqual([])
  })
})

describe('useDialogFocus', () => {
  it('wraps Tab from the last stop to the first and Shift+Tab from the first to the last', () => {
    const { stops } = openDrawer()
    const first = stops[0]!
    const last = stops[stops.length - 1]!
    expect(document.activeElement).toBe(first)

    last.focus()
    fireEvent.keyDown(document, { key: 'Tab' })
    expect(document.activeElement).toBe(first)

    fireEvent.keyDown(document, { key: 'Tab', shiftKey: true })
    expect(document.activeElement).toBe(last)
  })

  it('leaves a Tab between two inner stops to the browser', () => {
    const { stops } = openDrawer()
    const middle = stops[1]!
    middle.focus()
    const handled = fireEvent.keyDown(document, { key: 'Tab' })
    expect(handled).toBe(true)
    expect(document.activeElement).toBe(middle)
  })

  it('ignores a key that is neither Escape nor Tab', () => {
    const { stops, onClose } = openDrawer()
    const first = stops[0]!
    expect(fireEvent.keyDown(document, { key: 'Enter' })).toBe(true)
    expect(onClose).not.toHaveBeenCalled()
    expect(document.activeElement).toBe(first)
  })

  it('closes on Escape', () => {
    const { onClose } = openDrawer()
    fireEvent.keyDown(document, { key: 'Escape' })
    expect(onClose).toHaveBeenCalledTimes(1)
  })

  it('keeps a dialog without a focusable stop open on Tab', () => {
    const onClose = vi.fn()
    render(<EmptyDialog onClose={onClose} />)
    expect(focusables(screen.getByRole('dialog'))).toEqual([])
    expect(fireEvent.keyDown(document, { key: 'Tab' })).toBe(true)
    expect(onClose).not.toHaveBeenCalled()
  })

  it('restores focus to the element that opened the dialog', () => {
    const trigger = document.createElement('button')
    document.body.append(trigger)
    trigger.focus()
    const { unmount } = openDrawer()
    unmount()
    expect(document.activeElement).toBe(trigger)
    trigger.remove()
  })

  it('leaves focus alone when the opener was not an HTML element', () => {
    const opener = document.createElementNS('http://www.w3.org/2000/svg', 'svg')
    opener.setAttribute('tabindex', '0')
    document.body.append(opener)
    opener.focus()
    expect(document.activeElement).toBe(opener)
    const { unmount } = openDrawer()
    unmount()
    expect(document.activeElement).not.toBe(opener)
    opener.remove()
  })
})
