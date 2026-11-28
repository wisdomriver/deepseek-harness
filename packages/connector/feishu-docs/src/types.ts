/**
 * Wire types shared by the Feishu docs Host routes and the browser panel.
 * @module @deepseek-ai/dsh-feishu-docs/types
 */

/** Time window the recent view asks for. */
export type DocDays = 7 | 30 | 90

/** Recent-view ordering: by last open or by last edit. */
export type DocSort = 'open' | 'edit'

/** Panel view the list shows. */
export type DocView = 'recent' | 'search' | 'files'

/** One run of title or summary text, marked when a search matched it. */
export interface HighlightSegment {
  /** Display text with entities decoded; never markup. */
  readonly text: string
  /** True when the search matched this run. */
  readonly highlighted: boolean
}

/** One normalized document, folder, or drive file the panel lists. */
export interface DocItem {
  /** Token the drive uses for this object; a wiki node keeps its node token. */
  readonly token: string
  /** Title as decoded segments, so the browser never parses HTML. */
  readonly title: readonly HighlightSegment[]
  /** Normalized type: `docx`, `wiki`, `sheet`, `base`, `slides`, `mindnote`, `file`, `folder`, or a lowercase original. */
  readonly type: string
  /** Feishu entity type, e.g. `DOC` or `WIKI`; empty when the list did not report one. */
  readonly entityType: string
  /** True when opening the row navigates into a folder instead of a document. */
  readonly isFolder: boolean
  /** Canonical Feishu URL; wiki nodes are always read through it. */
  readonly url?: string
  /** Owner display name as the CLI already resolved it. */
  readonly ownerName?: string
  /** Last editor display name. */
  readonly editorName?: string
  /** ISO 8601 instant of the last open. */
  readonly lastOpenedAt?: string
  /** ISO 8601 instant of the last update. */
  readonly updatedAt?: string
  /** Icon key from `icon_info`, used only as a type-icon fallback. */
  readonly iconKey?: string
  /** Search summary segments; absent outside search results. */
  readonly summary?: readonly HighlightSegment[]
}

/** CLI, account, and authorization facts the panel needs to choose between its states. */
export interface DocsStatus {
  /** True when the `lark-cli` executable resolved. */
  readonly cli: boolean
  /** True when the CLI has an application configured. */
  readonly configured: boolean
  /** True when a user identity is signed in and usable. */
  readonly connected: boolean
  /** Signed-in user's display name. */
  readonly userName?: string
  /** Document scopes the deployment asks for and the token lacks. */
  readonly missingScopes: readonly string[]
}

/** One page of list rows. */
export interface DocListData {
  /** Normalized rows. */
  readonly items: readonly DocItem[]
  /** True when the CLI reported another page. */
  readonly hasMore: boolean
  /** Cursor for the next page, when `hasMore` is true. */
  readonly pageToken?: string
  /** Total matches the service reported; search only. */
  readonly total?: number
  /** ISO instant the Host read the list. */
  readonly fetchedAt: string
}

/** One editable text block parsed out of the document XML. */
export interface DocBlock {
  /** Feishu block id, valid only for the revision it was read from. */
  readonly blockId: string
  /** Block tag, e.g. `h2`, `p`, `li`, `code`, `quote`, or a resource tag. */
  readonly tag: string
  /** Plain text with entities decoded; empty for resource blocks. */
  readonly text: string
  /** True only for whitelisted text tags that hold no Feishu resource. */
  readonly editable: boolean
}

/** Markdown body of one document, already bounded for the browser. */
export interface DocDocumentData {
  /** Which read produced the body. */
  readonly mode: 'outline' | 'full'
  /** Document the body belongs to, as addressed by the panel. */
  readonly token: string
  /** Markdown text. */
  readonly content: string
  /** True when the Host cut the full body at its character bound. */
  readonly truncated: boolean
  /** Revision the body was read from; the base for later writes. */
  readonly revisionId: number
}

/** Block list of one document, the editing surface. */
export interface DocBlocksData {
  /** Discriminant for the block list. */
  readonly mode: 'blocks'
  /** Document the blocks belong to. */
  readonly token: string
  /** Document title parsed from the XML, when present. */
  readonly title?: string
  /** Revision the blocks were read from; the base for later writes. */
  readonly revisionId: number
  /** Blocks in document order. */
  readonly blocks: readonly DocBlock[]
}

/** Any document read the panel performs. */
export type DocBodyData = DocDocumentData | DocBlocksData

/** One block-level write the panel asks for. */
export type DocMutationAction = 'append' | 'replace-block' | 'delete-block' | 'rename'

/** Body one document mutation carries. */
export interface DocMutationInput {
  /** Which write to run. */
  readonly action: DocMutationAction
  /** Document token or URL the CLI accepts. */
  readonly token: string
  /** Base revision the write declares; required by the block writes. */
  readonly revisionId?: number
  /** New Markdown for `append`, or plain text for `replace-block`. */
  readonly content?: string
  /** Target block for `replace-block` and `delete-block`. */
  readonly blockId?: string
  /** Block tag for `replace-block`; must be editable. */
  readonly tag?: string
  /** New title for `rename`. */
  readonly title?: string
}

/** One write's answer. */
export interface DocMutationResult {
  /** Document the write addressed. */
  readonly token: string
  /** Revision after the write, when the CLI returned one. */
  readonly revisionId?: number
  /** CLI result marker; `partial_success` still means the write landed. */
  readonly result?: string
  /** Blocks the CLI reports as updated. */
  readonly updatedBlocks?: number
  /** Server warnings; an empty list means a clean write. */
  readonly warnings: readonly string[]
  /** New title after a rename. */
  readonly title?: string
}

/** Body the panel posts to create one document. */
export interface CreateDocInput {
  /** Non-empty title, at most 200 characters. */
  readonly title: string
  /** Initial Markdown body, at most 20000 characters. */
  readonly content?: string
  /** Parent folder or wiki node token; defaults to the user's cloud space. */
  readonly parentToken?: string
}

/** One created document. */
export interface DocCreateResult {
  /** New document id or token. */
  readonly documentId: string
  /** Canonical Feishu URL, when the CLI returned one. */
  readonly url?: string
  /** True while an asynchronous create is still pending. */
  readonly pending?: boolean
}

/** Successful payload of every route. */
export interface DocsSuccess<T> {
  /** Discriminant. */
  readonly ok: true
  /** Route payload. */
  readonly data: T
}

/** Failure payload of every route; `code` is stable, `message` is for humans. */
export interface DocsFailure {
  /** Discriminant. */
  readonly ok: false
  /** Stable failure. */
  readonly error: {
    /** Machine-routable code. */
    readonly code: string
    /** Localized copy is the browser's job; this stays a diagnostic. */
    readonly message: string
    /** Id shared with the Host log line. */
    readonly requestId: string
  }
}

/** One route answer. */
export type DocsResponse<T> = DocsSuccess<T> | DocsFailure
