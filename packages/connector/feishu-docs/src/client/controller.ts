/**
 * Panel data plumbing: list reads, document reads, block edits, renames, and creation,
 * plus the snapshot store the components read.
 */

import { createSnapshotStore, type SnapshotStore } from '@deepseek-ai/dsh-client-store'
import { DOCUMENT_ROUTE, DOCUMENTS_ROUTE, FILES_ROUTE, RECENT_ROUTE, SEARCH_ROUTE, STATUS_ROUTE } from '../paths.ts'
import type {
  CreateDocInput,
  DocBlock,
  DocBlocksData,
  DocBodyData,
  DocCreateResult,
  DocDays,
  DocDocumentData,
  DocItem,
  DocListData,
  DocMutationInput,
  DocMutationResult,
  DocSort,
  DocsResponse,
  DocsStatus,
  DocView,
} from '../types.ts'
import { editableItem, queryLength, titleText } from './format.ts'

/** Loading, a shown list, an empty list, or one of the unavailable states. */
export type DocsPhase = 'loading' | 'ready' | 'empty' | 'no-cli' | 'disconnected' | 'permission' | 'error'

/** Drive ordering for the folder view. */
export type FileOrder = 'EditedTime' | 'CreatedTime'

/** One open document's drawer. */
export interface DocSelectionState {
  /** Row the drawer addresses. */
  readonly item: DocItem
  /** Outline read state. */
  readonly phase: 'loading' | 'ready' | 'error'
  /** Markdown outline from the Host. */
  readonly outline?: string
  /** Markdown body read on demand. */
  readonly full?: string
  /** Body read state while the user views it. */
  readonly fullPhase?: 'loading' | 'ready' | 'error'
  /** True when the Host cut the body. */
  readonly truncated?: boolean
  /** Revision every write declares. */
  readonly revisionId?: number
  /** Parsed blocks, present once the editor opened. */
  readonly blocks?: readonly DocBlock[]
  /** Block read state. */
  readonly blocksPhase?: 'loading' | 'ready' | 'error'
  /** True while the block editor is open. */
  readonly editing: boolean
  /** The draft being edited, if any. */
  readonly editor?: DocEditorState
  /** Banner from the last write. */
  readonly banner?: DocBanner
  /** Rename form state. */
  readonly renameState?: DocRenameState
  /** Stable failure code from the last drawer read or write. */
  readonly errorCode?: string
}

/** One block or append draft. */
export interface DocEditorState {
  /** Block rewrite, Markdown append, or title rename. */
  readonly mode: 'block' | 'append'
  /** Target block for a block rewrite. */
  readonly blockId?: string
  /** Target block tag for a block rewrite. */
  readonly tag?: string
  /** Draft text. */
  readonly text: string
  /** True while the write request runs. */
  readonly saving: boolean
  /** Stable failure code from the last attempt. */
  readonly errorCode?: string
}

/** The banner a write leaves in the drawer. */
export interface DocBanner {
  /** Partial success or a revision conflict. */
  readonly kind: 'partial' | 'conflict'
  /** Server warnings for a partial success. */
  readonly warnings: readonly string[]
}

/** Rename form state. */
export interface DocRenameState {
  /** True while the rename request runs. */
  readonly pending: boolean
  /** Stable failure code from the last attempt. */
  readonly errorCode?: string
}

/** One breadcrumb entry above the folder listing. */
export interface FolderCrumb {
  /** Folder token. */
  readonly token: string
  /** Folder name. */
  readonly name: string
}

/** The create dialog. */
export interface DocComposerState {
  /** Whether the dialog shows. */
  readonly open: boolean
  /** True while the create request runs. */
  readonly pending: boolean
  /** Stable failure code from the last attempt. */
  readonly errorCode?: string
  /** Folder or wiki node the new document lands in, when browsing one. */
  readonly parentToken?: string
}

