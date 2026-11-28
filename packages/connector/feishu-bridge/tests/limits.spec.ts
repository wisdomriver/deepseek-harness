// Concurrency gate: slot hand-over, queue bound, and slot recovery after a failure.

import { describe, expect, it } from 'vitest'
import { ConcurrencyGate } from '../src/limits.ts'

describe('ConcurrencyGate', () => {
  it('runs up to the limit and hands a slot to the next waiter', async () => {
    const gate = new ConcurrencyGate(1, 4)
    const order: string[] = []
    let release = (): void => {}
    const held = new Promise<void>((resolve) => { release = resolve })
    const first = gate.run(async () => {
      order.push('first')
      await held
      return 'first'
    })
    await new Promise(resolve => setTimeout(resolve, 0))
    const second = gate.run(async () => {
      order.push('second')
      return 'second'
    })
    await new Promise(resolve => setTimeout(resolve, 0))
    release()
    await expect(first).resolves.toBe('first')
    await expect(second).resolves.toBe('second')
    expect(order).toEqual(['first', 'second'])
  })

  it('fails with busy when the queue is full', async () => {
    const gate = new ConcurrencyGate(1, 0)
    let release: (() => void) | undefined
    const held = gate.run(async () => {
      await new Promise<void>((resolve) => { release = resolve })
    })
    await expect(gate.run(async () => undefined)).rejects.toMatchObject({ code: 'busy' })
    release?.()
    await held
  })

  it('releases the slot when the task fails', async () => {
    const gate = new ConcurrencyGate(1, 0)
    await expect(gate.run(async () => { throw new Error('boom') })).rejects.toThrow('boom')
    await expect(gate.run(async () => 'after')).resolves.toBe('after')
  })
})
