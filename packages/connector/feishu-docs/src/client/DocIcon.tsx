/** Type glyphs for the document list and the drawer. */

import type { ReactNode } from 'react'
import type { PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots'
import css from './DocIcon.module.css'

/** Props the list hands the glyph. */
export interface DocTypeGlyphProps {
  /** Normalized document type. */
  readonly type: string
  /** Square size in pixels. */
  readonly size?: number
}

/**
 * Draw the glyph for one document type.
 * @param props - type and size.
 * @returns the glyph.
 */
export function DocTypeGlyph({ type, size = 16 }: DocTypeGlyphProps): ReactNode {
  const common = { width: size, height: size, viewBox: '0 0 20 20', fill: 'none', 'aria-hidden': true } as const
  switch (type) {
    case 'folder':
      return (
        <svg {...common} className={css.folder}>
          <path d="M2.5 6.5A1.5 1.5 0 0 1 4 5h3.4l1.4 1.8H16a1.5 1.5 0 0 1 1.5 1.5v6.2A1.5 1.5 0 0 1 16 16H4a1.5 1.5 0 0 1-1.5-1.5z" stroke="currentColor" strokeWidth="1.4" strokeLinejoin="round" />
        </svg>
      )
    case 'sheet':
      return (
        <svg {...common} className={css.sheet}>
          <rect x="3" y="3.5" width="14" height="13" rx="1.8" stroke="currentColor" strokeWidth="1.4" />
          <path d="M3 8h14M8 8v8.5M13 8v8.5" stroke="currentColor" strokeWidth="1.2" />
        </svg>
      )
    case 'base':
    case 'bitable':
      return (
        <svg {...common} className={css.base}>
          <rect x="3" y="3.5" width="14" height="13" rx="1.8" stroke="currentColor" strokeWidth="1.4" />
          <path d="M3 8h14M8 8v8.5" stroke="currentColor" strokeWidth="1.2" />
          <circle cx="13" cy="12" r="1.3" fill="currentColor" />
        </svg>
      )
    case 'slides':
      return (
        <svg {...common} className={css.slides}>
          <rect x="3" y="4" width="14" height="10" rx="1.6" stroke="currentColor" strokeWidth="1.4" />
          <path d="M10 14v2.5M7.5 17h5" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" />
        </svg>
      )
    case 'mindnote':
      return (
        <svg {...common} className={css.mindnote}>
          <circle cx="6" cy="10" r="2" stroke="currentColor" strokeWidth="1.4" />
          <circle cx="14" cy="5.5" r="2" stroke="currentColor" strokeWidth="1.4" />
          <circle cx="14" cy="14.5" r="2" stroke="currentColor" strokeWidth="1.4" />
          <path d="M8 9.2 12 6.4M8 10.8l4 2.8" stroke="currentColor" strokeWidth="1.2" />
        </svg>
      )
    case 'wiki':
      return (
        <svg {...common} className={css.wiki}>
          <path d="M4 3.5h8.5L16 7v9.5H4z" stroke="currentColor" strokeWidth="1.4" strokeLinejoin="round" />
          <path d="M12 3.5V7h4M7 10h6M7 13h4" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" />
        </svg>
      )
    default:
      return (
        <svg {...common} className={css.document}>
          <path d="M4 3.5h8.5L16 7v9.5H4z" stroke="currentColor" strokeWidth="1.4" strokeLinejoin="round" />
          <path d="M12 3.5V7h4M7 10h6M7 13h6" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" />
        </svg>
      )
  }
}

/**
 * Draw the sidebar glyph for the docs entry.
 * @param props - the sidebar entry's owner props.
 * @returns the glyph.
 */
export function DocIcon({ size }: PropsRuntime<'sidebar.panellist'>): ReactNode {
  return (
    <svg width={size} height={size} viewBox="0 0 20 20" fill="none" aria-hidden="true">
      <path d="M4 3.5h7.5L15.5 7v9.5H4z" stroke="currentColor" strokeWidth="1.4" strokeLinejoin="round" />
      <path d="M11 3.5V7.5h4.5M6.5 10.5h6M6.5 13h4" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" />
    </svg>
  )
}