/** Snapshot the panel renders; the store replaces it wholesale on each transition. */
export interface DocsViewState {
  /** Loading, shown, empty, or unavailable. */
  phase: DocsPhase
  /** Recent, search, or folder listing. */
  view: DocView
  /** Recent window. */
  days: DocDays
  /** Recent ordering. */
  sort: DocSort
  /** Folder ordering. */
  orderBy: FileOrder
  /** Submitted search text. */
  query: string
  /** Search restricted to owned documents. */
  mine: boolean
  /** List rows. */
  items: readonly DocItem[]
  /** True when the service reported another page. */
  hasMore: boolean
  /** Cursor for the next page. */
  pageToken?: string
  /** True while a next page loads. */
  loadingMore: boolean
  /** Folders above the current listing, outermost first. */
  crumbs: readonly FolderCrumb[]
  /** Signed-in user's display name. */
  userName?: string
  /** Scopes the token lacks. */
  missingScopes: readonly string[]
  /** Stable failure code from the last list read. */
  errorCode?: string
  /** The open document drawer. */
  selection?: DocSelectionState
  /** The open create dialog. */
  composer?: DocComposerState
}

/** Panel interactions components call. */
export interface DocsActions {
  /** Re-read the current view, bypassing the Host cache. */
  readonly refresh: () => void
  /** Switch between recent, search, and folder listings. */
  readonly setView: (view: DocView) => void
  /** Change the recent window. */
  readonly setDays: (days: DocDays) => void
  /** Change the recent ordering. */
  readonly setSort: (sort: DocSort) => void
  /** Change the folder ordering. */
  readonly setOrderBy: (orderBy: FileOrder) => void
  /** Restrict search to owned documents. */
  readonly setMine: (mine: boolean) => void
  /** Submit a search keyword. */
  readonly search: (query: string) => void
  /** Append the next page of list rows. */
  readonly loadMore: () => void
  /** Enter one folder. */
  readonly openFolder: (token: string, name: string) => void
  /** Return to the parent folder. */
  readonly goBack: () => void
  /** Return to the cloud-space root. */
  readonly goRoot: () => void
  /** Open one listed document or folder. */
  readonly openDoc: (item: DocItem) => void
  /** Close the document drawer. */
  readonly closeDoc: () => void
  /** Retry the drawer's outline read. */
  readonly retryDetail: () => void
  /** Read and show the full body. */
  readonly viewFull: () => void
  /** Collapse the full body. */
  readonly hideFull: () => void
  /** Open the block editor and read the block list. */
  readonly startEdit: () => void
  /** Leave the block editor. */
  readonly closeEdit: () => void
  /** Start editing one block. */
  readonly editBlock: (blockId: string) => void
  /** Start composing an appended paragraph. */
  readonly startAppend: () => void
  /** Replace the current draft text. */
  readonly updateDraft: (text: string) => void
  /** Discard the current draft. */
  readonly cancelDraft: () => void
  /** Save the current draft. */
  readonly saveDraft: () => void
  /** Delete one block. */
  readonly deleteBlock: (blockId: string) => void
  /** Rename the open document; resolves true when the title landed. */
  readonly rename: (title: string) => Promise<boolean>
  /** Open the create dialog. */
  readonly openCreate: () => void
  /** Close the create dialog. */
  readonly closeCreate: () => void
  /** Submit one new document. */
  readonly submitCreate: (input: CreateDocInput) => void
}

/** A route answer that reported a stable failure code. */
export class DocsClientError extends Error {
  /**
   * @param code - stable code the Host sent.
   * @param message - Host diagnostic, kept for logs only.
   */
  constructor(readonly code: string, message: string) {
    super(message)
    this.name = 'DocsClientError'
  }
}

/** Longest Markdown body one draft accepts. */
const CONTENT_LIMIT = 20_000

/** Longest title one draft accepts. */
const TITLE_LIMIT = 200

/** Loads the current view, the open document, and the block editor. */
export class DocsController {
  /** Snapshot store the renderer binds as `useDocs`. */
  readonly store: SnapshotStore<DocsViewState>

  /** Components' actions. */
  readonly actions: DocsActions

  /** Route fetcher; tests replace it. */
  private readonly fetcher: typeof fetch

  /** List read in flight, cancelled when the view changes. */
  private abort: AbortController | undefined

  /** Drawer read in flight, cancelled when the drawer closes. */
  private detailAbort: AbortController | undefined

