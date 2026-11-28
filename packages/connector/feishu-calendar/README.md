---
description: "The Feishu calendar panel: a sidebar entry opening the primary calendar's month, today's agenda, event details, and quick event creation through the Feishu plugin's lark-cli."
kind: "package-reference"
---

# @deepseek-ai/dsh-feishu-calendar

English | [中文](README.zh.md)

## Summary

`dsh-feishu-calendar` adds a Calendar entry to the sidebar and a panel that mirrors the signed-in user's primary Feishu calendar. Feishu stays the only data source: the Host runs `lark-cli calendar` commands and serves them as authenticated routes, and the browser half renders what those routes return. Nothing is duplicated to disk, no local calendar exists, and creating an event from the panel writes it straight to Feishu.

## Table of Contents

- [Use this package](#use-this-package)
- [Understand the implementation](#understand-the-implementation)
- [Further Exploration](#further-exploration)
- [Model Experience](#model-experience)
- [Known Limitations and Deferred Work](#known-limitations-and-deferred-work)

-----

<a id="use-this-package"></a>
## Use this package

Install the bundle into a profile, then open Calendar in the sidebar. The panel shows the primary calendar as a month grid: each day lists up to three events and folds the rest behind a count. The arrows move between months, Today returns to the current one, Refresh re-reads the shown month, and New event opens a four-field form. Pressing an event chip or an agenda row opens its detail drawer, whose Edit and Delete actions update or remove the event; a recurring series asks for the scope first. Without a configured Feishu app or a signed-in user the panel explains the state instead of failing, and it says so when `lark-cli` is missing.

The month comes from one `calendar +agenda` call covering the grid's 42 cells, so a whole view costs one CLI process; repeated reads within 60 seconds come from memory. Details follow the event id through `calendar +get`, and a recurring instance costs one extra read of its master for the recurrence rule. A created event is written with `calendar events create --data -` over standard input, which keeps the title out of the process command line and creates no meeting or reminders.

This package needs the Feishu bridge (`@deepseek-ai/dsh-feishu-bridge`) in the same profile: the bridge owns the `lark-cli` location, the command budgets, the shared process gate, and the in-memory cache. Installing this panel without the bridge fails to activate. Its own configuration is `weekStart` for the grid's first column.

-----

<a id="understand-the-implementation"></a>
## Understand the implementation

<details>
<summary>Implementation internals — click to expand</summary>

The Host half registers three exact Fetch routes inside Connection's authentication fence, so only owner principals reach them: `/api/feishu-calendar/status`, `/api/feishu-calendar/events` (GET reads a month, POST creates), and `/api/feishu-calendar/event` (GET reads one detail). Every handler returns its payload and throws `FeishuError`; the bridge's `panelRoutes` adds the envelope, the HTTP status, and the request id. The service keeps only calendar command assembly and normalization: it calls `feishuBridge.run`, stores reads under `calendar:` keys in the shared cache, and invalidates them after a write.

The browser half registers a `main` panel under the `feishu-calendar` key and the matching `sidebar.panellist` entry, and drives a snapshot store: status first, then the month's events. Components read that store through the renderer's bound `useCalendar` hook and never touch `ctx`.

| File | Role |
|---|---|
| [`src/service.ts`](src/service.ts) | Calendar command assembly, normalization, cache keys, invalidation |
| [`src/routes.ts`](src/routes.ts) | Route definitions and request validation over the bridge's route wrapper |
| [`src/paths.ts`](src/paths.ts) | Route path constants |
| [`src/client/controller.ts`](src/client/controller.ts) | Panel state and the month read |
| [`src/client/CalendarPanel.tsx`](src/client/CalendarPanel.tsx) | Panel rendering |
| [`src/client/locales.ts`](src/client/locales.ts) | `feishuCalendar` copy, Chinese as the key source |

</details>

-----

<a id="further-exploration"></a>
## Further Exploration

- Feishu plugin and shared `lark-cli` login: [`@deepseek-ai/dsh-feishu`](../feishu/README.md)
- Authenticated Fetch routes: [`@deepseek-ai/dsh-client-connection`](../../client/connection/README.md)
- Sidebar and main panel slots: [`@deepseek-ai/dsh-client-ui-sidebar`](../../client/ui-sidebar/README.md), [`@deepseek-ai/dsh-client-ui-layout`](../../client/ui-layout/README.md)

-----

<a id="model-experience"></a>
## Model Experience

None, as the calendar panel renders authenticated browser routes and registers no tool, prompt section, or request context.

#### KV Cache effect

None. No cached prefix changes.

## Known Limitations and Deferred Work

- Week and day views, RSVP, attendees, location display, and meeting links are deferred.
- Only the primary calendar is read, and only date and timed events with a title, bounds, and a description can be created.
- The create form detects overlapping events from the loaded month and only warns; Feishu remains the authority.
- The client reads the routes on panel load rather than when the panel first becomes visible, and status polling while visible is not implemented yet.
