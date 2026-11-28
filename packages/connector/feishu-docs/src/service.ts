/**
 * Cloud-document reads and block-level writes over the shared Feishu bridge:
 * recent documents, search, drive folders, document bodies, block edits, renames,
 * and creation, with normalization into the panel's own types.
 * @module @deepseek-ai/dsh-feishu-docs/service
 */

import { FeishuError } from '@deepseek-ai/dsh-feishu-bridge'
import type { CacheStore, CliRequest, FeishuBridge } from '@deepseek-ai/dsh-feishu-bridge'
import { isEditableTag, parseDocumentXml, renderBlockXml } from './blocks.ts'
import {
  codePointLength,
  docTypeOf,
  isSearchType,
  parseHighlighted,
  truncateAt,
} from './normalize.ts'
import type {
  CreateDocInput,
  DocBlocksData,
  DocBodyData,
  DocCreateResult,
  DocDays,
  DocItem,
  DocListData,
  DocMutationInput,
  DocMutationResult,
  DocSort,
  DocsStatus,
} from './types.ts'

/** The program name every diagnostic uses. */
const PROGRAM = 'lark-cli'

/** Scopes the panel needs; a token lacking any of them cannot answer its own reads. */
export const REQUIRED_SCOPES = [
  'docx:document:readonly',
  'docs:document.content:read',
  'drive:drive.metadata:readonly',
  'search:docs:read',
  'wiki:node:read',
] as const

/** Cache lifetime per read kind. */
export const CACHE_TTL_MS = { list: 60_000, document: 300_000 } as const

/** Longest search query the drive service accepts, in Unicode code points. */
export const SEARCH_QUERY_LIMIT = 30

/** Characters of a full body the panel receives. */
export const BODY_LIMIT = 4000

/** Longest Markdown body one write accepts. */
export const CONTENT_LIMIT = 20_000

/** Longest document title one write accepts. */
export const TITLE_LIMIT = 200

/** Polls allowed while an asynchronous document create runs. */
export const CREATE_POLL_ATTEMPTS = 15

/** Delay between two create polls, in milliseconds. */
export const CREATE_POLL_INTERVAL_MS = 1000

/** Values the drive listing accepts for `--order-by`. */
const ORDER_BY = new Set(['EditedTime', 'CreatedTime'])

/** Document read the block editor and the preview ask for. */
export type DocScope = 'outline' | 'full' | 'blocks'

/** Search filters the panel may combine. */
export interface DocFilters {
  /** Restrict to these document types. */
  readonly types?: readonly string[]
  /** Restrict to documents the signed-in user owns. */
  readonly mine?: boolean
}

/** Docs service dependencies. */
export interface DocsServiceOptions {
  /** The shared bridge: one process gate, one cache, one set of failure codes. */
  readonly bridge: FeishuBridge
}

/** Reads cloud documents and folders, and performs the block-level writes. */
export class DocsService {
  /**
   * @param options - the shared bridge.
   */
  constructor(private readonly options: DocsServiceOptions) {}

  /** The shared cache, namespaced with the `docs:` prefix. */
  private get cache(): CacheStore {
    return this.options.bridge.cache
  }

  /**
   * Read the account's CLI, application, and sign-in facts.
   * @returns the status the panel needs to choose its state, including missing scopes.
   * @throws FeishuError when the CLI is missing, unconfigured, or signed out.
   */
  async status(): Promise<DocsStatus> {
    const facts = await this.options.bridge.status()
    const granted = new Set(facts.scopes)
    const missingScopes = REQUIRED_SCOPES.filter(required => !granted.has(required))
    return {
      cli: facts.cli,
      configured: facts.configured,
      connected: facts.connected,
      ...(facts.userName === undefined ? {} : { userName: facts.userName }),
      missingScopes,
    } satisfies DocsStatus
  }