  /**
   * @param fetcher - same-origin fetch used for the relative routes.
   */
  constructor(fetcher: typeof fetch = (input, init) => fetch(input, init)) {
    this.fetcher = fetcher
    this.store = createSnapshotStore<DocsViewState>({
      phase: 'loading',
      view: 'recent',
      days: 30,
      sort: 'open',
      orderBy: 'EditedTime',
      query: '',
      mine: false,
      items: [],
      hasMore: false,
      loadingMore: false,
      crumbs: [],
      missingScopes: [],
    })
    this.actions = {
      refresh: () => {
        if (this.locked()) return
        this.load(true)
      },
      setView: (view) => { this.select({ view }) },
      setDays: (days) => { this.select({ days }) },
      setSort: (sort) => { this.select({ sort }) },
      setOrderBy: (orderBy) => { this.select({ orderBy }) },
      setMine: (mine) => {
        if (this.locked()) return
        this.store.set({ ...this.current(), mine })
        if (this.current().query !== '') this.load()
      },
      search: (query) => { this.search(query) },
      loadMore: () => { void this.readMore() },
      openFolder: (token, name) => { this.openFolder(token, name) },
      goBack: () => { this.goBack() },
      goRoot: () => { this.goRoot() },
      openDoc: (item) => { this.openDoc(item) },
      closeDoc: () => { this.closeDoc() },
      retryDetail: () => { this.retryDetail() },
      viewFull: () => { this.viewFull() },
      hideFull: () => { this.hideFull() },
      startEdit: () => { this.startEdit() },
      closeEdit: () => { this.closeEdit() },
      editBlock: (blockId) => { this.editBlock(blockId) },
      startAppend: () => { this.startAppend() },
      updateDraft: (text) => { this.updateDraft(text) },
      cancelDraft: () => { this.cancelDraft() },
      saveDraft: () => { void this.saveDraft() },
      deleteBlock: (blockId) => { void this.deleteBlock(blockId) },
      rename: title => this.rename(title),
      openCreate: () => { this.openCreate() },
      closeCreate: () => { this.closeCreate() },
      submitCreate: (input) => { void this.submitCreate(input) },
    }
  }

  /**
   * Start reading the current view.
   * @param refresh - bypass the Host cache for this view.
   */
  load(refresh = false): void {
    void this.readList(refresh)
  }

  /** Cancel reads in flight; the panel is going away. */
  dispose(): void {
    this.abort?.abort()
    this.detailAbort?.abort()
  }

  /** The current snapshot. */
  private current(): DocsViewState {
    return this.store.getSnapshot()
  }

  /** True while the block editor freezes refresh and view changes. */
  private locked(): boolean {
    return this.current().selection?.editing === true
  }

  /**
   * Replace one view dimension and re-read the list.
   * @param patch - dimensions that changed.
   */
  private select(patch: Partial<DocsViewState>): void {
    if (this.locked()) return
    const { pageToken: _page, ...rest } = this.current()
    this.store.set({ ...rest, ...patch, items: [], hasMore: false, loadingMore: false })
    this.load()
  }

  /**
   * Submit one search keyword.
   * @param query - keyword the user typed.
   */
  private search(query: string): void {
    if (this.locked()) return
    const keyword = query.trim()
    if (queryLength(keyword) > 30) {
      const { pageToken: _page, ...rest } = this.current()
      this.store.set({
        ...rest,
        view: 'search',
        query: keyword,
        items: [],
        hasMore: false,
        loadingMore: false,
        phase: 'empty',
      })
      return
    }
    this.select({ view: 'search', query: keyword })
  }

  /**
   * Enter one folder.
   * @param token - folder token.
   * @param name - folder name for the breadcrumb.
   */
  private openFolder(token: string, name: string): void {
    if (this.locked()) return
    const { pageToken: _page, ...rest } = this.current()
    this.store.set({
      ...rest,
      view: 'files',
      items: [],
      hasMore: false,
      loadingMore: false,
      crumbs: [...this.current().crumbs, { token, name }],
    })
    this.load()
  }

  /** Return to the parent folder. */
  private goBack(): void {
    if (this.locked()) return
    const crumbs = this.current().crumbs.slice(0, -1)
    const { pageToken: _page, ...rest } = this.current()
    this.store.set({ ...rest, view: 'files', items: [], hasMore: false, loadingMore: false, crumbs })
    this.load()
  }

  /** Return to the cloud-space root. */
  private goRoot(): void {
    if (this.locked()) return
    const { pageToken: _page, ...rest } = this.current()
    this.store.set({ ...rest, view: 'files', items: [], hasMore: false, loadingMore: false, crumbs: [] })
    this.load()
  }

