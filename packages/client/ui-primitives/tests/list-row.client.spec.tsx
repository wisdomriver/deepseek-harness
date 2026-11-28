// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, expect, it, vi } from 'vitest'
import { ListRow } from '../src/ListRow.tsx'

afterEach(cleanup)

it('renders the leading, title, meta, and trailing content it receives', () => {
  render(
    <ListRow
      leading={<span>📄</span>}
      title="Quarterly plan"
      meta="Owned by Lin"
      trailing="Yesterday"
      onActivate={() => {}}
    />,
  )
  const row = screen.getByRole('button', { name: /Quarterly plan/ })
  expect(row.textContent).toBe('📄Quarterly planOwned by LinYesterday')
  expect(row.tabIndex).toBe(0)
})

it('leaves out the optional slots a caller omits', () => {
  const { container } = render(<ListRow title="Only a title" onActivate={() => {}} />)
  const row = container.firstElementChild as HTMLElement
  expect(row.children).toHaveLength(1)
  expect(row.textContent).toBe('Only a title')
})

it('activates on click, Enter, and Space but not on other keys', () => {
  const onActivate = vi.fn()
  render(<ListRow title="Quarterly plan" onActivate={onActivate} />)
  const row = screen.getByRole('button', { name: 'Quarterly plan' })
  fireEvent.click(row)
  expect(onActivate).toHaveBeenCalledTimes(1)
  expect(fireEvent.keyDown(row, { key: 'Enter' })).toBe(false)
  expect(fireEvent.keyDown(row, { key: ' ' })).toBe(false)
  expect(onActivate).toHaveBeenCalledTimes(3)
  fireEvent.keyDown(row, { key: 'Tab' })
  fireEvent.keyDown(row, { key: 'a' })
  expect(onActivate).toHaveBeenCalledTimes(3)
})

it('marks the current row with aria-current and clears it when deselected', () => {
  const view = render(<ListRow title="Quarterly plan" selected onActivate={() => {}} />)
  const row = screen.getByRole('button', { name: 'Quarterly plan' })
  expect(row.getAttribute('aria-current')).toBe('true')
  expect(row.getAttribute('aria-disabled')).toBeNull()
  view.rerender(<ListRow title="Quarterly plan" onActivate={() => {}} />)
  expect(row.getAttribute('aria-current')).toBeNull()
})

it('keeps a disabled row focusable and readable while refusing activation', () => {
  const onActivate = vi.fn()
  render(<ListRow title="Quarterly plan" disabled onActivate={onActivate} />)
  const row = screen.getByRole('button', { name: 'Quarterly plan' })
  expect(row.getAttribute('aria-disabled')).toBe('true')
  expect(row.tabIndex).toBe(0)
  fireEvent.click(row)
  fireEvent.keyDown(row, { key: 'Enter' })
  fireEvent.keyDown(row, { key: ' ' })
  expect(onActivate).not.toHaveBeenCalled()
})

it('puts the owner class on the row element', () => {
  const { container } = render(<ListRow title="Quarterly plan" className="owner-row" onActivate={() => {}} />)
  expect(container.firstElementChild?.className).toContain('owner-row')
})
