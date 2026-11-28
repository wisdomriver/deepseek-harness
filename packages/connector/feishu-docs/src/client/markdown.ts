/** Minimal Markdown grouping for the preview: headings, lists, quotes, tables, code, and safe links. */

/** One run of a paragraph: plain text, an absolute link, bold text, or inline code. */
export interface InlineNode {
  /** Display text. */
  readonly text: string
  /** Absolute link target, when this run was a link. */
  readonly href?: string
  /** Emphasis carried by this run, when the source marked one. */
  readonly emphasis?: 'bold' | 'code'
}

/** One heading the outline lists. */
export interface MarkdownHeading {
  /** Heading level, 1 through 6. */
  readonly level: number
  /** Heading text as written. */
  readonly text: string
}

/** One display block the preview renders. */
export type MarkdownNode =
  | { readonly kind: 'heading'; readonly level: number; readonly text: string }
  | { readonly kind: 'paragraph'; readonly text: string }
  | { readonly kind: 'quote'; readonly text: string }
  | { readonly kind: 'list'; readonly ordered: boolean; readonly items: readonly string[] }
  | { readonly kind: 'code'; readonly text: string }
  | { readonly kind: 'table'; readonly rows: readonly (readonly string[])[] }

/** Opening or closing code fence. */
const FENCE = /^\s*```/

/** ATX heading. */
const HEADING = /^(#{1,6})\s+(.*)$/

/** Block quote line. */
const QUOTE = /^>\s?(.*)$/

/** Bullet or ordered list item. */
const LIST = /^\s*(?:[-*]|\d+\.)\s+(.*)$/

/** Absolute http(s) link, bold span, or inline code in inline Markdown. */
const INLINE = /\[([^\]\n]+)\]\((https?:\/\/[^\s)]+)\)|\*\*([^*\n]+)\*\*|`([^`\n]+)`/g

/** A pipe-table row, which starts and ends with a pipe. */
const TABLE_ROW = /^\s*\|.*\|\s*$/

/** The separator row under a pipe-table header. */
const TABLE_SEPARATOR = /^\s*\|?[\s:|-]+\|?\s*$/

/**
 * Split one inline run into text, safe links, bold spans, and inline code.
 * @param text - Markdown source of one run.
 * @returns display runs; only absolute http(s) links become links.
 */
export function parseInline(text: string): readonly InlineNode[] {
  const nodes: InlineNode[] = []
  let cursor = 0
  for (const match of text.matchAll(INLINE)) {
    /* v8 ignore next -- String#matchAll always reports the match index; the loop cursor is never needed. */
    const start = match.index ?? cursor
    if (start > cursor) nodes.push({ text: text.slice(cursor, start) })
    if (match[1] !== undefined && match[2] !== undefined) {
      nodes.push({ text: match[1], href: match[2] })
    } else if (match[3] !== undefined) {
      nodes.push({ text: match[3], emphasis: 'bold' })
    } else {
      /* v8 ignore next -- the code alternative is the only INLINE arm that leaves group 4, so it always participates. */
      nodes.push({ text: match[4] ?? '', emphasis: 'code' })
    }
    cursor = start + match[0].length
  }
  if (cursor < text.length) nodes.push({ text: text.slice(cursor) })
  return nodes.filter(node => node.text !== '')
}

/**
 * Test whether one line is a pipe-table row.
 * @param line - candidate line.
 * @returns true for a line that starts and ends with a pipe.
 */
function isTableRow(line: string): boolean {
  return TABLE_ROW.test(line)
}

/**
 * Test whether one line is the separator under a table header.
 * @param line - candidate line.
 * @returns true for a dash-and-pipe line.
 */
function isTableSeparator(line: string): boolean {
  return TABLE_SEPARATOR.test(line) && line.includes('-')
}

/**
 * Split one pipe-table row into trimmed cells.
 * @param line - table row.
 * @returns the cells without the outer pipes.
 */
function splitCells(line: string): readonly string[] {
  const inner = line.trim().replace(/^\|/, '').replace(/\|$/, '')
  return inner.split('|').map(cell => cell.trim())
}

/**
 * Read the headings an outline body carries.
 * @param markdown - outline Markdown from the Host.
 * @returns headings in document order.
 */
export function parseOutline(markdown: string): readonly MarkdownHeading[] {
  const headings: MarkdownHeading[] = []
  for (const line of markdown.split(/\r?\n/)) {
    const match = HEADING.exec(line)
    if (match === null) continue
    /* v8 ignore next -- a matched HEADING always participates in both capture groups. */
    headings.push({ level: match[1]?.length ?? 1, text: (match[2] ?? '').trim() })
  }
  return headings
}

/**
 * Group Markdown into the blocks the preview renders.
 * @param markdown - Markdown body from the Host.
 * @returns display blocks in document order.
 */
export function parseMarkdown(markdown: string): readonly MarkdownNode[] {
  const lines = markdown.split(/\r?\n/)
  const nodes: MarkdownNode[] = []
  let index = 0
  while (index < lines.length) {
    /* v8 ignore next -- the loop bound proves this line exists. */
    const line = lines[index] ?? ''
    if (line.trim() === '') {
      index += 1
      continue
    }
    if (FENCE.test(line)) {
      const code: string[] = []
      index += 1
      /* v8 ignore next -- the loop bound proves this line exists. */
      while (index < lines.length && !FENCE.test(lines[index] ?? '')) {
        /* v8 ignore next -- the loop bound proves this line exists. */
        code.push(lines[index] ?? '')
        index += 1
      }
      index += 1
      nodes.push({ kind: 'code', text: code.join('\n') })
      continue
    }
    const heading = HEADING.exec(line)
    if (heading !== null) {
      /* v8 ignore next -- a matched HEADING always participates in both capture groups. */
      nodes.push({ kind: 'heading', level: heading[1]?.length ?? 1, text: (heading[2] ?? '').trim() })
      index += 1
      continue
    }
    if (QUOTE.test(line)) {
      const quoted: string[] = []
      /* v8 ignore next -- the loop bound proves this line exists. */
      while (index < lines.length && QUOTE.test(lines[index] ?? '')) {
        /* v8 ignore next -- the loop bound proves the line and its group exist. */
        quoted.push(QUOTE.exec(lines[index] ?? '')?.[1] ?? '')
        index += 1
      }
      nodes.push({ kind: 'quote', text: quoted.join('\n') })
      continue
    }
    if (LIST.test(line)) {
      const ordered = /^\s*\d+\./.test(line)
      const items: string[] = []
      /* v8 ignore next -- the loop bound proves this line exists. */
      while (index < lines.length && LIST.test(lines[index] ?? '')) {
        /* v8 ignore next -- the loop bound proves the line and its group exist. */
        items.push(LIST.exec(lines[index] ?? '')?.[1] ?? '')
        index += 1
      }
      nodes.push({ kind: 'list', ordered, items })
      continue
    }
    const next = lines[index + 1] ?? ''
    if (isTableRow(line) && isTableSeparator(next)) {
      const rows: string[][] = []
      /* v8 ignore next -- the loop bound proves this line exists. */
      while (index < lines.length && isTableRow(lines[index] ?? '')) {
        /* v8 ignore next -- the loop bound proves this line exists. */
        const row = lines[index] ?? ''
        if (!isTableSeparator(row)) rows.push([...splitCells(row)])
        index += 1
      }
      nodes.push({ kind: 'table', rows })
      continue
    }
    const paragraph: string[] = []
    while (index < lines.length) {
      /* v8 ignore next -- the loop bound proves this line exists. */
      const current = lines[index] ?? ''
      if (
        current.trim() === ''
        || FENCE.test(current)
        || HEADING.test(current)
        || QUOTE.test(current)
        || LIST.test(current)
      ) {
        break
      }
      paragraph.push(current)
      index += 1
    }
    nodes.push({ kind: 'paragraph', text: paragraph.join('\n') })
  }
  return nodes
}
