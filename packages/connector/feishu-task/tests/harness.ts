// Tasks test harness: a real bridge over a recorded runner, so panel specs exercise the
// shared gate, cache, and envelope mapping instead of a re-implementation.

import { FeishuBridgeService } from '@deepseek-ai/dsh-feishu-bridge/src/service.ts'
import type { CommandOutcome, CommandRequest, CommandRunner } from '@deepseek-ai/dsh-feishu-bridge'
import { taskRoutes } from '../src/routes.ts'
import { TaskService } from '../src/service.ts'

/** Scope set a fully authorized token holds. */
export const TASK_SCOPES = 'task:task:read task:task:write'

/** Successful envelope for one command. */
export function succeed(data: unknown): CommandOutcome {
  return { exitCode: 0, stdout: JSON.stringify({ ok: true, identity: 'user', data }), stderr: '' }
}

/** Failure envelope `lark-cli` writes to standard error. */
export function fail(error: Record<string, unknown>, exitCode = 1): CommandOutcome {
  return { exitCode, stdout: '', stderr: JSON.stringify({ ok: false, identity: 'user', error }) }
}

/** Account facts one `auth status` fan-out may vary. */
export interface AuthOptions {
  /** Scopes the token was granted, space separated. */
  readonly scope?: string
  /** Signed-in user's display name. */
  readonly userName?: string
  /** Signed-in user's open id. */
  readonly openId?: string
  /** Whether the identity is ready and available. */
  readonly connected?: boolean
}

/** Account envelope the CLI answers `auth status` with. */
export function authStatus(options: AuthOptions = {}): CommandOutcome {
  const connected = options.connected ?? true
  return {
    exitCode: 0,
    stderr: '',
    stdout: JSON.stringify({
      appId: 'cli_x',
      identities: {
        user: {
          status: connected ? 'ready' : 'expired',
          available: connected,
          userName: options.userName ?? 'Ada',
          openId: options.openId ?? 'ou_me',
          scope: options.scope ?? TASK_SCOPES,
        },
      },
    }),
  }
}

/** Harness options one spec may vary. */
export interface HarnessOptions {
  /** Diagnostic sink the routes forward to. */
  readonly log?: (message: string) => void
}

/** Build a task service and its routes over a recorded runner. */
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
  const service = new TaskService({ bridge })
  const routes = taskRoutes({ service, bridge, ...(options.log === undefined ? {} : { log: options.log }) })
  return { calls, service, routes, bridge }
}

/**
 * Answer the account probe and one task command.
 * @param task - the outcome every non-auth command answers with.
 * @param auth - account facts to report.
 * @returns the recorded runner's answers.
 */
export function authThen(task: CommandOutcome, auth: AuthOptions = {}) {
  return (request: CommandRequest): CommandOutcome =>
    request.args[0] === 'auth' ? authStatus(auth) : task
}
