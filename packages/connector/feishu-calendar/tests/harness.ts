// Calendar test harness: a real bridge over a recorded runner, so panel specs exercise the
// shared gate, cache, and envelope mapping instead of a re-implementation.

import { FeishuBridgeService } from '@deepseek-ai/dsh-feishu-bridge/src/service.ts'
import type { CommandOutcome, CommandRequest, CommandRunner } from '@deepseek-ai/dsh-feishu-bridge'
import { calendarRoutes } from '../src/routes.ts'
import { CalendarService } from '../src/service.ts'

/** Successful envelope for one command. */
export function succeed(data: unknown, extra: Record<string, unknown> = {}): CommandOutcome {
  return { exitCode: 0, stdout: JSON.stringify({ ok: true, identity: 'user', data, ...extra }), stderr: '' }
}

/** Failure envelope `lark-cli` writes to standard error. */
export function fail(error: Record<string, unknown>, exitCode = 1): CommandOutcome {
  return { exitCode, stdout: '', stderr: JSON.stringify({ ok: false, identity: 'user', error }) }
}

/** Account envelope the CLI answers `auth status` with. */
export function authStatus(scope: string, userName = 'Ada'): CommandOutcome {
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
  /** Week start the service reports. */
  readonly weekStart?: 'monday' | 'sunday'
  /** Diagnostic sink the routes forward to. */
  readonly log?: (message: string) => void
}

/** Build a calendar service and its routes over a recorded runner. */
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
  const service = new CalendarService({ bridge, weekStart: options.weekStart ?? 'monday' })
  const routes = calendarRoutes({ service, bridge, ...(options.log === undefined ? {} : { log: options.log }) })
  return { calls, service, routes, bridge }
}