  /**
   * Read documents opened inside the last window.
   * @param days - 7, 30, or 90 days.
   * @param sort - order by last open or last edit.
   * @param refresh - drop the cached answer before reading.
   * @returns normalized rows and the page cursor.
   * @throws FeishuError for invalid input or CLI failures.
   */
  async recent(days: DocDays, sort: DocSort, refresh = false): Promise<DocListData> {
    assertDays(days)
    assertSort(sort)
    const key = `docs:recent:${days}:${sort}`
    return this.list(key, [
      'drive', '+search',
      '--opened-since', `${days}d`,
      '--sort', sort === 'open' ? 'open_time' : 'edit_time',
      '--page-size', '20',
    ], refresh)
  }

  /**
   * Search documents by keyword.
   * @param query - keyword, at most {@link SEARCH_QUERY_LIMIT} code points.
   * @param filters - optional document types and the owned-only flag.
   * @param refresh - drop the cached answer before reading.
   * @returns normalized rows, the reported total, and the page cursor.
   * @throws FeishuError with `invalid-input` before any process starts.
   */
  async search(query: string, filters: DocFilters = {}, refresh = false): Promise<DocListData> {
    const keyword = query.trim()
    if (keyword === '') throw new FeishuError('invalid-input', 'query must not be empty')
    if (codePointLength(keyword) > SEARCH_QUERY_LIMIT) {
      throw new FeishuError('invalid-input', `query must be at most ${SEARCH_QUERY_LIMIT} characters`)
    }
    const types = (filters.types ?? []).map(type => type.trim().toLowerCase()).filter(type => type !== '')
    const unknown = types.find(type => !isSearchType(type))
    if (unknown !== undefined) throw new FeishuError('invalid-input', `unknown document type ${unknown}`)
    const command = ['drive', '+search', '--query', keyword, '--page-size', '20']
    if (types.length > 0) command.push('--doc-types', types.join(','))
    if (filters.mine === true) command.push('--mine')
    const key = `docs:search:${keyword}:${types.join(',')}:${filters.mine === true ? 'mine' : 'all'}`
    return this.list(key, command, refresh)
  }

  /**
   * List one cloud-space folder.
   * @param folderToken - folder token; omit for the user's cloud-space root.
   * @param orderBy - `EditedTime` or `CreatedTime`.
   * @param pageToken - cursor from the previous page.
   * @param refresh - drop the cached answer before reading.
   * @returns normalized rows and the next cursor.
   * @throws FeishuError for invalid input or CLI failures.
   */
  async files(
    folderToken: string | undefined,
    orderBy: 'EditedTime' | 'CreatedTime' | undefined,
    pageToken: string | undefined,
    refresh = false,
  ): Promise<DocListData> {
    if (orderBy !== undefined && !ORDER_BY.has(orderBy)) {
      throw new FeishuError('invalid-input', 'orderBy must be EditedTime or CreatedTime')
    }
    const folder = folderToken?.trim() ?? ''
    const page = pageToken?.trim() ?? ''
    const command = ['drive', 'files', 'list']
    if (folder !== '') command.push('--folder-token', folder)
    if (orderBy !== undefined) command.push('--order-by', orderBy)
    if (page !== '') command.push('--page-token', page)
    const key = `docs:files:${folder}:${orderBy ?? ''}:${page}`
    return this.list(key, command, refresh)
  }