  /**
   * Read status, then the current view's first page.
   * @param refresh - bypass the Host cache for this view.
   */
  private async readList(refresh: boolean): Promise<void> {
    this.abort?.abort()
    const abort = new AbortController()
    this.abort = abort
    const { signal } = abort
    const state = this.current()
    this.store.set({ ...state, phase: 'loading' })
    try {
      const status = await this.request<DocsStatus>(STATUS_ROUTE, signal)
      if (signal.aborted) return
      const base: DocsViewState = {
        ...this.current(),
        missingScopes: status.missingScopes,
        ...(status.userName === undefined ? {} : { userName: status.userName }),
      }
      if (!status.connected) {
        this.store.set({
          ...base,
          phase: status.missingScopes.length > 0 ? 'permission' : 'disconnected',
          errorCode: status.missingScopes.length > 0 ? 'permission-denied' : 'not-connected',
        })
        return
      }
      if (status.missingScopes.length > 0) {
        this.store.set({ ...base, phase: 'permission', errorCode: 'permission-denied' })
        return
      }
      if (state.view === 'search' && state.query === '') {
        this.store.set({ ...base, phase: 'empty', items: [], hasMore: false })
        return
      }
      const data = await this.fetchList(state, undefined, refresh, signal)
      if (signal.aborted) return
      const { pageToken: _page, ...rest } = base
      this.store.set({
        ...rest,
        phase: data.items.length === 0 ? 'empty' : 'ready',
        items: data.items,
        // Search has no page cursor in this panel's contract, so it never offers a next page.
        hasMore: state.view === 'search' ? false : data.hasMore,
        ...(state.view === 'search' || data.pageToken === undefined ? {} : { pageToken: data.pageToken }),
      })
    } catch (error: unknown) {
      if (signal.aborted) return
      const code = codeOf(error)
      this.store.set({ ...this.current(), phase: phaseOf(code), errorCode: code })
    }
  }

  /**
   * Read the next page and append it.
   */
  private async readMore(): Promise<void> {
    if (this.locked()) return
    const state = this.current()
    if (state.loadingMore || !state.hasMore || state.pageToken === undefined) return
    this.abort?.abort()
    const abort = new AbortController()
    this.abort = abort
    const { signal } = abort
    this.store.set({ ...state, loadingMore: true })
    try {
      const data = await this.fetchList(state, state.pageToken, false, signal)
      if (signal.aborted) return
      const { pageToken: _page, ...rest } = this.current()
      this.store.set({
        ...rest,
        items: [...this.current().items, ...data.items],
        hasMore: data.hasMore,
        loadingMore: false,
        ...(data.pageToken === undefined ? {} : { pageToken: data.pageToken }),
      })
    } catch (error: unknown) {
      if (signal.aborted) return
      this.store.set({ ...this.current(), loadingMore: false, errorCode: codeOf(error) })
    }
  }

  /**
   * Read one list page for a view state.
   * @param state - dimensions to read with.
   * @param pageToken - cursor for a later page.
   * @param refresh - bypass the Host cache.
   * @param signal - read cancellation.
   * @returns the page.
   */
  private async fetchList(
    state: DocsViewState,
    pageToken: string | undefined,
    refresh: boolean,
    signal: AbortSignal,
  ): Promise<DocListData> {
    const params = new URLSearchParams()
    let route: string
    switch (state.view) {
      case 'recent':
        route = RECENT_ROUTE
        params.set('days', String(state.days))
        params.set('sort', state.sort)
        break
      case 'search':
        route = SEARCH_ROUTE
        params.set('query', state.query)
        if (state.mine) params.set('mine', '1')
        break
      case 'files':
        route = FILES_ROUTE
        params.set('orderBy', state.orderBy)
        {
          const folder = state.crumbs[state.crumbs.length - 1]
          if (folder !== undefined) params.set('folderToken', folder.token)
        }
        break
      default:
        return assertNever(state.view)
    }
    if (pageToken !== undefined) params.set('pageToken', pageToken)
    if (refresh) params.set('refresh', '1')
    return this.request<DocListData>(`${route}?${params.toString()}`, signal)
  }

  /**
   * Open one document's drawer, or enter the folder the row names.
   * @param item - the activated row.
   */
  private openDoc(item: DocItem): void {
    if (item.isFolder) {
      this.openFolder(item.token, titleText(item.title))
      return
    }
    this.detailAbort?.abort()
    const abort = new AbortController()
    this.detailAbort = abort
    const selection: DocSelectionState = { item, phase: 'loading', editing: false }
    this.store.set({ ...this.current(), selection })
    void this.readDocument(selection.item, 'outline', false, abort.signal)
  }

