/**
 * Read, interpret, and classify the JSON envelope a `lark-cli` command prints.
 * @module @deepseek-ai/dsh-feishu-bridge/envelope
 */

import { PROGRAM, jsonObjectIn, type CommandOutcome } from './cli.ts'
import { FeishuError } from './errors.ts'

/** API codes meaning the addressed resource no longer exists. */
const NOT_FOUND_CODES = new Set([190014, 191001, 981003])

/** API codes meaning the token lacks a scope. */
const PERMISSION_CODES = new Set([99991672, 99991679])

/** API codes meaning the token is absent, expired, or revoked. */
const NOT_CONNECTED_CODES = new Set([99991661, 99991663, 99991668])

/** API codes the document service uses for a stale base revision; filled in as they are observed. */
const CONFLICT_CODES = new Set<number>([])

/** Message wording the document service uses for a stale base revision. */
const CONFLICT_MESSAGE = /revision|conflict/i

/**
 * Read the JSON envelope one command printed.
 * @param outcome - finished command.
 * @param label - redacted command label for the diagnostic.
 * @returns the envelope object.
 * @throws FeishuError with `upstream` when neither stream holds JSON.
 */
export function parseEnvelope(outcome: CommandOutcome, label: string): Record<string, unknown> {
  const envelope = jsonObjectIn(outcome.stdout) ?? jsonObjectIn(outcome.stderr)
  if (envelope === undefined) {
    throw new FeishuError('upstream', `${PROGRAM} ${label} printed no JSON (exit ${outcome.exitCode})`)
  }
  return envelope
}

/**
 * Require the envelope to report success.
 * @param envelope - parsed envelope.
 * @param label - redacted command label for the diagnostic.
 * @throws FeishuError mapped from the envelope's own error when `ok` is not true.
 */
export function requireEnvelopeOk(envelope: Record<string, unknown>, label: string): void {
  if (envelope.ok === true) return
  throw envelopeFailure(envelope, label)
}

/**
 * Map a failure envelope to a stable code.
 * @param envelope - parsed envelope whose `ok` is not true.
 * @param label - redacted command label, prepended only to diagnostics without a message.
 * @returns the error to answer with.
 */
export function envelopeFailure(envelope: Record<string, unknown>, label: string): FeishuError {
  const error = asRecord(envelope.error)
  const message = asString(error?.message) ?? `${PROGRAM} ${label} reported a failure`
  const type = asString(error?.type)
  const subtype = asString(error?.subtype)
  const code = typeof error?.code === 'number' ? error.code : Number.NaN
  if (type === 'config' || subtype === 'not_configured') return new FeishuError('not-configured', message)
  if (type === 'validation') {
    return CONFLICT_MESSAGE.test(message) ? new FeishuError('conflict', message) : new FeishuError('invalid-input', message)
  }
  if (CONFLICT_CODES.has(code)) return new FeishuError('conflict', message)
  if (NOT_FOUND_CODES.has(code)) return new FeishuError('not-found', message)
  if (PERMISSION_CODES.has(code)) return new FeishuError('permission-denied', message)
  if (NOT_CONNECTED_CODES.has(code)) return new FeishuError('not-connected', message)
  if (type === 'api' && CONFLICT_MESSAGE.test(message)) return new FeishuError('conflict', message)
  return new FeishuError('upstream', message)
}

/**
 * Narrow one value to a non-array object.
 * @param value - value from the CLI envelope.
 * @returns the object, or undefined.
 */
export function asRecord(value: unknown): Record<string, unknown> | undefined {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    ? value as Record<string, unknown>
    : undefined
}

/**
 * Require one value to be a non-array object.
 * @param value - value from the CLI envelope.
 * @param subject - what the value should be, for the diagnostic.
 * @returns the object.
 * @throws FeishuError with `upstream` when the value is not an object.
 */
export function requireRecord(value: unknown, subject: string): Record<string, unknown> {
  const record = asRecord(value)
  if (record === undefined) throw new FeishuError('upstream', `${PROGRAM} returned no ${subject}`)
  return record
}

/**
 * Read one optional string field.
 * @param value - field value.
 * @returns the string, or undefined for absent and non-string values.
 */
export function asString(value: unknown): string | undefined {
  return typeof value === 'string' ? value : undefined
}