  /**
   * Read one document body.
   * @param token - document token or URL; wiki nodes must be addressed by URL.
   * @param scope - outline or full Markdown, or the block list for editing.
   * @param refresh - drop the cached answer before reading.
   * @returns the Markdown body (bounded for `full`) or the parsed blocks.
   * @throws FeishuError with `invalid-input` for a blank token or unknown scope.
   */
  async document(token: string, scope: DocScope, refresh = false): Promise<DocBodyData> {
    const doc = trimRequired(token, 'token')
    if (scope !== 'outline' && scope !== 'full' && scope !== 'blocks') {
      throw new FeishuError('invalid-input', 'scope must be outline, full, or blocks')
    }
    const key = `docs:doc:${doc}:${scope}`
    if (refresh) this.cache.invalidate(key)
    return this.cache.memo(key, CACHE_TTL_MS.document, async () => {
      if (scope === 'blocks') {
        const document = requireDocument(await this.read([
          'docs', '+fetch',
          '--doc', doc,
          '--scope', 'full',
          '--detail', 'with-ids',
          '--doc-format', 'xml',
        ]))
        const parsed = parseDocumentXml(asString(document.content) ?? '')
        return {
          mode: 'blocks',
          token: doc,
          ...(parsed.title === undefined ? {} : { title: parsed.title }),
          revisionId: revisionOf(document),
          blocks: parsed.blocks,
        } satisfies DocBlocksData
      }
      const document = requireDocument(await this.read([
        'docs', '+fetch',
        '--doc', doc,
        '--scope', scope,
        '--doc-format', 'markdown',
        '--detail', 'simple',
      ]))
      const raw = asString(document.content) ?? ''
      const bounded = scope === 'full' ? truncateAt(raw, BODY_LIMIT) : { text: raw, truncated: false }
      return {
        mode: scope,
        token: doc,
        content: bounded.text,
        truncated: bounded.truncated,
        revisionId: revisionOf(document),
      }
    })
  }

  /**
   * Run one block-level write, a rename, or an append.
   * @param input - action, document, base revision, and action-specific fields.
   * @returns the new revision, the CLI result marker, and any warnings.
   * @throws FeishuError with `invalid-input` before any process starts, `conflict`
   * when the base revision is stale, or the mapped CLI failure.
   */
  async mutate(input: DocMutationInput): Promise<DocMutationResult> {
    switch (input.action) {
      case 'append': return this.append(input)
      case 'replace-block': return this.replaceBlock(input)
      case 'delete-block': return this.deleteBlock(input)
      case 'rename': return this.rename(input)
      default: return assertNever(input.action)
    }
  }

  /**
   * Create one document with an optional Markdown body.
   * @param input - title, optional Markdown, and an optional parent token.
   * @returns the new document id and URL, or `unknown-outcome` when the CLI
   * accepted the request without a result inside the poll budget.
   * @throws FeishuError with `invalid-input` before any process starts.
   */
  async create(input: CreateDocInput): Promise<DocCreateResult> {
    const title = trimRequired(input.title, 'title')
    if (codePointLength(title) > TITLE_LIMIT) {
      throw new FeishuError('invalid-input', `title must be at most ${TITLE_LIMIT} characters`)
    }
    const content = input.content ?? ''
    if (codePointLength(content) > CONTENT_LIMIT) {
      throw new FeishuError('invalid-input', `content must be at most ${CONTENT_LIMIT} characters`)
    }
    const command = ['docs', '+create', '--title', title, '--content', '-', '--doc-format', 'markdown']
    if (input.parentToken !== undefined && input.parentToken.trim() !== '') {
      command.push('--parent-token', input.parentToken.trim())
    }
    const data = requireRecord(await this.write(command, content), 'create result')
    const taskId = asString(data.task_id) ?? asString(asRecord(data.task)?.task_id)
    if (taskId !== undefined && taskId !== '') return this.awaitCreate(taskId)
    const created = createdOf(data)
    if (created === undefined) {
      throw new FeishuError('unknown-outcome', `${PROGRAM} accepted the create request without a document id`)
    }
    this.invalidateLists()
    return created
  }

  /**
   * Poll an asynchronous create until it reports a document or the budget ends.
   * @param taskId - task the create returned.
   * @returns the created document.
   * @throws FeishuError with `unknown-outcome` when the budget ends without a document.
   */
  private async awaitCreate(taskId: string): Promise<DocCreateResult> {
    for (let attempt = 0; attempt < CREATE_POLL_ATTEMPTS; attempt += 1) {
      await sleep(CREATE_POLL_INTERVAL_MS)
      const data = requireRecord(
        await this.read(['api', 'GET', `/open-apis/docs_ai/v1/async_tasks/${taskId}`]),
        'create task',
      )
      const task = asRecord(data.task) ?? data
      const status = asString(task.status) ?? asString(data.status)
      if (status === 'failed' || status === 'error' || status === 'cancelled') {
        throw new FeishuError('upstream', `${PROGRAM} could not create the document (${status})`)
      }
      const created = createdOf(data)
      if (created !== undefined) {
        this.invalidateLists()
        return created
      }
    }
    throw new FeishuError('unknown-outcome', `${PROGRAM} did not finish creating the document in time`)
  }

