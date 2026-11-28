/** Minimal Markdown renderer: headings, paragraphs, quotes, lists, tables, code, and safe links. */

import { Fragment, type ReactNode } from 'react'
import { parseInline, parseMarkdown, type MarkdownNode } from './markdown.ts'
import css from './MarkdownBody.module.css'

/** Props the preview hands the body. */
export interface MarkdownBodyProps {
  /** Markdown text. */
  readonly text: string
  /** Copy shown when the text holds no renderable block. */
  readonly emptyLabel: string
}

/**
 * Render one Markdown body as text, never as HTML.
 * @param props - Markdown text and the empty copy.
 * @returns the rendered body.
 */
export function MarkdownBody({ text, emptyLabel }: MarkdownBodyProps): ReactNode {
  const nodes = parseMarkdown(text)
  if (nodes.length === 0) return <p className={css.empty}>{emptyLabel}</p>
  return <div className={css.body}>{nodes.map((node, index) => <Fragment key={index}>{renderNode(node)}</Fragment>)}</div>
}

/**
 * Render one parsed block.
 * @param node - parsed Markdown block.
 * @returns the element.
 */
function renderNode(node: MarkdownNode): ReactNode {
  switch (node.kind) {
    case 'heading': {
      const Tag = `h${node.level}` as 'h1'
      return <Tag className={css.heading}>{inline(node.text)}</Tag>
    }
    case 'paragraph':
      return <p className={css.paragraph}>{inline(node.text)}</p>
    case 'quote':
      return <blockquote className={css.quote}>{inline(node.text)}</blockquote>
    case 'list':
      return node.ordered
        ? <ol className={css.list}>{node.items.map((item, index) => <li key={index}>{inline(item)}</li>)}</ol>
        : <ul className={css.list}>{node.items.map((item, index) => <li key={index}>{inline(item)}</li>)}</ul>
    case 'code':
      return <pre className={css.code}><code>{node.text}</code></pre>
    case 'table':
      return renderTable(node.rows)
    default:
      return null
  }
}

/**
 * Render one pipe table; the first row becomes the header when more rows follow.
 * @param rows - parsed rows.
 * @returns the table element.
 */
function renderTable(rows: readonly (readonly string[])[]): ReactNode {
  const [head, ...body] = rows
  if (head === undefined) return null
  const wide = body.length > 0
  return (
    <div className={css.tableWrap}>
      <table className={css.table}>
        {wide ? <thead><tr>{head.map((cell, index) => <th key={index}>{inline(cell)}</th>)}</tr></thead> : null}
        <tbody>
          {(wide ? body : [head]).map((row, rowIndex) => (
            <tr key={rowIndex}>{row.map((cell, cellIndex) => <td key={cellIndex}>{inline(cell)}</td>)}</tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

/**
 * Render one inline run: absolute http(s) links, bold spans, and inline code.
 * @param text - inline Markdown.
 * @returns the runs.
 */
function inline(text: string): ReactNode {
  return parseInline(text).map((node, index) => {
    if (node.href !== undefined) {
      return <a key={index} className={css.link} href={node.href} target="_blank" rel="noreferrer">{node.text}</a>
    }
    if (node.emphasis === 'bold') return <strong key={index} className={css.strong}>{node.text}</strong>
    if (node.emphasis === 'code') return <code key={index} className={css.inlineCode}>{node.text}</code>
    return <span key={index}>{node.text}</span>
  })
}
