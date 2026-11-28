// SidePanel: right-edge drawer over a page mask. Focus lifetime, Escape, and
// Tab cycling come from the shared modal layer, so a panel opened over a
// dialog or a menu obeys the same foreground ordering as Modal.

import { useRef, useId } from 'react'
import type { ReactNode } from 'react'
import { createPortal } from 'react-dom'
import clsx from 'clsx'
import { Button } from './Button.tsx'
import { IconCloseOutlineRegular } from './icons/index.tsx'
import { useModalLayer } from './useModalLayer.ts'
import css from './SidePanel.module.css'

/** Props for {@link SidePanel}. */
export interface SidePanelProps {
  /** Whether the drawer is showing; a closed panel renders nothing. */
  open: boolean
  /** Localized heading, which also names the dialog. */
  title: ReactNode
  /** Close command for Escape, a mask click, and the optional close button. */
  onClose: () => void
  /** Panel body. */
  children: ReactNode
  /** Optional action row at the panel's trailing edge. */
  footer?: ReactNode
  /** Drawer width: 420px for `md` (default) or 560px for `lg`, capped at the viewport. */
  width?: 'md' | 'lg'
  /** Optional localized accessible name for a header close button; omitting it renders no button. */
  closeLabel?: string
  /** Optional class for the drawer surface; a CSS-module lookup may be undefined. */
  className?: string | undefined
}

/**
 * Render a right-edge drawer.
 * @param props.open - whether the drawer is showing; `false` renders nothing.
 * @param props.title - localized heading, exposed as the dialog's accessible name.
 * @param props.onClose - close command for Escape, a mask click, and the optional close button.
 * @param props.children - panel body.
 * @param props.footer - optional action row.
 * @param props.width - `md` (420px) or `lg` (560px); defaults to `md`.
 * @param props.closeLabel - localized accessible name of a header close button; omitting it leaves
 * Escape and the mask as the only close paths, so the primitive owns no fallback copy.
 * @param props.className - extra class for the drawer surface, not the mask layer.
 * @returns the overlay tree, or null while closed.
 */
export function SidePanel({
  open, title, onClose, children, footer, width = 'md', closeLabel, className,
}: SidePanelProps) {
  const panel = useRef<HTMLDivElement>(null)
  const titleId = useId()
  useModalLayer(panel, open, onClose, '[data-panel-autofocus]')

  if (!open) return null

  return createPortal((
    <div className={css.root} role="presentation">
      <div className={css.mask} aria-hidden="true" onClick={onClose} />
      <div
        ref={panel}
        tabIndex={-1}
        className={clsx(css.panel, css[width], className)}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
      >
        <div className={css.header}>
          <h2 id={titleId} className={css.title}>{title}</h2>
          {closeLabel !== undefined && (
            <Button variant="ghost" size="sm" className={css.close} aria-label={closeLabel} onClick={onClose}>
              <IconCloseOutlineRegular size={14} />
            </Button>
          )}
        </div>
        <div className={css.body}>{children}</div>
        {footer !== undefined && <div className={css.footer}>{footer}</div>}
      </div>
    </div>
  ), document.body)
}
