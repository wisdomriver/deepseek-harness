// ListRow: one activatable row of a panel list — optional leading glyph,
// title, optional meta line, and trailing presentation. The row is the single
// interactive target, so a caller that needs row actions renders them beside
// or outside it rather than nesting another control.

import type { KeyboardEvent, ReactNode } from 'react'
import clsx from 'clsx'
import css from './ListRow.module.css'

/** Props for {@link ListRow}. */
export interface ListRowProps {
  /** Optional leading glyph or artwork. */
  leading?: ReactNode
  /** Primary row text; it truncates to one line. */
  title: ReactNode
  /** Optional secondary line under the title, such as an owner or a type. */
  meta?: ReactNode
  /** Optional trailing presentation, such as a time or a status label. */
  trailing?: ReactNode
  /** Marks this row as the current item; exposure is `aria-current="true"`. */
  selected?: boolean
  /** Keeps the row focusable and readable while refusing activation. */
  disabled?: boolean
  /** Activation command for a click, Enter, or Space. */
  onActivate: () => void
  /** Optional class for layout placement; a CSS-module lookup may be undefined. */
  className?: string | undefined
}

/**
 * Render one list row.
 * @param props.leading - optional leading glyph or artwork.
 * @param props.title - primary row text.
 * @param props.meta - optional secondary line under the title.
 * @param props.trailing - optional trailing presentation.
 * @param props.selected - whether the row is the current item, exposed as `aria-current="true"`.
 * @param props.disabled - whether the row refuses activation; it stays focusable and keeps `aria-disabled`.
 * @param props.onActivate - click, Enter, or Space activation.
 * @param props.className - extra class for the row element.
 * @returns the focusable row element.
 */
export function ListRow({
  leading, title, meta, trailing, selected = false, disabled = false, onActivate, className,
}: ListRowProps) {
  const activate = (): void => {
    if (!disabled) onActivate()
  }
  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>): void => {
    if (event.key !== 'Enter' && event.key !== ' ') return
    // The row is not a native button, so the keys' default scrolling and
    // click emulation must be cancelled before activating.
    event.preventDefault()
    activate()
  }
  return (
    <div
      className={clsx(css.row, selected && css.selected, disabled && css.disabled, className)}
      role="button"
      tabIndex={0}
      aria-current={selected ? 'true' : undefined}
      aria-disabled={disabled || undefined}
      onClick={activate}
      onKeyDown={onKeyDown}
    >
      {leading != null && <div className={css.leading}>{leading}</div>}
      <div className={css.body}>
        <div className={css.title}>{title}</div>
        {meta != null && <div className={css.meta}>{meta}</div>}
      </div>
      {trailing != null && <div className={css.trailing}>{trailing}</div>}
    </div>
  )
}
