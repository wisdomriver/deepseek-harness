/**
 * Pure normalization shared by the docs service and its tests: search highlighting,
 * type mapping, and body bounds.
 * @module @deepseek-ai/dsh-feishu-docs/normalize
 */

import type { HighlightSegment } from './types.ts'

/** Document types the search command accepts. */
const SEARCH_TYPES: ReadonlySet<string> = new Set([
  'doc', 'sheet', 'bitable', 'mindnote', 'file', 'wiki', 'docx', 'folder', 'catalog', 'slides', 'shortcut',
])

/** One highlighted run in the CLI's `title_highlighted` or `summary_highlighted`. */
const HIGHLIGHT = /<h>([\s\S]*?)<\/h>/g

/**
 * Turn one highlighted string into display segments.
 * @param raw - CLI text where `<h>…</h>` marks a search hit.
 * @returns decoded segments; the browser renders them as text, never as HTML.
 */
export function parseHighlighted(raw: string): readonly HighlightSegment[] {
  const segments: HighlightSegment[] = []
  let cursor = 0
  for (const match of raw.matchAll(HIGHLIGHT)) {
    /* v8 ignore next -- String#matchAll always reports the match index; the loop cursor is never needed. */
    const start = match.index ?? cursor
    if (start > cursor) {
      segments.push({ text: decodeEntities(raw.slice(cursor, start)), highlighted: false })
    }
    /* v8 ignore next -- a matched HIGHLIGHT always participates in its text group. */
    segments.push({ text: decodeEntities(match[1] ?? ''), highlighted: true })
    cursor = start + match[0].length
  }
  if (cursor < raw.length) {
    segments.push({ text: decodeEntities(raw.slice(cursor)), highlighted: false })
  }
  return segments.filter(segment => segment.text !== '')
}

/**
 * Join one title's segments back into plain text.
 * @param segments - decoded segments.
 * @returns the text without markup.
 */
export function textOf(segments: readonly HighlightSegment[]): string {
  return segments.map(segment => segment.text).join('')
}

/**
 * Map the list fields onto the panel's type names.
 * @param entityType - `entity_type`, e.g. `DOC` or `WIKI`.
 * @param docTypes - `result_meta.doc_types`, e.g. `DOCX`.
 * @param fileType - the flat `type` field the file listing returns.
 * @returns `wiki` for a wiki node, otherwise the lowercase doc type; `file` when unknown.
 */
export function docTypeOf(entityType: string | undefined, docTypes: string | undefined, fileType: string | undefined): string {
  if (entityType?.toUpperCase() === 'WIKI') return 'wiki'
  const source = (docTypes ?? fileType ?? '').trim()
  if (source === '') return 'file'
  /* v8 ignore next -- a non-empty source split always yields a first segment. */
  const first = source.split(',')[0]?.trim().toLowerCase() ?? ''
  return first === '' ? 'file' : first
}

/**
 * Test one search type before it reaches the command line.
 * @param type - type the browser asked to filter by.
 * @returns true for the document types `drive +search` accepts.
 */
export function isSearchType(type: string): boolean {
  return SEARCH_TYPES.has(type)
}

/**
 * Cut text at a code-point bound without splitting a surrogate pair.
 * @param text - full text.
 * @param limit - maximum code points to keep.
 * @returns the kept text and whether anything was cut.
 */
export function truncateAt(text: string, limit: number): { readonly text: string; readonly truncated: boolean } {
  const points = Array.from(text)
  return points.length <= limit
    ? { text, truncated: false }
    : { text: points.slice(0, limit).join(''), truncated: true }
}

/**
 * Count text in Unicode code points, the unit the CLI limits searches by.
 * @param text - text to measure.
 * @returns the code-point length.
 */
export function codePointLength(text: string): number {
  return Array.from(text).length
}

/**
 * Decode the five entities the CLI uses in highlighted text.
 * @param text - raw text.
 * @returns text with those entities decoded.
 */
function decodeEntities(text: string): string {
  return text.replace(/&(amp|lt|gt|quot|#39);/g, (_match, name: string) => {
    switch (name) {
      case 'amp': return '&'
      case 'lt': return '<'
      case 'gt': return '>'
      case 'quot': return '"'
      default: return "'"
    }
  })
}
