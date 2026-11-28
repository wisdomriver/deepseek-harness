---
description: "The Feishu bridge: one lark-cli process gate, one memory cache, and one set of stable failure codes shared by the Feishu panel plugins."
kind: "package-reference"
---

# @deepseek-ai/dsh-feishu-bridge

English | [中文](README.zh.md)

## Summary

`dsh-feishu-bridge` is the Host half every Feishu panel plugin builds on. It provides `ctx.feishuBridge`: a service that resolves the managed `lark-cli`, runs one command at a time behind a shared concurrency gate, reads the JSON envelope out of either output stream, maps failures to twelve stable codes, and serves cached values from one least-recently-used store. It registers no route and no sidebar entry of its own, so a profile that installs it without a panel gains nothing visible.

## Table of Contents

- [Use this package](#use-this-package)
- [Understand the implementation](#understand-the-implementation)
- [Further Exploration](#further-exploration)
- [Model Experience](#model-experience)
- [Known Limitations and Deferred Work](#known-limitations-and-deferred-work)

-----

<a id="use-this-package"></a>
## Use this package

A panel plugin depends on this one and injects the service:

```ts
ctx.inject(['feishuBridge'], (scope) => {
  const result = scope.feishuBridge.run({ command: ['task', '+search'], mode: 'read' })
})
```

The bridge is mounted by its own Cordis patch row. Its configuration lives on the plugin entry: `binDir` for a `lark-cli` outside the installed `@larksuite/cli` package, `readTimeoutMs` and `writeTimeoutMs` per command class, `maxConcurrency` and `queueLimit` for the process gate, and `cacheLimit` for the shared store. Every panel reads the same values, so one deployment change reaches all of them.

Calls declare a mode. Reads use `readTimeoutMs` and may pass `retry: 'transient'`, which retries once after a timeout; writes use `writeTimeoutMs` and never retry, because a write that timed out may already have landed. Standard input is available for commands that take `--data -`, which keeps content out of the process command line.

A failure carries one stable code: `invalid-input`, `not-found`, `not-configured`, `not-connected`, `permission-denied`, `cli-missing`, `timeout`, `busy`, `upstream`, `unknown-outcome`, `conflict`, or `internal`. Each has one HTTP status, so panels map a code to a localized message instead of forwarding CLI text.

-----

<a id="understand-the-implementation"></a>
## Understand the implementation

<details>
<summary>Implementation internals — click to expand</summary>

The plugin entry is a function plugin: it resolves `Config` once, builds the service over lazily resolved executable, and provides it as `feishuBridge`. `lark-cli` is resolved on first use, so a missing executable fails the first request with `cli-missing` rather than failing plugin load.

Commands run through `spawn` with `windowsHide`, both streams retained up to 8 MiB, a wall-clock budget enforced with a timer that kills the process, and the runner treats an `ENOENT` spawn error as `cli-missing`. Envelope parsing prefers standard output and falls back to standard error, which is where `lark-cli` writes failure envelopes; a command that prints a progress line before its JSON still parses. Success is decided by the envelope's `ok`, never by the exit code.

Panels wrap their own route handlers with `panelRoutes`, which produces the structural routes `ctx.connection.fetch.register` accepts: the wrapper adds the `requestId`, the `{ ok, data }` / `{ ok: false, error }` envelope, the status from the code table, and one diagnostic line per failure that names the panel, method, path, and code without any Feishu content.

| File | Role |
|---|---|
| [`src/index.ts`](src/index.ts) | Function plugin entry, configuration, service provisioning |
| [`src/cli.ts`](src/cli.ts) | Executable resolution, subprocess execution, JSON locating |
| [`src/envelope.ts`](src/envelope.ts) | Envelope reading and failure-to-code mapping |
| [`src/errors.ts`](src/errors.ts) | `FeishuError`, the twelve codes, HTTP statuses |
| [`src/cache.ts`](src/cache.ts) | TTL cache, LRU eviction, single-flight loads |
| [`src/limits.ts`](src/limits.ts) | The process gate |
| [`src/routes.ts`](src/routes.ts) | Route wrapper: envelope, status, request id, diagnostics |
| [`src/types.ts`](src/types.ts) | Request, result, account, cache, and route types |

</details>

-----

<a id="further-exploration"></a>
## Further Exploration

- The Feishu plugin (`@deepseek-ai/dsh-feishu`) owns sign-in and the CLI install; this bridge only reads the resulting state.
- The panel plugins built on this bridge are the Feishu calendar, task, and docs panels.

-----

<a id="model-experience"></a>
## Model Experience

None, as the bridge runs `lark-cli` commands for browser panels over authenticated routes and registers no tool, prompt section, or request context.

#### KV Cache effect

None. No cached prefix changes.

## Known Limitations and Deferred Work

- Logging is a callback the plugin entry wires to `ctx.logger`; there is no per-call metrics export yet.
- Write operations deliberately have no idempotency helper of their own: each panel passes the idempotency key its CLI command supports, and a write that times out reports `unknown-outcome` for the user to confirm.
- The conflict code is detected from API codes and message wording; the document service's exact code is still unobserved, so `envelope.ts` keeps an empty code set ready for it.
