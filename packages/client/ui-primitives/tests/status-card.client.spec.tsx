// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, expect, it, vi } from 'vitest'
import { StatusCard } from '../src/StatusCard.tsx'

afterEach(cleanup)

it('renders the glyph as decoration beside the title and description', () => {
  render(
    <StatusCard
      icon={<span>◆</span>}
      title="Feishu CLI is not installed"
      description="Install it, then reconnect this panel."
    />,
  )
  expect(screen.getByText('Feishu CLI is not installed')).toBeTruthy()
  expect(screen.getByText('Install it, then reconnect this panel.')).toBeTruthy()
  expect(screen.getByText('◆').closest('[aria-hidden="true"]')).not.toBeNull()
})

it('keeps the glyph box out of the accessibility tree and the card free of actions without them', () => {
  const { container } = render(<StatusCard title="Loading" />)
  expect(container.querySelector('[aria-hidden="true"]')).toBeNull()
  expect(screen.queryByRole('button')).toBeNull()
  expect(screen.queryByText('Loading')?.parentElement?.children).toHaveLength(1)
})

it('runs each action from its own button and renders only the actions supplied', () => {
  const primary = vi.fn()
  const secondary = vi.fn()
  const view = render(
    <StatusCard
      title="Not connected"
      primaryAction={{ label: 'Connect Feishu', onClick: primary }}
      secondaryAction={{ label: 'Open setup guide', onClick: secondary }}
    />,
  )
  fireEvent.click(screen.getByRole('button', { name: 'Connect Feishu' }))
  expect(primary).toHaveBeenCalledOnce()
  expect(secondary).not.toHaveBeenCalled()
  fireEvent.click(screen.getByRole('button', { name: 'Open setup guide' }))
  expect(secondary).toHaveBeenCalledOnce()
  expect(screen.getAllByRole('button')).toHaveLength(2)

  view.rerender(<StatusCard title="Not connected" primaryAction={{ label: 'Connect Feishu', onClick: primary }} />)
  expect(screen.getAllByRole('button').map(button => button.textContent)).toEqual(['Connect Feishu'])
  view.rerender(<StatusCard title="Not connected" secondaryAction={{ label: 'Open setup guide', onClick: secondary }} />)
  expect(screen.getAllByRole('button').map(button => button.textContent)).toEqual(['Open setup guide'])
})

it('exposes the chosen tone and defaults to neutral', () => {
  const { container, rerender } = render(<StatusCard title="Request failed" tone="danger" />)
  expect(container.firstElementChild?.getAttribute('data-tone')).toBe('danger')
  rerender(<StatusCard title="Request failed" />)
  expect(container.firstElementChild?.getAttribute('data-tone')).toBe('neutral')
})

it('puts the owner class on the card element', () => {
  const { container } = render(<StatusCard title="Loading" className="owner-card" />)
  expect(container.firstElementChild?.className).toContain('owner-card')
})