  /** Close the drawer. */
  private closeDoc(): void {
    this.detailAbort?.abort()
    const { selection: _selection, ...rest } = this.current()
    this.store.set(rest)
  }

  /** Re-read the drawer's outline. */
  private retryDetail(): void {
    const selection = this.current().selection
    if (selection === undefined) return
    this.store.set({
      ...this.current(),
      selection: { ...selection, phase: 'loading' },
    })
    const abort = new AbortController()
    this.detailAbort = abort
    void this.readDocument(selection.item, 'outline', true, abort.signal)
  }

  /** Read and show the full body. */
  private viewFull(): void {
    const selection = this.current().selection
    if (selection === undefined || selection.fullPhase === 'loading') return
    const abort = new AbortController()
    this.detailAbort = abort
    this.store.set({ ...this.current(), selection: { ...selection, fullPhase: 'loading' } })
    void this.readDocument(selection.item, 'full', false, abort.signal)
  }

  /** Collapse the full body. */
  private hideFull(): void {
    const selection = this.current().selection
    if (selection === undefined) return
    const { full: _full, truncated: _truncated, fullPhase: _phase, ...rest } = selection
    this.store.set({ ...this.current(), selection: rest })
  }

  /**
   * Read one document scope into the drawer.
   * @param item - document the drawer addresses.
   * @param scope - outline, full, or blocks.
   * @param refresh - bypass the Host cache.
   * @param signal - read cancellation.
   */
  private async readDocument(
    item: DocItem,
    scope: 'outline' | 'full' | 'blocks',
    refresh: boolean,
    signal: AbortSignal,
  ): Promise<void> {
    const params = new URLSearchParams({ token: item.url ?? item.token, mode: scope })
    if (refresh) params.set('refresh', '1')
    try {
      const body = await this.request<DocBodyData>(`${DOCUMENT_ROUTE}?${params.toString()}`, signal)
      if (signal.aborted) return
      this.mergeDocument(item.token, body)
    } catch (error: unknown) {
      if (signal.aborted) return
      const selection = this.current().selection
      if (selection === undefined || selection.item.token !== item.token) return
      const code = codeOf(error)
      this.store.set({
        ...this.current(),
        selection: {
          ...selection,
          ...(scope === 'outline'
            ? { phase: 'error' as const }
            : scope === 'full'
              ? { fullPhase: 'error' as const }
              : { blocksPhase: 'error' as const }),
          errorCode: code,
        },
      })
    }
  }

  /**
   * Fold one document read into the open drawer.
   * @param token - document the read addressed.
   * @param body - the answer.
   */
  private mergeDocument(token: string, body: DocBodyData): void {
    const current = this.current()
    const selection = current.selection
    if (selection === undefined || selection.item.token !== token) return
    if (body.mode === 'blocks') {
      const blocks: DocBlocksData = body
      this.store.set({
        ...current,
        selection: {
          ...selection,
          blocks: blocks.blocks,
          blocksPhase: 'ready',
          revisionId: blocks.revisionId,
        },
      })
      return
    }
    const document: DocDocumentData = body
    this.store.set({
      ...current,
      selection: body.mode === 'full'
        ? {
          ...selection,
          full: document.content,
          truncated: document.truncated,
          fullPhase: 'ready',
          revisionId: document.revisionId,
        }
        : {
          ...selection,
          outline: document.content,
          phase: 'ready',
          revisionId: document.revisionId,
        },
    })
  }

  /** Open the block editor and read the block list. */
  private startEdit(): void {
    const current = this.current()
    const selection = current.selection
    if (selection === undefined || !editableItem(selection.item)) return
    this.store.set({
      ...current,
      selection: { ...selection, editing: true, blocksPhase: 'loading' },
    })
    const abort = new AbortController()
    this.detailAbort = abort
    void this.readDocument(selection.item, 'blocks', true, abort.signal)
  }

  /** Leave the block editor. */
  private closeEdit(): void {
    const current = this.current()
    const selection = current.selection
    if (selection === undefined) return
    const { editor: _editor, ...rest } = selection
    this.store.set({ ...current, selection: { ...rest, editing: false } })
  }

  /**
   * Start editing one block.
   * @param blockId - block the user chose.
   */
  private editBlock(blockId: string): void {
    const current = this.current()
    const selection = current.selection
    const block = selection?.blocks?.find(candidate => candidate.blockId === blockId)
    if (selection === undefined || block === undefined || !block.editable) return
    this.store.set({
      ...current,
      selection: {
        ...selection,
        editor: {
          mode: 'block',
          blockId: block.blockId,
          tag: block.tag,
          text: block.text,
          saving: false,
        },
      },
    })
  }

