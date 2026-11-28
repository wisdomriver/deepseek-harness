/**
 * Stable failure codes every Feishu panel renders, and the HTTP status each one answers with.
 * @module @deepseek-ai/dsh-feishu-bridge/errors
 */

import { HarnessError } from '@deepseek-ai/dsh-error'

/** Machine-routable failure codes; each panel maps a code to one localized message. */
export type FeishuErrorCode =
  | 'invalid-input'
  | 'not-found'
  | 'not-configured'
  | 'not-connected'
  | 'permission-denied'
  | 'cli-missing'
  | 'timeout'
  | 'busy'
  | 'upstream'
  | 'unknown-outcome'
  | 'conflict'
  | 'internal'

/** HTTP status each code answers with. */
export const FEISHU_HTTP_STATUS: Readonly<Record<FeishuErrorCode, number>> = {
  'invalid-input': 400,
  'not-found': 404,
  'not-configured': 503,
  'not-connected': 503,
  'permission-denied': 502,
  'cli-missing': 503,
  timeout: 502,
  busy: 429,
  upstream: 502,
  'unknown-outcome': 502,
  conflict: 409,
  internal: 500,
}

/** One Feishu failure carrying a stable code; `message` is Host-side diagnostic only. */
export class FeishuError extends HarnessError {
  /** The narrowed stable code assigned by {@link FeishuError} itself. */
  declare readonly code: FeishuErrorCode

  /**
   * @param code - stable failure code, also the `HarnessError` code.
   * @param message - Host-side diagnostic; routes replace it with localized copy.
   * @param options - standard error options, usually the cause.
   */
  constructor(code: FeishuErrorCode, message: string, options?: ErrorOptions) {
    super(message, code, options)
  }
}

/**
 * Read the stable code off a thrown value.
 * @param error - value caught from a panel route handler.
 * @returns the stable code, or `internal` for anything the Host did not classify.
 */
export function feishuCodeOf(error: unknown): FeishuErrorCode {
  return error instanceof FeishuError ? error.code : 'internal'
}
