/** Focus handling the drawer needs: Escape, Tab trapping, and focus restoration. */

import { useEffect, type RefObject } from 'react'

/**
 * Keep focus inside one dialog while it is mounted.
 * @param panel - the dialog element.
 * @param onClose - called for Escape.
 */
export function useDialogFocus(panel: RefObject<HTMLElement | null>, onClose: () => void): void {
  useEffect(() => {
    const previous = document.activeElement
    const node = panel.current
    focusables(node)[0]?.focus()
    const onKeyDown = (event: KeyboardEvent): void => {
      if (event.key === 'Escape') {
        event.preventDefault()
        onClose()
        return
      }
      if (event.key !== 'Tab') return
      const stops = focusables(node)
      const first = stops[0]
      const last = stops[stops.length - 1]
      if (first === undefined || last === undefined) return
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault()
        last.focus()
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault()
        first.focus()
      }
    }
    document.addEventListener('keydown', onKeyDown)
    return () => {
      document.removeEventListener('keydown', onKeyDown)
      if (previous instanceof HTMLElement) previous.focus()
    }
  }, [panel, onClose])
}

/**
 * Collect an element's focusable stops.
 * @param node - the container, or null while mounting.
 * @returns focusable elements in reading order.
 */
export function focusables(node: HTMLElement | null): HTMLElement[] {
  if (node === null) return []
  return [...node.querySelectorAll<HTMLElement>('button, [href], input, select, textarea')]
    .filter(element => !element.hasAttribute('disabled'))
}
