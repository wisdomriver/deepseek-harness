/**
 * Minimal scanner for the `with-ids` document XML: block ids, plain text, editability,
 * and the escaping a write-back needs. It is not a general XML parser.
 * @module @deepseek-ai/dsh-feishu-docs/blocks
 */

import type { DocBlock } from './types.ts'

/** Text block tags the panel may rewrite. */
const EDITABLE_TAGS: ReadonlySet<string> = new Set([
  'h1', 'h2', 'h3', 'h4', 'h5', 'h6', 'p', 'li', 'code', 'quote',
])

/** Tags that represent a Feishu resource; a block holding one is never editable. */
const RESOURCE_TAGS: ReadonlySet<string> = new Set([
  'img', 'source', 'whiteboard', 'sheet', 'bitable', 'cite', 'task', 'okr',
  'synced_reference', 'synced_source', 'file', 'media', 'video', 'audio', 'iframe', 'table',
])

/** Tags that carry layout or structure only and are not listed as blocks. */
const CONTAINER_TAGS: ReadonlySet<string> = new Set([
  'fragment', 'title', 'blockquote', 'ul', 'ol', 'thead', 'tbody', 'tfoot', 'tr',
  'colgroup', 'th', 'td', 'callout', 'grid', 'grid_column',
])

/** Elements with no closing tag. */
const VOID_TAGS: ReadonlySet<string> = new Set(['br', 'col', 'hr', 'img', 'source'])

/** One open element while scanning. */
interface Frame {
  readonly tag: string
  readonly id: string | undefined
  /** True for a resource element. */
  readonly resource: boolean
  /** True when any resource has opened inside this element. */
  hasResource: boolean
  /** True when this element sits inside a resource container. */
  readonly hidden: boolean
  /** Accumulated decoded text. */
  text: string
}

/** One opening or closing tag the scanner recognized. */
const TAG = /<(\/?)([A-Za-z][A-Za-z0-9_-]*)((?:"[^"]*"|'[^']*'|[^'">])*?)(\/?)>/g

/** The `id` attribute of one tag's attribute text. */
const ID_ATTRIBUTE = /\sid\s*=\s*(?:"([^"]*)"|'([^']*)')/

/**
 * Test whether one tag may be rewritten in place.
 * @param tag - block tag from the document XML.
 * @returns true for the heading, paragraph, list, code, and quote tags.
 */
export function isEditableTag(tag: string): boolean {
  return EDITABLE_TAGS.has(tag)
}

/**
 * Escape text for XML element content.
 * @param text - plain text from a draft.
 * @returns text safe inside `<tag>…</tag>`.
 */
export function escapeXmlText(text: string): string {
  return text
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;')
}

/**
 * Decode the five entities the document XML uses.
 * @param text - raw XML text content.
 * @returns text with those entities decoded; other entities stay literal.
 */
export function decodeXmlEntities(text: string): string {
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

/**
 * Render one text block as the XML `block_replace` expects.
 * @param tag - editable block tag.
 * @param text - plain replacement text; an empty string clears the block.
 * @returns the XML fragment.
 * @throws Error when the tag is not whitelisted; callers validate before this point.
 */
export function renderBlockXml(tag: string, text: string): string {
  if (!isEditableTag(tag)) throw new Error(`dsh-feishu-docs: ${tag} is not an editable block tag`)
  return `<${tag}>${escapeXmlText(text)}</${tag}>`
}

/**
 * Parse the `with-ids` document XML into the panel's block list.
 * @param xml - `data.document.content` from `docs +fetch --detail with-ids --doc-format xml`.
 * @returns the document title when the XML carries one, and blocks in document order.
 */
export function parseDocumentXml(xml: string): { readonly title?: string; readonly blocks: readonly DocBlock[] } {
  const frames: Frame[] = []
  const blocks: DocBlock[] = []
  let title: string | undefined
  let cursor = 0

  const closeFrame = (frame: Frame): void => {
    if (frame.tag === 'title') {
      const text = normalizeText(frame.text)
      if (text !== '') title = text
      return
    }
    if (frame.id === undefined || CONTAINER_TAGS.has(frame.tag) || frame.hidden) return
    blocks.push({
      blockId: frame.id,
      tag: frame.tag,
      text: normalizeText(frame.text),
      editable: isEditableTag(frame.tag) && !frame.resource && !frame.hasResource,
    })
  }

  const appendText = (text: string): void => {
    for (const frame of frames) frame.text += text
  }

  for (const match of xml.matchAll(TAG)) {
    /* v8 ignore next -- String#matchAll always reports the match index; the loop cursor is never needed. */
    const start = match.index ?? cursor
    if (start > cursor) appendText(decodeXmlEntities(xml.slice(cursor, start)))
    cursor = start + match[0].length
    const closing = match[1] === '/'
    /* v8 ignore next -- a matched TAG always participates in its name group. */
    const tag = match[2] ?? ''
    /* v8 ignore next -- a matched TAG always participates in its attribute group. */
    const attributes = match[3] ?? ''
    const selfClosing = match[4] === '/' || VOID_TAGS.has(tag)
    /* v8 ignore next -- TAG requires a leading letter, so this scan never sees an empty tag. */
    if (tag === '') continue
    if (closing) {
      for (let index = frames.length - 1; index >= 0; index -= 1) {
        if (frames[index]?.tag !== tag) continue
        while (frames.length > index) {
          const frame = frames.pop()
          /* v8 ignore next -- the while bound proves pop() returns a frame. */
          if (frame !== undefined) closeFrame(frame)
        }
        break
      }
      continue
    }
    if (tag === 'br') {
      appendText('\n')
      continue
    }
    const id = idOf(attributes)
    const resource = RESOURCE_TAGS.has(tag)
    const parent = frames[frames.length - 1]
    const hidden = parent?.hidden === true || parent?.resource === true
    if (selfClosing) {
      if (resource) {
        for (const frame of frames) frame.hasResource = true
      }
      if (id !== undefined && !CONTAINER_TAGS.has(tag) && !hidden) {
        blocks.push({ blockId: id, tag, text: '', editable: false })
      }
      continue
    }
    if (resource) {
      for (const frame of frames) frame.hasResource = true
    }
    frames.push({ tag, id, resource, hasResource: false, hidden, text: '' })
  }
  if (cursor < xml.length) appendText(decodeXmlEntities(xml.slice(cursor)))
  while (frames.length > 0) {
    const frame = frames.pop()
    /* v8 ignore next -- the while bound proves pop() returns a frame. */
    if (frame !== undefined) closeFrame(frame)
  }
  return title === undefined ? { blocks } : { title, blocks }
}

/**
 * Read one tag's `id` attribute.
 * @param attributes - the tag text between its name and its closing bracket.
 * @returns the id, or undefined when the tag has none.
 */
function idOf(attributes: string): string | undefined {
  const match = ID_ATTRIBUTE.exec(attributes)
  const id = match?.[1] ?? match?.[2]
  return id === undefined || id === '' ? undefined : id
}

/**
 * Normalize one block's accumulated text.
 * @param text - decoded text including `<br/>` newlines.
 * @returns text with Windows newlines folded and only the edges trimmed.
 */
function normalizeText(text: string): string {
  return text.replaceAll('\r\n', '\n').trim()
}