  /** Start composing an appended paragraph. */
  private startAppend(): void {
    const current = this.current()
    const selection = current.selection
    if (selection === undefined) return
    this.store.set({
      ...current,
      selection: {
        ...selection,
        editor: { mode: 'append', text: '', saving: false },
      },
    })
  }

  /**
   * Replace the current draft text.
   * @param text - new draft.
   */
  private updateDraft(text: string): void {
    const current = this.current()
    const selection = current.selection
    const editor = selection?.editor
    if (selection === undefined || editor === undefined) return
    this.store.set({
      ...current,
      selection: { ...selection, editor: { ...editor, text } },
    })
  }

  /** Discard the current draft. */
  private cancelDraft(): void {
    const current = this.current()
    const selection = current.selection
    if (selection === undefined || selection.editor === undefined) return
    const { editor: _editor, ...rest } = selection
    this.store.set({ ...current, selection: rest })
  }

  /** Save the current draft as an append or a block rewrite. */
  private async saveDraft(): Promise<void> {
    const current = this.current()
    const selection = current.selection
    const editor = selection?.editor
    if (selection === undefined || editor === undefined || editor.saving) return
    if (Array.from(editor.text).length > CONTENT_LIMIT) {
      this.setEditorError(selection.item.token, 'invalid-input')
      return
    }
    const revisionId = selection.revisionId
    if (revisionId === undefined) {
      this.setEditorError(selection.item.token, 'upstream')
      return
    }
    const token = selection.item.url ?? selection.item.token
    if (editor.mode !== 'append' && (editor.blockId === undefined || editor.tag === undefined)) {
      this.setEditorError(selection.item.token, 'invalid-input')
      return
    }
    const input: DocMutationInput = editor.mode === 'append'
      ? { action: 'append', token, revisionId, content: editor.text }
      : {
        action: 'replace-block',
        token,
        revisionId,
        blockId: editor.blockId ?? '',
        tag: editor.tag ?? '',
        content: editor.text,
      }
    this.setEditorSaving(selection.item.token, true)
    try {
      const result = await this.post<DocMutationResult>(DOCUMENT_ROUTE, input)
      this.completeWrite(selection.item.token, result)
      await this.refreshAfterWrite(selection.item.token)
    } catch (error: unknown) {
      this.failWrite(selection.item.token, codeOf(error))
    }
  }

  /**
   * Delete one block.
   * @param blockId - block the user confirmed.
   */
  private async deleteBlock(blockId: string): Promise<void> {
    const current = this.current()
    const selection = current.selection
    if (selection === undefined) return
    const revisionId = selection.revisionId
    if (revisionId === undefined) {
      this.store.set({ ...current, selection: { ...selection, errorCode: 'upstream' } })
      return
    }
    try {
      const result = await this.post<DocMutationResult>(DOCUMENT_ROUTE, {
        action: 'delete-block',
        token: selection.item.url ?? selection.item.token,
        revisionId,
        blockId,
      })
      this.completeWrite(selection.item.token, result)
      await this.refreshAfterWrite(selection.item.token)
    } catch (error: unknown) {
      this.failWrite(selection.item.token, codeOf(error))
    }
  }

  /**
   * Rename the open document.
   * @param title - new title.
   */
  private async rename(title: string): Promise<boolean> {
    const current = this.current()
    const selection = current.selection
    if (selection === undefined || selection.renameState?.pending === true) return false
    const trimmed = title.trim()
    if (trimmed === '' || Array.from(trimmed).length > TITLE_LIMIT) {
      this.store.set({
        ...current,
        selection: { ...selection, renameState: { pending: false, errorCode: 'invalid-input' } },
      })
      return false
    }
    this.store.set({
      ...current,
      selection: { ...selection, renameState: { pending: true } },
    })
    try {
      const result = await this.post<DocMutationResult>(DOCUMENT_ROUTE, {
        action: 'rename',
        token: selection.item.url ?? selection.item.token,
        title: trimmed,
      })
      const latest = this.current()
      const open = latest.selection
      if (open === undefined || open.item.token !== selection.item.token) return false
      const renamed: DocItem = {
        ...open.item,
        title: [{ text: result.title ?? trimmed, highlighted: false }],
      }
      const { renameState: _renamed, ...rest } = open
      this.store.set({
        ...latest,
        items: latest.items.map(item => (item.token === renamed.token ? renamed : item)),
        selection: { ...rest, item: renamed },
      })
      return true
    } catch (error: unknown) {
      const latest = this.current()
      const open = latest.selection
      if (open === undefined || open.item.token !== selection.item.token) return false
      const code = codeOf(error)
      this.store.set({
        ...latest,
        selection: {
          ...open,
          renameState: { pending: false, errorCode: code },
          ...(code === 'conflict' ? { banner: { kind: 'conflict' as const, warnings: [] } } : {}),
        },
      })
      return false
    }
  }

