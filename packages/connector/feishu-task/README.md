---
description: "The Feishu tasks panel: a sidebar entry opening the pending, assigned, and completed task lists grouped by due date, with inline completion and quick creation through the Feishu plugin's lark-cli."
kind: "package-reference"
---

# @deepseek-ai/dsh-feishu-task

English | [中文](README.zh.md)

## Summary

`dsh-feishu-task` adds a Tasks entry to the sidebar and a panel that mirrors the signed-in user's Feishu tasks. Feishu stays the only data source: the Host runs `lark-cli task` commands and serves them as authenticated routes, and the browser half renders what those routes return. Nothing is duplicated to disk, and completing or creating a task from the panel writes it straight to Feishu.

## Table of Contents

- [Use this package](#use-this-package)
- [Understand the implementation](#understand-the-implementation)
- [Further Exploration](#further-exploration)
- [Model Experience](#model-experience)
- [Known Limitations and Deferred Work](#known-limitations-and-deferred-work)

-----

<a id="use-this-package"></a>
## Use this package

Install the bundle into a profile, then open Tasks in the sidebar. The panel lists tasks grouped by due date — overdue, today, tomorrow, this week, later, then undated — with a count per group and in the title row. The view switch reads every incomplete task, the ones assigned to the signed-in user, or the completed ones; the search box queries Feishu after a 300 ms pause, and clearing it returns to the cached view. Each row leads with a completion circle, and pressing the title opens a detail drawer with the due time, completion time, creator, assignees, followers, task lists, subtask count, parent task, and description. The drawer's Complete or Reopen button and its Feishu link work from there as well. Without a configured Feishu app or a signed-in user the panel explains the state instead of failing, offers the Plugins page where the account is connected, and says so when `lark-cli` is missing.

One list view costs one `task +search` call, and repeated reads within 60 seconds come from memory; a detail read costs one `task tasks get` call and is cached for 300 seconds. Completion, reopening, and creation go through `task +complete`, `task +reopen`, and `task +create` with an idempotency key, and each successful write drops every cached task read.

This package needs the Feishu bridge (`@deepseek-ai/dsh-feishu-bridge`) in the same profile: the bridge owns the `lark-cli` location, the command budgets, the shared process gate, and the in-memory cache. Installing this panel without the bridge fails to activate. The panel takes no configuration of its own.

-----

<a id="understand-the-implementation"></a>
## Understand the implementation

<details>
<summary>Implementation internals — click to expand</summary>

The Host half registers three exact Fetch routes inside Connection's authentication fence, so only owner principals reach them: `/api/feishu-task/status`, `/api/feishu-task/tasks` (GET reads a view, POST creates), and `/api/feishu-task/task` (GET reads one detail, POST completes or reopens). Every handler returns its payload and throws `FeishuError`; the bridge's `panelRoutes` adds the envelope, the HTTP status, and the request id. The service keeps only command assembly and normalization: it calls `feishuBridge.run`, reads the account's open id for the assigned filter, stores reads under `task:` keys in the shared cache, and invalidates them after a write.

A list row's `due_at` is local wall-clock time without a zone, so the Host reads it as the machine's local time and serializes the instant; the detail's `due.timestamp` is already absolute and also carries `is_all_day`. The browser groups rows by the local calendar day of that instant, which is the rule Feishu's own client applies to the same value.

The browser half registers a `main` panel under the `feishu-task` key and the matching `sidebar.panellist` entry, and drives a snapshot store: status first, then the chosen view. Components read that store through the renderer's bound `useTask` hook and never touch `ctx`. Completion marks the row optimistically, rolls the mark back when the write fails, and re-reads the list after the Host's cache invalidation.

| File | Role |
|---|---|
| [`src/service.ts`](src/service.ts) | Task command assembly, normalization, cache keys, invalidation |
| [`src/routes.ts`](src/routes.ts) | Route definitions and request validation over the bridge's route wrapper |
| [`src/paths.ts`](src/paths.ts) | Route path constants |
| [`src/client/controller.ts`](src/client/controller.ts) | Panel state, list and detail reads, completion, creation |
| [`src/client/groups.ts`](src/client/groups.ts) | Due-date grouping by local calendar day |
| [`src/client/TaskPanel.tsx`](src/client/TaskPanel.tsx) | Panel rendering |
| [`src/client/TaskDetail.tsx`](src/client/TaskDetail.tsx) | Detail drawer |
| [`src/client/CreateTaskDialog.tsx`](src/client/CreateTaskDialog.tsx) | Create form |
| [`src/client/locales.ts`](src/client/locales.ts) | `feishuTask` copy, Chinese as the key source |

</details>

-----

<a id="further-exploration"></a>
## Further Exploration

- Feishu plugin and shared `lark-cli` login: [`@deepseek-ai/dsh-feishu`](../feishu/README.md)
- The one process gate, cache, and failure codes this panel uses: [`@deepseek-ai/dsh-feishu-bridge`](../feishu-bridge/README.md)
- Authenticated Fetch routes: [`@deepseek-ai/dsh-client-connection`](../../client/connection/README.md)
- Sidebar and main panel slots: [`@deepseek-ai/dsh-client-ui-sidebar`](../../client/ui-sidebar/README.md), [`@deepseek-ai/dsh-client-ui-layout`](../../client/ui-layout/README.md)

-----

<a id="model-experience"></a>
## Model Experience

None, as the task panel renders authenticated browser routes and registers no tool, prompt section, or request context.

#### KV Cache effect

None. No cached prefix changes.

## Known Limitations and Deferred Work

- The create form collects one due date, so a timed due means the end of that local day; Feishu remains the authority for the stored instant.
- Lists read the CLI's default page of rows, and the completed view keeps the newest 50 it receives; pagination and the server-side due-range filter are deferred.
- Feishu's detail carries tasklist GUIDs and member ids only, so those show abbreviated ids; subtask rows, member names, arrow-key list navigation, and status polling while the panel is visible are deferred.