  /**
   * Append Markdown at the end of one document.
   * @param input - document, base revision, and Markdown body.
   * @returns the write's answer.
   */
  private async append(input: DocMutationInput): Promise<DocMutationResult> {
    const token = trimRequired(input.token, 'token')
    const revisionId = revisionIdOf(input.revisionId)
    const content = requireContent(input.content, 'content')
    const data = await this.update(token, [
      '--command', 'append',
      '--doc-format', 'markdown',
      '--content', '-',
      '--revision-id', String(revisionId),
    ], content)
    return this.mutationResult(token, data)
  }

  /**
   * Replace one editable text block.
   * @param input - document, base revision, block id, tag, and plain replacement text.
   * @returns the write's answer.
   */
  private async replaceBlock(input: DocMutationInput): Promise<DocMutationResult> {
    const token = trimRequired(input.token, 'token')
    const revisionId = revisionIdOf(input.revisionId)
    const blockId = trimRequired(input.blockId ?? '', 'blockId')
    const tag = trimRequired(input.tag ?? '', 'tag')
    if (!isEditableTag(tag)) {
      throw new FeishuError('invalid-input', 'tag must be an editable text block tag')
    }
    const content = input.content ?? ''
    if (codePointLength(content) > CONTENT_LIMIT) {
      throw new FeishuError('invalid-input', `content must be at most ${CONTENT_LIMIT} characters`)
    }
    const data = await this.update(token, [
      '--command', 'block_replace',
      '--block-id', blockId,
      '--content', renderBlockXml(tag, content),
      '--revision-id', String(revisionId),
    ], undefined)
    return this.mutationResult(token, data)
  }

  /**
   * Delete one block.
   * @param input - document, base revision, and block id.
   * @returns the write's answer.
   */
  private async deleteBlock(input: DocMutationInput): Promise<DocMutationResult> {
    const token = trimRequired(input.token, 'token')
    const revisionId = revisionIdOf(input.revisionId)
    const blockId = trimRequired(input.blockId ?? '', 'blockId')
    const data = await this.update(token, [
      '--command', 'block_delete',
      '--block-id', blockId,
      '--revision-id', String(revisionId),
    ], undefined)
    return this.mutationResult(token, data)
  }

  /**
   * Rename one document through the drive shortcut.
   * @param input - document URL and the new title.
   * @returns the new title.
   */
  private async rename(input: DocMutationInput): Promise<DocMutationResult> {
    const token = trimRequired(input.token, 'token')
    const title = trimRequired(input.title ?? '', 'title')
    if (codePointLength(title) > TITLE_LIMIT) {
      throw new FeishuError('invalid-input', `title must be at most ${TITLE_LIMIT} characters`)
    }
    await this.write(['drive', '+update-title', '--url', token, '--title', title])
    this.invalidateLists()
    this.cache.invalidate(`docs:doc:${token}:`)
    return { token, warnings: [], title }
  }

  /**
   * Run one `docs +update` command and map its failure.
   * @param token - document the write addresses.
   * @param flags - action-specific flags after `--doc`.
   * @param stdin - Markdown body for `append`; omitted for block writes.
   * @returns the envelope's data.
   * @throws FeishuError; a `conflict` also drops that document's cached reads.
   */
  private async update(
    token: string,
    flags: readonly string[],
    stdin: string | undefined,
  ): Promise<unknown> {
    try {
      return await this.write(['docs', '+update', '--doc', token, ...flags], stdin)
    } catch (error: unknown) {
      if (error instanceof FeishuError && error.code === 'conflict') {
        this.cache.invalidate(`docs:doc:${token}:`)
      }
      throw error
    }
  }