  /** Open the create dialog. */
  private openCreate(): void {
    const current = this.current()
    const folder = current.crumbs[current.crumbs.length - 1]
    this.store.set({
      ...current,
      composer: {
        open: true,
        pending: false,
        ...(folder === undefined ? {} : { parentToken: folder.token }),
      },
    })
  }

  /** Close the create dialog. */
  private closeCreate(): void {
    const current = this.current()
    if (current.composer?.pending === true) return
    const { composer: _composer, ...rest } = current
    this.store.set(rest)
  }

  /**
   * Create one document and open it.
   * @param input - title, optional Markdown, and optional parent.
   */
  private async submitCreate(input: CreateDocInput): Promise<void> {
    const current = this.current()
    const composer = current.composer
    if (composer === undefined || composer.pending) return
    const title = input.title.trim()
    const content = input.content ?? ''
    if (
      title === ''
      || Array.from(title).length > TITLE_LIMIT
      || Array.from(content).length > CONTENT_LIMIT
    ) {
      this.store.set({
        ...current,
        composer: { ...composer, errorCode: 'invalid-input' },
      })
      return
    }
    this.store.set({ ...current, composer: { ...composer, pending: true } })
    try {
      const result = await this.post<DocCreateResult>(DOCUMENTS_ROUTE, {
        title,
        ...(content === '' ? {} : { content }),
        ...(composer.parentToken === undefined ? {} : { parentToken: composer.parentToken }),
      })
      const created: DocItem = {
        token: result.documentId,
        title: [{ text: title, highlighted: false }],
        type: 'docx',
        entityType: 'DOC',
        isFolder: false,
        ...(result.url === undefined ? {} : { url: result.url }),
      }
      const latest = this.current()
      const { composer: _composer, ...rest } = latest
      this.store.set(rest)
      this.openDoc(created)
      this.load()
    } catch (error: unknown) {
      const latest = this.current()
      const open = latest.composer
      if (open === undefined) return
      this.store.set({
        ...latest,
        composer: { ...open, pending: false, errorCode: codeOf(error) },
      })
    }
  }

  /**
   * Mark the open draft as saving.
   * @param token - document the drawer addresses.
   * @param saving - whether the request runs.
   */
  private setEditorSaving(token: string, saving: boolean): void {
    const current = this.current()
    const selection = current.selection
    if (selection === undefined || selection.item.token !== token || selection.editor === undefined) return
    this.store.set({
      ...current,
      selection: {
        ...selection,
        editor: { ...selection.editor, saving },
      },
    })
  }

  /**
   * Record one draft failure.
   * @param token - document the drawer addresses.
   * @param code - stable failure code.
   */
  private setEditorError(token: string, code: string): void {
    const current = this.current()
    const selection = current.selection
    if (selection === undefined || selection.item.token !== token || selection.editor === undefined) return
    this.store.set({
      ...current,
      selection: { ...selection, editor: { ...selection.editor, saving: false, errorCode: code } },
    })
  }

  /**
   * Apply one successful write's answer.
   * @param token - document the drawer addresses.
   * @param result - the write's answer.
   */
  private completeWrite(token: string, result: DocMutationResult): void {
    const current = this.current()
    const selection = current.selection
    if (selection === undefined || selection.item.token !== token) return
    const { editor: _editor, errorCode: _errorCode, banner: _banner, ...rest } = selection
    const partial = result.result === 'partial_success' || result.warnings.length > 0
    this.store.set({
      ...current,
      selection: {
        ...rest,
        ...(result.revisionId === undefined ? {} : { revisionId: result.revisionId }),
        ...(partial ? { banner: { kind: 'partial' as const, warnings: result.warnings } } : {}),
      },
    })
  }

