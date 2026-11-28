/**
 * The one CLI process gate every Feishu panel shares.
 * @module @deepseek-ai/dsh-feishu-bridge/limits
 */

import { FeishuError } from './errors.ts'

/** Bounds how many `lark-cli` processes run at once and how many callers may wait. */
export class ConcurrencyGate {
  /** Commands currently running. */
  private active = 0

  /** Callers waiting for a slot, in arrival order. */
  private readonly waiting: (() => void)[] = []

  /**
   * @param maxConcurrency - processes allowed to run at once.
   * @param queueLimit - callers allowed to wait before the next one fails with `busy`.
   */
  constructor(private readonly maxConcurrency: number, private readonly queueLimit: number) {}

  /**
   * Run one task inside the gate.
   * @param task - the work owning one slot while it runs.
   * @returns the task's value.
   * @throws FeishuError with `busy` when the wait queue is already full.
   */
  async run<T>(task: () => Promise<T>): Promise<T> {
    await this.acquire()
    try {
      return await task()
    } finally {
      this.release()
    }
  }

  /**
   * Take one slot, or wait for one to be handed over.
   * @throws FeishuError with `busy` when the wait queue is already full.
   */
  private async acquire(): Promise<void> {
    if (this.active < this.maxConcurrency) {
      this.active += 1
      return
    }
    if (this.waiting.length >= this.queueLimit) {
      throw new FeishuError('busy', 'lark-cli queue is full')
    }
    await new Promise<void>((resolve) => { this.waiting.push(resolve) })
  }

  /** Give a slot back, or hand it directly to the next waiter. */
  private release(): void {
    const next = this.waiting.shift()
    if (next === undefined) {
      this.active = Math.max(0, this.active - 1)
      return
    }
    next()
  }
}
