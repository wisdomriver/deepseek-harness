/**
 * Bounded TTL cache with single-flight loads, shared by every Feishu panel.
 * @module @deepseek-ai/dsh-feishu-bridge/cache
 */

import type { CacheStore } from './types.ts'

/** Entries retained across every cache key. */
export const CACHE_LIMIT = 32

/** One cached value and when it stops being fresh. */
interface CacheEntry {
  readonly value: unknown
  readonly expiresAt: number
}

/** Least-recently-used TTL cache whose concurrent miss for one key runs once. */
export class BridgeCache implements CacheStore {
  /** Fresh values by key; insertion order is the LRU order. */
  private readonly entries = new Map<string, CacheEntry>()

  /** In-flight loads by key, so concurrent callers share one producer. */
  private readonly inflight = new Map<string, Promise<unknown>>()

  /**
   * @param limit - entries retained before the least recently used is evicted.
   */
  constructor(private readonly limit: number = CACHE_LIMIT) {}

  /**
   * Read a fresh value.
   * @param key - cache key.
   * @returns the value, or undefined when absent or stale.
   */
  get<T>(key: string): T | undefined {
    const entry = this.entries.get(key)
    if (entry === undefined) return undefined
    if (entry.expiresAt <= Date.now()) {
      this.entries.delete(key)
      return undefined
    }
    this.entries.delete(key)
    this.entries.set(key, entry)
    return entry.value as T
  }

  /**
   * Serve one key from cache, join an in-flight load, or start a new one.
   * @param key - cache key.
   * @param ttlMs - freshness window.
   * @param load - producer invoked only when nothing fresh exists.
   * @returns the cached or produced value.
   * @throws whatever the loader throws; failures are never cached.
   */
  memo<T>(key: string, ttlMs: number, load: () => Promise<T>): Promise<T> {
    const hit = this.get<T>(key)
    if (hit !== undefined) return Promise.resolve(hit)
    const running = this.inflight.get(key)
    if (running !== undefined) return running as Promise<T>
    const started = load()
      .then((value) => {
        this.store(key, { value, expiresAt: Date.now() + ttlMs })
        return value
      })
      .finally(() => { this.inflight.delete(key) })
    this.inflight.set(key, started)
    return started
  }

  /**
   * Drop every entry whose key starts with `prefix`.
   * @param prefix - leading key fragment, for example `calendar:events:`.
   */
  invalidate(prefix: string): void {
    for (const key of [...this.entries.keys()]) {
      if (key.startsWith(prefix)) this.entries.delete(key)
    }
  }

  /** Drop every entry. */
  clear(): void {
    this.entries.clear()
  }

  /**
   * Store one value, evicting the least recently used entry beyond the limit.
   * @param key - cache key.
   * @param entry - value and freshness deadline.
   */
  private store(key: string, entry: CacheEntry): void {
    this.entries.delete(key)
    this.entries.set(key, entry)
    while (this.entries.size > this.limit) {
      const oldest = this.entries.keys().next()
      /* v8 ignore next -- the loop condition proves the map holds a key, so the iterator cannot be done. */
      if (oldest.done === true) return
      this.entries.delete(oldest.value)
    }
  }
}
