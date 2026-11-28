// Envelope reading and failure mapping: stream selection, progress lines, and every stable code.

import { describe, expect, it } from 'vitest'
import { envelopeFailure, parseEnvelope, requireEnvelopeOk } from '../src/envelope.ts'
import type { CommandOutcome } from '../src/cli.ts'

/** Build one finished command. */
function outcome(parts: Partial<CommandOutcome>): CommandOutcome {
  return { exitCode: 0, stdout: '', stderr: '', ...parts }
}

describe('parseEnvelope', () => {
  it('reads a success envelope from standard output', () => {
    expect(parseEnvelope(outcome({ stdout: '{"ok":true,"data":{"a":1}}' }), 'task +search')).toEqual({ ok: true, data: { a: 1 } })
  })

  it('reads a failure envelope from standard error', () => {
    expect(parseEnvelope(outcome({ stderr: '{"ok":false,"error":{"type":"api"}}' }), 'task +search'))
      .toEqual({ ok: false, error: { type: 'api' } })
  })

  it('skips the progress line a delete prints first', () => {
    const stdout = '[calendar +delete] deleting master event\n{"ok":true,"data":{}}'
    expect(parseEnvelope(outcome({ stdout }), 'calendar +delete')).toEqual({ ok: true, data: {} })
  })

  it('fails with upstream when no stream holds JSON', () => {
    expect(() => parseEnvelope(outcome({ stdout: 'lark-cli: not found', exitCode: 127 }), 'task +search'))
      .toThrowError(/printed no JSON/)
  })
})

describe('requireEnvelopeOk', () => {
  it('accepts a success envelope', () => {
    expect(() => { requireEnvelopeOk({ ok: true }, 'task +search') }).not.toThrow()
  })

  it('throws the mapped failure', () => {
    expect(() => { requireEnvelopeOk({ ok: false, error: { type: 'validation', message: 'bad' } }, 'x') })
      .toThrowError(expect.objectContaining({ code: 'invalid-input' }))
  })
})

describe('envelopeFailure', () => {
  it.each([
    [{ type: 'config', subtype: 'not_configured', message: 'x' }, 'not-configured'],
    [{ type: 'config', message: 'x' }, 'not-configured'],
    [{ type: 'validation', message: 'x' }, 'invalid-input'],
    [{ type: 'api', code: 190014, message: 'x' }, 'not-found'],
    [{ type: 'api', code: 981003, message: 'x' }, 'not-found'],
    [{ type: 'api', code: 99991672, message: 'x' }, 'permission-denied'],
    [{ type: 'api', code: 99991663, message: 'x' }, 'not-connected'],
    [{ type: 'api', code: 123456, message: 'x' }, 'upstream'],
    [{ type: 'api', message: 'base revision is stale' }, 'conflict'],
    [{ type: 'validation', message: 'revision conflict' }, 'conflict'],
    [{}, 'upstream'],
  ])('maps %j to %s', (error, code) => {
    expect(envelopeFailure({ ok: false, error }, 'label')).toMatchObject({ code })
  })

  it('keeps a diagnostic for an envelope without a message', () => {
    expect(envelopeFailure({ ok: false }, 'task +search')).toMatchObject({ code: 'upstream' })
    expect(envelopeFailure({ ok: false }, 'task +search').message).toContain('task +search')
  })
})
