/** Locale-aware formatting shared by the panel's document surfaces. */

import type { DocItem, HighlightSegment } from '../types.ts'
import type { DocsLocaleKey } from './locales.ts'

/** Characters of a full body the Host delivers; the preview names this bound. */
export const BODY_PREVIEW_LIMIT = 4000

/** Translator signature the components receive from the renderer. */
export type Translate = (key: DocsLocaleKey, params?: Record<string, unknown>) => string

/**
 * Format one ISO instant for the reader's locale and timezone.
 * @param instant - ISO 8601 instant.
 * @returns the localized date and time, or undefined when absent.
 */
export function formatInstant(instant: string | undefined): string | undefined {
  if (instant === undefined || instant === '') return undefined
  const parsed = new Date(instant)
  if (Number.isNaN(parsed.getTime())) return instant
  return new Intl.DateTimeFormat(undefined, { dateStyle: 'medium', timeStyle: 'short' }).format(parsed)
}

/**
 * Join a title's segments into the text the drawer header shows.
 * @param segments - decoded title segments.
 * @returns plain title text.
 */
export function titleText(segments: readonly HighlightSegment[]): string {
  return segments.map(segment => segment.text).join('')
}

/**
 * Name one document type.
 * @param type - normalized type from the Host.
 * @param t - localized copy.
 * @returns the localized type label, or the raw type for an unknown one.
 */
export function typeLabel(type: string, t: Translate): string {
  switch (type) {
    case 'docx': return t('typeDocx')
    case 'doc': return t('typeDoc')
    case 'wiki': return t('typeWiki')
    case 'sheet': return t('typeSheet')
    case 'base': return t('typeBase')
    case 'bitable': return t('typeBase')
    case 'slides': return t('typeSlides')
    case 'mindnote': return t('typeMindnote')
    case 'file': return t('typeFile')
    case 'folder': return t('typeFolder')
    default: return type === '' ? t('typeUnknown') : type
  }
}

/**
 * Test whether the drawer offers block editing for one item.
 * @param item - the listed document.
 * @returns true for docx documents and wiki nodes that may wrap one.
 */
export function editableItem(item: DocItem): boolean {
  return item.type === 'docx' || item.type === 'wiki'
}

/**
 * Count one query in Unicode code points, the unit the search limit uses.
 * @param query - search text.
 * @returns the code-point length.
 */
export function queryLength(query: string): number {
  return Array.from(query).length
}
