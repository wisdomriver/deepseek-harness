// Locale-aware formatting: instants, joined titles, type labels, editability, and query length.

import { describe, expect, it } from 'vitest'
import {
  BODY_PREVIEW_LIMIT,
  editableItem,
  formatInstant,
  queryLength,
  titleText,
  typeLabel,
} from '../src/client/format.ts'
import type { DocItem } from '../src/types.ts'
import { t } from './ui.client.ts'

/** One listed row; only the fields a case reads are set. */
function itemOf(overrides: Partial<DocItem> = {}): DocItem {
  return {
    token: 'd1',
    title: [{ text: 'Doc', highlighted: false }],
    type: 'docx',
    entityType: 'DOC',
    isFolder: false,
    ...overrides,
  }
}

describe('formatInstant', () => {
  it('renders one instant in the reader locale', () => {
    expect(formatInstant('2026-11-25T23:12:18+08:00')).toMatch(/2026/)
  })

  it('omits absent and empty instants', () => {
    expect(formatInstant(undefined)).toBeUndefined()
    expect(formatInstant('')).toBeUndefined()
  })

  it('keeps an unparsable instant as written', () => {
    expect(formatInstant('2026-13-45')).toBe('2026-13-45')
    expect(formatInstant('yesterday')).toBe('yesterday')
  })
})

describe('titleText', () => {
  it('joins every segment without markup', () => {
    expect(titleText([
      { text: 'DSH', highlighted: true },
      { text: ' 工作流', highlighted: false },
    ])).toBe('DSH 工作流')
  })

  it('joins an empty title to an empty string', () => {
    expect(titleText([])).toBe('')
  })
})

describe('typeLabel', () => {
  it('names every known document type', () => {
    const labels = ['docx', 'doc', 'wiki', 'sheet', 'base', 'bitable', 'slides', 'mindnote', 'file', 'folder']
      .map(type => typeLabel(type, t))
    expect(labels).toEqual([
      'Document', 'Legacy document', 'Wiki', 'Sheet', 'Base', 'Base',
      'Slides', 'Mindnote', 'File', 'Folder',
    ])
  })

  it('uses the unknown label for an empty type and the raw name for anything else', () => {
    expect(typeLabel('', t)).toBe('Other')
    expect(typeLabel('whiteboard', t)).toBe('whiteboard')
  })
})

describe('editableItem', () => {
  it('offers block editing only for documents a text block can be rewritten in', () => {
    expect(editableItem(itemOf({ type: 'docx' }))).toBe(true)
    expect(editableItem(itemOf({ type: 'wiki' }))).toBe(true)
    expect(editableItem(itemOf({ type: 'sheet' }))).toBe(false)
    expect(editableItem(itemOf({ type: 'folder', isFolder: true }))).toBe(false)
  })
})

describe('queryLength', () => {
  it('counts code points, so a surrogate pair is one character', () => {
    expect(queryLength('😀😀')).toBe(2)
    expect(queryLength('云文档')).toBe(3)
  })

  it('states the body bound the preview names', () => {
    expect(BODY_PREVIEW_LIMIT).toBe(4000)
  })
})
