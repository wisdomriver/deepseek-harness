// Shared cache: TTL expiry, LRU eviction, prefix invalidation, single-flight, and error passthrough.

import { afterEach, describe, expect, it, vi } from 'vitest'
import { BridgeCache } from '../src/cache.ts'

afterEach(() => { vi.useRealTimers() })

describe('BridgeCache', () => {
  it('serves a fresh value and expires it at its deadline', async () => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-11-29T00:00:00Z'))
    const cache = new BridgeCache()
    let loads = 0
    const load = async (): Promise<string> => {
      loads += 1
      return 'value'
    }
    await expect(cache.memo('k', 1000, load)).resolves.toBe('value')
    vi.setSystemTime(new Date('2026-11-29T00:00:00.500Z'))
    await expect(cache.memo('k', 1000, load)).resolves.toBe('value')
    expect(loads).toBe(1)
    vi.setSystemTime(new Date('2026-11-29T00:00:01.500Z'))
    await expect(cache.memo('k', 1000, load)).resolves.toBe('value')
    expect(loads).toBe(2)
  })

  it('joins a concurrent miss into one load', async () => {
    const cache = new BridgeCache()
    let loads = 0
    let release: ((value: string) => void) | undefined
    const load = (): Promise<string> => {
      loads += 1
      return new Promise<string>((resolve) => { release = resolve })
    }
    const first = cache.memo('k', 1000, load)
    const second = cache.memo('k', 1000, load)
    release?.('shared')
    await expect(first).resolves.toBe('shared')
    await expect(second).resolves.toBe('shared')
    expect(loads).toBe(1)
  })

  it('does not cache a rejection', async () => {
    const cache = new BridgeCache()
    const boom = new Error('boom')
    await expect(cache.memo('k', 1000, () => Promise.reject(boom))).rejects.toBe(boom)
    await expect(cache.memo('k', 1000, async () => 'recovered')).resolves.toBe('recovered')
  })

  it('evicts the least recently used entry beyond the limit', async () => {
    const cache = new BridgeCache(2)
    await cache.memo('a', 1000, async () => 'a')
    await cache.memo('b', 1000, async () => 'b')
    await cache.memo('a', 1000, async () => 'a')
    await cache.memo('c', 1000, async () => 'c')
    expect(cache.get('a')).toBe('a')
    expect(cache.get('b')).toBeUndefined()
    expect(cache.get('c')).toBe('c')
  })

  it('invalidates by prefix and clears everything', async () => {
    const cache = new BridgeCache()
    await cache.memo('docs:recent', 1000, async () => 1)
    await cache.memo('docs:search', 1000, async () => 2)
    await cache.memo('task:list', 1000, async () => 3)
    cache.invalidate('docs:')
    expect(cache.get('docs:recent')).toBeUndefined()
    expect(cache.get('docs:search')).toBeUndefined()
    expect(cache.get('task:list')).toBe(3)
    cache.clear()
    expect(cache.get('task:list')).toBeUndefined()
  })
})
