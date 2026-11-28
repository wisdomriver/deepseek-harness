/**
 * Types shared by the bridge service, its command runner, and the panel routes.
 * @module @deepseek-ai/dsh-feishu-bridge/types
 */

/** Panels this bridge serves; used for diagnostics and route prefixes. */
export type PanelId = 'calendar' | 'task' | 'docs'

/** One `lark-cli` invocation requested by a panel. */
export interface CliRequest {
  /** Subcommand and native arguments after the executable, for example `['calendar', '+agenda']`. */
  readonly command: readonly string[]
  /** Whether the call reads or writes, which selects the default budget. */
  readonly mode: 'read' | 'write'
  /** Text piped to standard input, used for `--data -` payloads. */
  readonly stdin?: string
  /** Explicit budget overriding the mode's default. */
  readonly timeoutMs?: number
  /** `transient` retries once after a timeout or transport failure; reads only. */
  readonly retry?: 'none' | 'transient'
  /** Redacted label for diagnostics; defaults to the first command words. */
  readonly label?: string
}

/** One completed invocation, already checked for a success envelope. */
export interface CliResult {
  /** The envelope's `data` value. */
  readonly data: unknown
  /** The envelope's `meta` value. */
  readonly meta: unknown
  /** Process exit code, kept for diagnostics only. */
  readonly exitCode: number
  /** Wall-clock duration of the invocation. */
  readonly durationMs: number
}

/** Account facts the panels map onto their five states. */
export interface AuthFacts {
  /** Whether an executable was resolved and answered. */
  readonly cli: boolean
  /** Whether the CLI reports an application configuration. */
  readonly configured: boolean
  /** Whether a user identity is signed in and ready. */
  readonly connected: boolean
  /** Signed-in user's display name, when the CLI reports one. */
  readonly userName?: string
  /** Signed-in user's `open_id`, used for assignee filters. */
  readonly openId?: string
  /** Scopes the signed-in token was granted. */
  readonly scopes: readonly string[]
}

/** Bounded in-memory store shared by every panel. */
export interface CacheStore {
  /** Read a fresh value, or undefined when absent or stale. */
  get<T>(key: string): T | undefined
  /** Read, join an in-flight load, or start one; failures are not cached. */
  memo<T>(key: string, ttlMs: number, load: () => Promise<T>): Promise<T>
  /** Drop every entry whose key starts with `prefix`. */
  invalidate(prefix: string): void
  /** Drop every entry. */
  clear(): void
}

/** The capability the bridge provides on `ctx.feishuBridge`. */
export interface FeishuBridge {
  /** Run one invocation inside the shared gate and return its envelope data. */
  run(request: CliRequest): Promise<CliResult>
  /** Read the account facts, cached briefly. */
  status(): Promise<AuthFacts>
  /**
   * Throw `permission-denied` when the signed-in token lacks any required scope.
   * @throws FeishuError with code `permission-denied`, listing the missing scopes.
   */
  requireScopes(panel: PanelId, required: readonly string[]): Promise<void>
  /** The shared cache. */
  readonly cache: CacheStore
  /**
   * Wrap one panel's declared routes into Connection's structural form.
   * @param panel - panel owning these routes; it names the diagnostics and fallback copy.
   * @param routes - declared routes whose handlers return data or throw `FeishuError`.
   * @param log - optional Host-side diagnostic sink.
   * @returns routes ready for `ctx.connection.fetch.register`.
   */
  routes(panel: PanelId, routes: readonly PanelRoute[], log?: (message: string) => void): readonly BridgeRoute[]
}

/** Methods Connection admits on an exact route. */
export type RouteMethod = 'GET' | 'HEAD' | 'POST'

/** One route a panel declares; the bridge wraps it into a Connection route. */
export interface PanelRoute {
  /** Absolute path below `/api`, matched exactly. */
  readonly path: string
  /** Methods this route owns. */
  readonly methods: readonly RouteMethod[]
  /** How Connection presents the request body. */
  readonly requestBody: 'buffered' | 'streaming'
  /** Handler returning the `data` payload; it throws `FeishuError` to fail. */
  readonly fetch: (request: Request) => Promise<unknown>
}

/** One route in the structural form `ctx.connection.fetch.register` accepts. */
export interface BridgeRoute {
  /** Absolute path below `/api`, matched exactly. */
  readonly path: string
  /** Methods this route owns. */
  readonly methods: readonly RouteMethod[]
  /** How Connection presents the request body. */
  readonly requestBody: 'buffered' | 'streaming'
  /** Handler; only owner principals reach it. */
  readonly fetch: (request: Request) => Promise<Response>
}
