/**
 * Route paths the panel calls and the Host serves below Connection's `/api` prefix.
 * @module @deepseek-ai/dsh-feishu-docs/paths
 */

/** CLI, account, and authorization facts, read on panel open. */
export const STATUS_PATH = '/api/feishu-docs/status'

/** Recently opened documents; `days` and `sort` are the only query parameters. */
export const RECENT_PATH = '/api/feishu-docs/recent'

/** Keyword search; `query`, `types`, and `mine` are the query parameters. */
export const SEARCH_PATH = '/api/feishu-docs/search'

/** Cloud-space folder listing; `folderToken`, `orderBy`, and `pageToken` are the query parameters. */
export const FILES_PATH = '/api/feishu-docs/files'

/** One document read (GET) or one block-level write (POST). */
export const DOCUMENT_PATH = '/api/feishu-docs/document'

/** Document creation. */
export const DOCUMENTS_PATH = '/api/feishu-docs/documents'

/** Browser-relative form of {@link STATUS_PATH}. */
export const STATUS_ROUTE = STATUS_PATH.slice(1)

/** Browser-relative form of {@link RECENT_PATH}. */
export const RECENT_ROUTE = RECENT_PATH.slice(1)

/** Browser-relative form of {@link SEARCH_PATH}. */
export const SEARCH_ROUTE = SEARCH_PATH.slice(1)

/** Browser-relative form of {@link FILES_PATH}. */
export const FILES_ROUTE = FILES_PATH.slice(1)

/** Browser-relative form of {@link DOCUMENT_PATH}. */
export const DOCUMENT_ROUTE = DOCUMENT_PATH.slice(1)

/** Browser-relative form of {@link DOCUMENTS_PATH}. */
export const DOCUMENTS_ROUTE = DOCUMENTS_PATH.slice(1)