  /**
   * Normalize one write's answer and drop the reads it invalidates.
   * @param token - document the write addressed.
   * @param raw - the envelope's data.
   * @returns the answer the panel shows.
   */
  private mutationResult(token: string, raw: unknown): DocMutationResult {
    const data = requireRecord(raw, 'update result')
    const document = asRecord(data.document)
    const revisionId = document === undefined ? undefined : optionalRevision(document)
    const result = asString(data.result)
    const updatedBlocks = typeof data.updated_blocks_count === 'number' ? data.updated_blocks_count : undefined
    const warnings = Array.isArray(data.warnings)
      ? data.warnings.filter((warning): warning is string => typeof warning === 'string')
      : []
    this.cache.invalidate(`docs:doc:${token}:`)
    this.invalidateLists()
    return {
      token,
      ...(revisionId === undefined ? {} : { revisionId }),
      ...(result === undefined ? {} : { result }),
      ...(updatedBlocks === undefined ? {} : { updatedBlocks }),
      warnings,
    }
  }

  /**
   * Read one list page through the shared cache.
   * @param key - cache key including every query dimension.
   * @param command - the CLI command.
   * @param refresh - drop the key before reading.
   * @returns normalized rows.
   */
  private async list(key: string, command: readonly string[], refresh: boolean): Promise<DocListData> {
    if (refresh) this.cache.invalidate(key)
    return this.cache.memo(key, CACHE_TTL_MS.list, async () => toList(await this.read(command)))
  }

  /**
   * Run one read through the shared bridge.
   * @param command - subcommand and arguments.
   * @returns the envelope's data.
   * @throws FeishuError mapped by the bridge.
   */
  private async read(command: readonly string[]): Promise<unknown> {
    const request: CliRequest = { command, mode: 'read', retry: 'transient' }
    return (await this.options.bridge.run(request)).data
  }

  /**
   * Run one write through the shared bridge.
   * @param command - subcommand and arguments.
   * @param stdin - optional payload for `--content -`.
   * @returns the envelope's data.
   * @throws FeishuError mapped by the bridge; writes never retry.
   */
  private async write(command: readonly string[], stdin?: string): Promise<unknown> {
    const request: CliRequest = {
      command,
      mode: 'write',
      ...(stdin === undefined ? {} : { stdin }),
    }
    return (await this.options.bridge.run(request)).data
  }

  /** Drop every cached list read after a successful write. */
  private invalidateLists(): void {
    this.cache.invalidate('docs:recent:')
    this.cache.invalidate('docs:search:')
    this.cache.invalidate('docs:files:')
  }
}

/**
 * Normalize one list answer.
 * @param raw - the envelope's data.
 * @returns rows and the page cursor.
 * @throws FeishuError with `upstream` when a row has no token.
 */
function toList(raw: unknown): DocListData {
  const data = requireRecord(raw, 'document list')
  const rawItems = Array.isArray(data.results)
    ? data.results
    : Array.isArray(data.files)
      ? data.files
      : []
  const items = rawItems.map(item => toItem(requireRecord(item, 'document')))
  const pageToken = asString(data.next_page_token) ?? asString(data.page_token)
  const total = typeof data.total === 'number' ? data.total : undefined
  return {
    items,
    hasMore: data.has_more === true,
    ...(pageToken === undefined || pageToken === '' ? {} : { pageToken }),
    ...(total === undefined ? {} : { total }),
    fetchedAt: new Date().toISOString(),
  }
}

/**
 * Normalize one search result or drive file.
 * @param raw - one row.
 * @returns the row the panel renders.
 * @throws FeishuError with `upstream` when the row has no token.
 */
