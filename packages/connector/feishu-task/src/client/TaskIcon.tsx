/** Sidebar glyph for the tasks entry. */

import type { ReactNode } from 'react'
import type { PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots'

/**
 * Draw the checklist glyph at the sidebar's size.
 * @param props - the sidebar entry's owner props: the requested edge and whether the panel is selected.
 * @returns the glyph.
 */
export function TaskIcon({ size, active }: PropsRuntime<'sidebar.panellist'>): ReactNode {
  return (
    <svg width={size} height={size} viewBox="0 0 20 20" fill="none" aria-hidden="true">
      <rect
        x="2.5"
        y="3.5"
        width="15"
        height="13"
        rx="2.5"
        stroke="currentColor"
        strokeWidth={active ? 1.8 : 1.4}
      />
      <path d="M6 10l2.4 2.4L14 6.8" stroke="currentColor" strokeWidth={active ? 1.8 : 1.4} strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  )
}
