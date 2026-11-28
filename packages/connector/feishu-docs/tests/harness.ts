// Docs test harness: a real bridge over a recorded runner, so panel specs exercise the
// shared gate, cache, and envelope mapping instead of a re-implementation.

import { FeishuBridgeService } from '@deepseek-ai/dsh-feishu-bridge/src/service.ts'
import type { CommandOutcome, CommandRequest, CommandRunner } from '@deepseek-ai/dsh-feishu-bridge'
import { docsRoutes } from '../src/routes.ts'
import { DocsService } from '../src/service.ts'

/** Successful envelope for one command. */
export function succeed(data: unknown, extra: Record<string, unknown> = {}): CommandOutcome {
  return { exitCode: 0, stdout: JSON.stringify({ ok: true, identity: 'user', data, ...extra }), stderr: '' }
}

/** Failure envelope `lark-cli` writes to standard error. */
export function fail(error: Record<string, unknown>, exitCode = 1): CommandOutcome {
  return { exitCode, stdout: '', stderr: JSON.stringify({ ok: false, identity: 'user', error }) }
}

/** The scopes the docs panel asks for. */
export const DOCS_SCOPES = [
  'docx:document:readonly',
  'docs:document.content:read',
  'drive:drive.metadata:readonly',
  'search:docs:read',
  'wiki:node:read',
].join(' ')

/** Account envelope the CLI answers `auth status` with. */
export function authStatus(scope: string = DOCS_SCOPES, userName = 'Ada'): CommandOutcome {
  return {
    exitCode: 0,
    stderr: '',
    stdout: JSON.stringify({
      appId: 'cli_x',
      identities: { user: { status: 'ready', available: true, userName, scope } },
    }),
  }
}

/** Harness options one spec may vary. */
export interface HarnessOptions {
  /** Diagnostic sink the routes forward to. */
  readonly log?: (message: string) => void
}

/** Build a docs service and its routes over a recorded runner. */
export function serviceOver(
  answers: (request: CommandRequest) => CommandOutcome,
  options: HarnessOptions = {},
) {
  const calls: CommandRequest[] = []
  const run: CommandRunner = async (request) => {
    calls.push(request)
    return answers(request)
  }
  const bridge = new FeishuBridgeService({
    run,
    readTimeoutMs: 15_000,
    writeTimeoutMs: 30_000,
    maxConcurrency: 2,
    queueLimit: 8,
  })
  const service = new DocsService({ bridge })
  const routes = docsRoutes({ service, bridge, ...(options.log === undefined ? {} : { log: options.log }) })
  return { calls, service, routes, bridge }
}

/** One search result row the CLI returns. */
export function searchResult(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    entity_type: 'DOC',
    result_meta: {
      token: 'doccn1',
      url: 'https://example.test/docx/doccn1',
      doc_types: 'DOCX',
      owner_name: 'Ada',
      edit_user_name: 'Bo',
      last_open_time_iso: '2026-11-26T08:13:11+08:00',
      update_time_iso: '2026-11-25T23:12:18+08:00',
      icon_info: '{"type":0,"key":""}',
      ...overrides,
    },
    title_highlighted: 'Doc',
    summary_highlighted: '',
  }
}