function toItem(raw: Record<string, unknown>): DocItem {
  const meta = asRecord(raw.result_meta) ?? raw
  const token = asString(meta.token) ?? asString(raw.token)
  if (token === undefined || token === '') {
    throw new FeishuError('upstream', `${PROGRAM} returned a document without a token`)
  }
  const entityType = asString(raw.entity_type) ?? ''
  const type = docTypeOf(entityType, asString(meta.doc_types), asString(meta.type) ?? asString(raw.type))
  const titleSource = asString(raw.title_highlighted) ?? asString(meta.name) ?? asString(raw.name) ?? ''
  const summarySource = asString(raw.summary_highlighted)
  const iconKey = iconKeyOf(asString(meta.icon_info))
  const url = asString(meta.url)
  const ownerName = asString(meta.owner_name)
  const editorName = asString(meta.edit_user_name)
  const lastOpenedAt = asString(meta.last_open_time_iso)
  const updatedAt = asString(meta.update_time_iso) ?? epochToIso(meta.modified_time)
  return {
    token,
    title: parseHighlighted(titleSource),
    type,
    entityType,
    isFolder: type === 'folder',
    ...(url === undefined || url === '' ? {} : { url }),
    ...(ownerName === undefined || ownerName === '' ? {} : { ownerName }),
    ...(editorName === undefined || editorName === '' ? {} : { editorName }),
    ...(lastOpenedAt === undefined || lastOpenedAt === '' ? {} : { lastOpenedAt }),
    ...(updatedAt === undefined || updatedAt === '' ? {} : { updatedAt }),
    ...(iconKey === undefined ? {} : { iconKey }),
    ...(summarySource === undefined ? {} : { summary: parseHighlighted(summarySource) }),
  }
}

/**
 * Read the type-icon key out of the `icon_info` JSON string.
 * @param raw - JSON string the CLI returns.
 * @returns the key, or undefined when absent or unparsable.
 */
function iconKeyOf(raw: string | undefined): string | undefined {
  if (raw === undefined || raw === '') return undefined
  let parsed: unknown
  try {
    parsed = JSON.parse(raw)
  } catch (error: unknown) {
    /* v8 ignore next -- JSON.parse throws only SyntaxError, so the non-syntax rethrow cannot run. */
    if (!(error instanceof SyntaxError)) throw error
    return undefined
  }
  const key = asString(asRecord(parsed)?.key)
  return key === undefined || key === '' ? undefined : key
}

/**
 * Turn a seconds-since-epoch field into an ISO instant.
 * @param value - numeric or numeric-string timestamp.
 * @returns the ISO instant, or undefined when the value is not a timestamp.
 */
function epochToIso(value: unknown): string | undefined {
  const seconds = typeof value === 'number' ? value : typeof value === 'string' ? Number(value) : Number.NaN
  if (!Number.isFinite(seconds) || seconds <= 0) return undefined
  return new Date(seconds * 1000).toISOString()
}

/**
 * Read one document object from a fetch answer.
 * @param data - the envelope's data.
 * @returns the `document` object.
 * @throws FeishuError with `upstream` when the answer carries none.
 */
function requireDocument(data: unknown): Record<string, unknown> {
  const document = asRecord(requireRecord(data, 'document answer').document)
  if (document === undefined) throw new FeishuError('upstream', `${PROGRAM} returned no document`)
  return document
}

/**
 * Read a numeric revision id.
 * @param document - the `document` object.
 * @returns the revision.
 * @throws FeishuError with `upstream` when the answer carries none.
 */
function revisionOf(document: Record<string, unknown>): number {
  const revision = optionalRevision(document)
  if (revision === undefined) {
    throw new FeishuError('upstream', `${PROGRAM} returned no document revision`)
  }
  return revision
}

/**
 * Read a numeric revision id without requiring it.
 * @param document - an object that may carry `revision_id`.
 * @returns the revision, or undefined.
 */
function optionalRevision(document: Record<string, unknown>): number | undefined {
  const value = document.revision_id
  const revision = typeof value === 'number' ? value : typeof value === 'string' ? Number(value) : Number.NaN
  return Number.isInteger(revision) && revision >= 0 ? revision : undefined
}

/**
 * Read one created document out of a create or task answer.
 * @param data - the envelope's data.
 * @returns the created document, or undefined when the answer has no id yet.
 */
