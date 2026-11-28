// Due-date grouping: six buckets in display order, local-day comparisons, and Host order kept.

import { describe, expect, it } from 'vitest'
import { dueBucket, groupTasks, localDay } from '../src/client/groups.ts'
import type { TaskSummary } from '../src/types.ts'

/** A local instant on the fixed test day. */
const NOW = new Date(2026, 10, 10, 9, 0, 0)

/**
 * Build one normalized row.
 * @param taskId - task id.
 * @param dueAt - due instant, if any.
 * @returns the row.
 */
function task(taskId: string, dueAt?: string): TaskSummary {
  return {
    taskId,
    summary: taskId,
    status: 'todo',
    assignees: [],
    followers: [],
    ...(dueAt === undefined ? {} : { dueAt }),
  }
}

/**
 * Build the ISO instant of a local day offset from the fixed test day.
 * @param days - calendar days after the test day; negative values look back.
 * @returns the ISO 8601 instant at local noon.
 */
function day(days: number): string {
  return new Date(2026, 10, 10 + days, 12, 0, 0).toISOString()
}

describe('groupTasks', () => {
  it('groups the six buckets in display order and drops empty ones', () => {
    const groups = groupTasks([
      task('later', day(30)),
      task('none'),
      task('week', day(4)),
      task('tomorrow', day(1)),
      task('today', day(0)),
      task('overdue', day(-3)),
    ], NOW)
    expect(groups.map(group => group.key)).toEqual(['overdue', 'today', 'tomorrow', 'week', 'later', 'none'])
    expect(groups.map(group => group.tasks.map(item => item.taskId))).toEqual([
      ['overdue'], ['today'], ['tomorrow'], ['week'], ['later'], ['none'],
    ])
  })

  it('returns no groups for an empty list', () => {
    expect(groupTasks([], NOW)).toEqual([])
  })

  it('keeps the Host order inside one bucket', () => {
    const groups = groupTasks([task('b', day(0)), task('a', day(0))], NOW)
    expect(groups[0]?.tasks.map(item => item.taskId)).toEqual(['b', 'a'])
  })

  it('compares local calendar days, not the UTC date', () => {
    const early = new Date(2026, 10, 10, 0, 30, 0).toISOString()
    const late = new Date(2026, 10, 10, 23, 30, 0).toISOString()
    expect(localDay(new Date(early))).toBe('2026-11-10')
    expect(dueBucket(early, NOW)).toBe('today')
    expect(dueBucket(late, NOW)).toBe('today')
  })

  it('counts the seventh day after today as this week and the eighth as later', () => {
    expect(dueBucket(day(7), NOW)).toBe('week')
    expect(dueBucket(day(8), NOW)).toBe('later')
  })

  it('treats a missing or malformed due value as undated', () => {
    expect(dueBucket(undefined, NOW)).toBe('none')
    expect(dueBucket('not a date', NOW)).toBe('none')
  })

  it('groups every dated task as later while the clock itself is unreadable', () => {
    const groups = groupTasks([task('dated', day(0))], new Date('not a clock'))
    expect(groups.map(group => group.key)).toEqual(['later'])
  })
})
