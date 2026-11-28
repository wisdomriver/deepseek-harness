---
description: "The Feishu docs panel: a sidebar entry opening recent documents, search, drive folders, a read-only preview, and block-level edits through the Feishu plugin's lark-cli."
kind: "package-reference"
---

# @deepseek-ai/dsh-feishu-docs

English | [中文](README.zh.md)

## Summary

`dsh-feishu-docs` adds a Docs entry to the sidebar and a panel over the signed-in user's Feishu cloud documents. Feishu stays the only data source: the Host runs `lark-cli drive` and `docs` commands and serves them as authenticated routes, and the browser half renders what those routes return. Nothing is copied to disk, no local document store exists, and every write lands in Feishu through a block-level command.

## Table of Contents

- [Use this package](#use-this-package)
- [Understand the implementation](#understand-the-implementation)
- [Further Exploration](#further-exploration)
- [Model Experience](#model-experience)
- [Known Limitations and Deferred Work](#known-limitations-and-deferred-work)

-----

<a id="use-this-package"></a>
## Use this package

Install the bundle into a profile and open Docs in the sidebar. The panel has three views. Recent lists documents opened in the last 7, 30, or 90 days, ordered by last open or last edit. Search submits a keyword of at most 30 characters and can restrict results to documents you own. My space browses the cloud-space root and its folders, with a breadcrumb back to the root. Rows show the type glyph, the title with search hits marked, the owner, the time, and the type; the title is rendered from text segments, never from HTML.

Opening a document shows its metadata, its outline, and an Open in Feishu link, a Copy link action that confirms for two seconds, and a Rename field. View body reads the full body, bounded to 4000 characters and marked when cut. For a `docx` document or a wiki node the drawer also offers Edit content: it loads the block list, edits one plain-text block at a time, appends Markdown at the end, deletes a block after a second confirmation, and keeps unsaved drafts in memory until you discard them. A stale base revision answers with a conflict banner, reloads the document, and leaves the draft in the editor; a partial write shows the server warnings. Creating a document asks for a title, an optional Markdown body, and a location, and opens the new document when the create finishes. Without a configured Feishu app or a signed-in user the panel explains the state instead of failing, and it says so when `lark-cli` is missing.

The Host caches list reads for 60 seconds and document reads for 300 seconds in the bridge's shared cache; Refresh drops the current view's key, and every successful write drops the document's keys and the list keys. Edits freeze Refresh and the view switch until the editor closes, so the base revision cannot drift while you type.

-----

<a id="understand-the-implementation"></a>
## Understand the implementation

<details>
<summary>Implementation internals — click to expand</summary>

The Host half registers six exact Fetch routes inside Connection's authentication fence, so only owner principals reach them: `/api/feishu-docs/status`, `/recent`, `/search`, `/files`, `/document` (GET reads, POST writes), and `/documents` (POST creates). A service object holds the CLI runner through `ctx.feishuBridge`; `lark-cli` is resolved lazily by the bridge, so a missing executable fails the first request with `cli-missing` rather than failing plugin load. Reads recompute `missingScopes` from `auth status`; writes never retry because `docs +update` has no idempotency key.

Write commands carry the document's `revision_id` as `--revision-id`; the bridge maps a stale-revision rejection to `conflict` (HTTP 409). Appended Markdown travels through standard input (`--content -`), so document text never appears in the process argument list. A block rewrite sends `<tag>escaped text</tag>` as an argument after validating the tag against the editable whitelist, and the panel refetches blocks after every write because block ids change with the revision.

| File | Role |
|---|---|
| [`src/service.ts`](src/service.ts) | Document and folder reads, block writes, renames, creation, cache, bounds, error mapping |
| [`src/blocks.ts`](src/blocks.ts) | `with-ids` XML scanning, editability, entity decoding, write escaping |
| [`src/normalize.ts`](src/normalize.ts) | Highlight segments, type mapping, code-point truncation |
| [`src/routes.ts`](src/routes.ts) | Route definitions, query and body validation |
| [`src/client/controller.ts`](src/client/controller.ts) | Panel state, list reads, drawer reads, drafts, conflicts |
| [`src/client/DocPanel.tsx`](src/client/DocPanel.tsx) | Title row, view segments, list, state cards |
| [`src/client/DocDetail.tsx`](src/client/DocDetail.tsx) | Metadata, outline, body preview, links, rename, block editor |
| [`src/client/locales.ts`](src/client/locales.ts) | `feishuDocs` copy, Chinese as the key source |

| Read | Command |
|---|---|
| Recent | `drive +search --opened-since <Nd> --sort open_time\|edit_time --page-size 20` |
| Search | `drive +search --query <q> [--doc-types …] [--mine]` |
| My space | `drive files list [--folder-token t] [--order-by EditedTime\|CreatedTime] [--page-token p]` |
| Outline / body | `docs +fetch --doc <url> --scope outline\|full --doc-format markdown --detail simple` |
| Blocks | `docs +fetch --doc <url> --scope full --detail with-ids --doc-format xml` |

</details>

-----

<a id="further-exploration"></a>
## Further Exploration

- Feishu plugin and shared `lark-cli` login: [`@deepseek-ai/dsh-feishu`](../feishu/README.md)
- Shared process gate, cache, and failure codes: [`@deepseek-ai/dsh-feishu-bridge`](../feishu-bridge/README.md)
- Authenticated Fetch routes: [`@deepseek-ai/dsh-client-connection`](../../client/connection/README.md)
- Sidebar and main panel slots: [`@deepseek-ai/dsh-client-ui-sidebar`](../../client/ui-sidebar/README.md), [`@deepseek-ai/dsh-client-ui-layout`](../../client/ui-layout/README.md)

-----

<a id="model-experience"></a>
## Model Experience

None, as the document panel renders authenticated browser routes and registers no tool, prompt section, or request context.

#### KV Cache effect

None. No cached prefix changes.

## Known Limitations and Deferred Work

- Editing is block-level only, and only for `docx` documents and wiki nodes that wrap one. There is no whole-document overwrite: it would discard images and comments.
- Only `h1`–`h6`, `p`, `li`, `code`, and `quote` blocks are editable. A block holding an image, sheet, Base, whiteboard, citation, task, OKR, synced block, or table stays read-only and says to edit it in Feishu.
- Rewriting a block writes its plain text back, so inline bold, italic, and links inside that block become plain text.
- No rich block insertion, drag reordering, comments, permission management, upload or download, export, or inline image reading is implemented.
- Folder browsing is single-level with pagination; the cloud-space root is not recursive.
- The panel reads routes on load and does not poll status while visible, and it does not implement real-time collaboration.
- The outline and body previews come from the CLI's Markdown, so a wiki node whose target is not a `docx` cannot be edited from the panel.
