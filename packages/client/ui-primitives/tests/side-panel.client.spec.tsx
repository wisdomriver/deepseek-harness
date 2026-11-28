// @vitest-environment jsdom
import { useState } from 'react'
import type { ReactNode } from 'react'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, expect, it } from 'vitest'
import { SidePanel } from '../src/SidePanel.tsx'

afterEach(cleanup)

function Drawer({ startOpen = false, width, footer, closeLabel, className, children }: {
  startOpen?: boolean
  width?: 'md' | 'lg'
  footer?: ReactNode
  closeLabel?: string
  className?: string
  children: ReactNode
}) {
  const [open, setOpen] = useState(startOpen)
  return <>
    <button onClick={() => { setOpen(true) }}>Open details</button>
    <SidePanel
      open={open}
      title="Quarterly plan"
      onClose={() => { setOpen(false) }}
      width={width ?? 'md'}
      footer={footer}
      className={className}
      {...(closeLabel === undefined ? {} : { closeLabel })}
    >
      {children}
    </SidePanel>
  </>
}

const controls = <>
  <button>Rename</button>
  <button>Delete</button>
</>

it('renders nothing while closed and a named modal dialog once opened', () => {
  render(<Drawer>{controls}</Drawer>)
  expect(screen.queryByRole('dialog')).toBeNull()
  fireEvent.click(screen.getByRole('button', { name: 'Open details' }))
  const dialog = screen.getByRole('dialog', { name: 'Quarterly plan' })
  expect(dialog.getAttribute('aria-modal')).toBe('true')
})

it('closes on Escape and returns focus to the opener', () => {
  render(<Drawer>{controls}</Drawer>)
  const opener = screen.getByRole('button', { name: 'Open details' })
  opener.focus()
  fireEvent.click(opener)
  expect(screen.getByRole('dialog', { name: 'Quarterly plan' })).toBeTruthy()
  fireEvent.keyDown(document.activeElement ?? document, { key: 'Escape', code: 'Escape' })
  expect(screen.queryByRole('dialog')).toBeNull()
  expect(document.activeElement).toBe(opener)
})

it('closes on a mask click and returns focus to the opener', () => {
  render(<Drawer>{controls}</Drawer>)
  const opener = screen.getByRole('button', { name: 'Open details' })
  opener.focus()
  fireEvent.click(opener)
  const dialog = screen.getByRole('dialog', { name: 'Quarterly plan' })
  const mask = dialog.previousElementSibling as HTMLElement
  expect(mask.getAttribute('aria-hidden')).toBe('true')
  fireEvent.click(mask)
  expect(screen.queryByRole('dialog')).toBeNull()
  expect(document.activeElement).toBe(opener)
})

it('focuses the panel marker ahead of the first focusable control', () => {
  render(
    <Drawer startOpen>
      <button>Rename</button>
      <input data-panel-autofocus="" aria-label="Document title" />
    </Drawer>,
  )
  expect(document.activeElement).toBe(screen.getByRole('textbox', { name: 'Document title' }))
})

it('falls back to the first focusable control without a marker', () => {
  render(<Drawer startOpen>{controls}</Drawer>)
  expect(document.activeElement).toBe(screen.getByRole('button', { name: 'Rename' }))
})

it('cycles Tab and Shift+Tab at the panel edges', () => {
  render(<Drawer startOpen>{controls}</Drawer>)
  const rename = screen.getByRole('button', { name: 'Rename' })
  const remove = screen.getByRole('button', { name: 'Delete' })
  expect(document.activeElement).toBe(rename)
  // Interior traversal stays with the browser; only the edges wrap.
  expect(fireEvent.keyDown(rename, { key: 'Tab' })).toBe(true)
  remove.focus()
  expect(fireEvent.keyDown(remove, { key: 'Tab' })).toBe(false)
  expect(document.activeElement).toBe(rename)
  expect(fireEvent.keyDown(rename, { key: 'Tab', shiftKey: true })).toBe(false)
  expect(document.activeElement).toBe(remove)
})

it('renders the optional footer and the larger width', () => {
  render(<Drawer startOpen width="lg" footer={<button>Done</button>}>{controls}</Drawer>)
  expect(screen.getByRole('dialog', { name: 'Quarterly plan' })).toBeTruthy()
  expect(screen.getByRole('button', { name: 'Done' })).toBeTruthy()
})

it('renders a close button only when closeLabel names it, and closes through it', () => {
  const view = render(<Drawer startOpen>{controls}</Drawer>)
  expect(screen.queryByRole('button', { name: 'Close details' })).toBeNull()
  view.rerender(<Drawer startOpen closeLabel="Close details">{controls}</Drawer>)
  const close = screen.getByRole('button', { name: 'Close details' })
  fireEvent.click(close)
  expect(screen.queryByRole('dialog')).toBeNull()
})

it('puts the owner class on the drawer surface', () => {
  render(<Drawer startOpen className="owner-drawer">{controls}</Drawer>)
  const dialog = screen.getByRole('dialog', { name: 'Quarterly plan' })
  expect(dialog.className).toContain('owner-drawer')
})

it('releases its document listeners after closing', () => {
  const view = render(<Drawer startOpen>{controls}</Drawer>)
  fireEvent.keyDown(document.activeElement ?? document, { key: 'Escape', code: 'Escape' })
  expect(screen.queryByRole('dialog')).toBeNull()
  view.unmount()
  const event = new KeyboardEvent('keydown', { key: 'Escape', cancelable: true })
  document.dispatchEvent(event)
  expect(event.defaultPrevented).toBe(false)
})
