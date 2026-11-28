/** Token-styled textarea for the block editor, the append box, and the create form. */

import type { ReactNode } from 'react'
import css from './MultilineField.module.css'

/** Props one multiline field takes. */
export interface MultilineFieldProps {
  /** Current text. */
  readonly value: string
  /** Called with every edit. */
  readonly onChange: (value: string) => void
  /** Accessible name. */
  readonly label: string
  /** Placeholder copy. */
  readonly placeholder?: string
  /** Disables editing while a request runs. */
  readonly disabled?: boolean
  /** Visible rows. */
  readonly rows?: number
}

/**
 * Render one token-styled textarea.
 * @param props - value, change handler, label, and optional settings.
 * @returns the field.
 */
export function MultilineField({ value, onChange, label, placeholder, disabled, rows = 4 }: MultilineFieldProps): ReactNode {
  return (
    <textarea
      className={css.field}
      aria-label={label}
      placeholder={placeholder}
      rows={rows}
      value={value}
      disabled={disabled === true}
      onChange={(event) => { onChange(event.target.value) }}
    />
  )
}