function createdOf(data: Record<string, unknown>): DocCreateResult | undefined {
  const candidates = [
    data,
    asRecord(data.document),
    asRecord(data.result),
    asRecord(data.task),
    asRecord(asRecord(data.task)?.result),
  ]
  for (const candidate of candidates) {
    if (candidate === undefined) continue
    const documentId = asString(candidate.document_id) ?? asString(candidate.doc_id) ?? asString(candidate.token)
    if (documentId === undefined || documentId === '') continue
    const url = asString(candidate.url)
    return {
      documentId,
      ...(url === undefined || url === '' ? {} : { url }),
      pending: false,
    }
  }
  return undefined
}

/**
 * Narrow one value to a non-array object.
 * @param value - value from the CLI envelope.
 * @returns the object, or undefined.
 */
function asRecord(value: unknown): Record<string, unknown> | undefined {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    ? value as Record<string, unknown>
    : undefined
}

/**
 * Require one value to be a non-array object.
 * @param value - value from the CLI envelope.
 * @param subject - what the value should be, for the diagnostic.
 * @returns the object.
 * @throws FeishuError with `upstream` when the value is not an object.
 */
function requireRecord(value: unknown, subject: string): Record<string, unknown> {
  const record = asRecord(value)
  if (record === undefined) throw new FeishuError('upstream', `${PROGRAM} returned no ${subject}`)
  return record
}

/**
 * Read one optional string field.
 * @param value - field value.
 * @returns the string, or undefined for absent and non-string values.
 */
function asString(value: unknown): string | undefined {
  return typeof value === 'string' ? value : undefined
}

/**
 * Require a non-empty trimmed string.
 * @param value - candidate value.
 * @param field - field name, for the diagnostic.
 * @returns the trimmed value.
 * @throws FeishuError with `invalid-input` when the value is empty.
 */
function trimRequired(value: string, field: string): string {
  const trimmed = value.trim()
  if (trimmed === '') throw new FeishuError('invalid-input', `${field} must not be empty`)
  return trimmed
}

/**
 * Require a Markdown body within the write bound.
 * @param value - body the browser sent.
 * @param field - field name, for the diagnostic.
 * @returns the body.
 * @throws FeishuError with `invalid-input` for an absent, empty, or oversized body.
 */
function requireContent(value: string | undefined, field: string): string {
  if (value === undefined || value.trim() === '') {
    throw new FeishuError('invalid-input', `${field} must not be empty`)
  }
  if (codePointLength(value) > CONTENT_LIMIT) {
    throw new FeishuError('invalid-input', `${field} must be at most ${CONTENT_LIMIT} characters`)
  }
  return value
}

/**
 * Require the base revision a block write declares.
 * @param value - revision from the browser.
 * @returns the revision.
 * @throws FeishuError with `invalid-input` when the value is not a non-negative integer.
 */
function revisionIdOf(value: number | undefined): number {
  if (value === undefined || !Number.isInteger(value) || value < 0) {
    throw new FeishuError('invalid-input', 'revisionId must be a non-negative integer')
  }
  return value
}

/**
 * Validate the recent window.
 * @param days - window the browser asked for.
 * @throws FeishuError with `invalid-input` for anything but 7, 30, or 90.
 */
function assertDays(days: number): asserts days is DocDays {
  if (days !== 7 && days !== 30 && days !== 90) {
    throw new FeishuError('invalid-input', 'days must be 7, 30, or 90')
  }
}

/**
 * Validate the recent ordering.
 * @param sort - ordering the browser asked for.
 * @throws FeishuError with `invalid-input` for anything but open or edit.
 */
function assertSort(sort: string): asserts sort is DocSort {
  if (sort !== 'open' && sort !== 'edit') {
    throw new FeishuError('invalid-input', 'sort must be open or edit')
  }
}

/**
 * Wait for one poll interval.
 * @param ms - milliseconds to wait.
 * @returns completion after the delay.
 */
function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => { setTimeout(resolve, ms) })
}

/**
 * Prove a closed union is exhausted.
 * @param value - impossible value.
 * @returns never; it throws for a value outside the union.
 */
function assertNever(value: never): never {
  throw new FeishuError('internal', `dsh-feishu-docs: unhandled mutation ${String(value)}`)
}
