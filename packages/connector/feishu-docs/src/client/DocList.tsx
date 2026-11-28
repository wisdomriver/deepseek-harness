/** The document list: type glyph, highlighted title, owner, time, and type. */

import type { ReactNode } from 'react'
import type { DocItem } from '../types.ts'
import { formatInstant, typeLabel, type Translate } from './format.ts'
import { DocTypeGlyph } from './DocIcon.tsx'
import css from './DocList.module.css'

/** Props the panel hands the list. */
export interface DocListProps {
  /** Rows to show. */
  readonly items: readonly DocItem[]
  /** Localized copy. */
  readonly t: Translate
  /** Activate one row: open the document or enter the folder. */
  readonly onActivate: (item: DocItem) => void
}

/**
 * Render one page of list rows.
 * @param props - rows, localized copy, and the activation callback.
 * @returns the list.
 */
export function DocList({ items, t, onActivate }: DocListProps): ReactNode {
  return (
    <ul className={css.list} role="list">
      {items.map(item => (
        <li key={item.token} className={css.cell}>
          <button
            type="button"
            className={css.row}
            onClick={() => { onActivate(item) }}
          >
            <span className={css.icon}><DocTypeGlyph type={item.type} /></span>
            <span className={css.main}>
              <span className={css.title}>
                {item.title.map((segment, index) => (segment.highlighted
                  ? <mark key={index} className={css.highlight}>{segment.text}</mark>
                  : <span key={index}>{segment.text}</span>))}
              </span>
              {item.summary === undefined || item.summary.length === 0
                ? null
                : (
                  <span className={css.summary}>
                    {item.summary.map((segment, index) => (segment.highlighted
                      ? <mark key={index} className={css.highlight}>{segment.text}</mark>
                      : <span key={index}>{segment.text}</span>))}
                  </span>
                )}
            </span>
            {item.ownerName === undefined ? null : <span className={css.meta}>{item.ownerName}</span>}
            {formatInstant(item.updatedAt ?? item.lastOpenedAt) === undefined
              ? null
              : <span className={css.meta}>{formatInstant(item.updatedAt ?? item.lastOpenedAt)}</span>}
            <span className={css.type}>{typeLabel(item.type, t)}</span>
          </button>
        </li>
      ))}
    </ul>
  )
}