  /**
   * Record one failed write, keeping the draft on a conflict.
   * @param token - document the drawer addresses.
   * @param code - stable failure code.
   */
  private failWrite(token: string, code: string): void {
    const current = this.current()
    const selection = current.selection
    if (selection === undefined || selection.item.token !== token) return
    if (code === 'conflict') {
      const withBanner: DocSelectionState = {
        ...selection,
        banner: { kind: 'conflict', warnings: [] },
        ...(selection.editor === undefined
          ? {}
          : { editor: { ...selection.editor, saving: false, errorCode: code } }),
      }
      this.store.set({
        ...current,
        selection: withBanner,
      })
      void this.refreshAfterWrite(token)
      return
    }
    const withError: DocSelectionState = {
      ...selection,
      errorCode: code,
      ...(selection.editor === undefined
        ? {}
        : { editor: { ...selection.editor, saving: false, errorCode: code } }),
    }
    this.store.set({
      ...current,
      selection: withError,
    })
  }

  /**
   * Re-read the block list and the visible body after a write.
   * @param token - document the drawer addresses.
   */
  private async refreshAfterWrite(token: string): Promise<void> {
    const selection = this.current().selection
    if (selection === undefined || selection.item.token !== token) return
    const abort = new AbortController()
    this.detailAbort = abort
    await this.readDocument(selection.item, 'blocks', true, abort.signal)
    if (abort.signal.aborted) return
    const latest = this.current().selection
    if (latest === undefined || latest.item.token !== token) return
    await this.readDocument(latest.item, latest.full === undefined ? 'outline' : 'full', true, abort.signal)
  }

  /**
   * Read one route.
   * @param route - browser-relative route, including its query string.
   * @param signal - read cancellation.
   * @returns the successful payload.
   * @throws DocsClientError for a failure envelope or an unreadable answer.
   */
  private async request<T>(route: string, signal: AbortSignal | undefined): Promise<T> {
    const response = await this.fetcher(route, {
      ...(signal === undefined ? {} : { signal }),
      headers: { accept: 'application/json' },
    })
    return answerOf<T>(response)
  }

  /**
   * Post one JSON body to a route.
   * @param route - browser-relative route.
   * @param body - JSON body.
   * @returns the successful payload.
   * @throws DocsClientError for a failure envelope or an unreadable answer.
   */
  private async post<T>(route: string, body: unknown): Promise<T> {
    const response = await this.fetcher(route, {
      method: 'POST',
      headers: { accept: 'application/json', 'content-type': 'application/json' },
      body: JSON.stringify(body),
    })
    return answerOf<T>(response)
  }
}

/**
 * Read one route answer's envelope.
 * @param response - route response.
 * @returns the successful payload.
 * @throws DocsClientError for a failure envelope or an unreadable answer.
 */
async function answerOf<T>(response: Response): Promise<T> {
  const body: unknown = await response.json()
  if (!isResponse(body)) throw new DocsClientError('upstream', 'feishu-docs route answered malformed JSON')
  if (body.ok === false) throw new DocsClientError(body.error.code, body.error.message)
  return body.data as T
}

/**
 * Read the stable code off a thrown value.
 * @param error - value caught from a route call.
 * @returns the code, or `upstream` for anything unclassified.
 */
function codeOf(error: unknown): string {
  return error instanceof DocsClientError ? error.code : 'upstream'
}

/**
 * Map one stable code onto the panel phase.
 * @param code - stable failure code.
 * @returns the phase to show.
 */
function phaseOf(code: string): DocsPhase {
  if (code === 'cli-missing') return 'no-cli'
  if (code === 'not-connected' || code === 'not-configured') return 'disconnected'
  if (code === 'permission-denied') return 'permission'
  return 'error'
}

/**
 * Test one route answer's envelope.
 * @param value - parsed JSON.
 * @returns true when the value carries an `ok` discriminant.
 */
function isResponse(value: unknown): value is DocsResponse<unknown> {
  if (typeof value !== 'object' || value === null || !('ok' in value)) return false
  const ok = (value as { ok: unknown }).ok
  return ok === true || ok === false
}

/**
 * Prove a closed union is exhausted.
 * @param value - impossible value.
 * @returns never; it throws for a value outside the union.
 */
function assertNever(value: never): never {
  throw new Error(`dsh-feishu-docs: unhandled view ${String(value)}`)
}
