/** Due-date grouping shared by the task list and its tests. */

import type { TaskSummary } from '../types.ts'
import type { TaskLocaleKey } from './locales.ts'

/** Bucket one task falls into when the list groups by due date. */
export type TaskGroupKey = 'overdue' | 'today' | 'tomorrow' | 'week' | 'later' | 'none'

/** Buckets in display order. */
export const GROUP_ORDER: readonly TaskGroupKey[] = ['overdue', 'today', 'tomorrow', 'week', 'later', 'none']

/** Copy key naming each bucket. */
export const GROUP_LABELS: Readonly<Record<TaskGroupKey, TaskLocaleKey>> = {
  overdue: 'groupOverdue',
  today: 'groupToday',
  tomorrow: 'groupTomorrow',
  week: 'groupWeek',
  later: 'groupLater',
  none: 'groupNone',
}

/** Local calendar days after tomorrow that still count as this week. */
const WEEK_DAYS = 7

/** Milliseconds in one UTC day, used to compare calendar days without daylight-saving drift. */
const MS_PER_DAY = 86_400_000

/** One displayed group. */
export interface TaskGroup {
  /** Bucket these tasks share. */
  readonly key: TaskGroupKey
  /** Tasks in Host order. */
  readonly tasks: readonly TaskSummary[]
}

/**
 * Build one local day's `YYYY-MM-DD` value.
 * @param date - the instant.
 * @returns the local calendar day, or an empty string for an invalid instant.
 */
export function localDay(date: Date): string {
  if (Number.isNaN(date.getTime())) return ''
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`
}

/**
 * Group tasks by the local calendar day of their due instant.
 * @param tasks - normalized tasks in Host order.
 * @param now - instant the panel renders.
 * @returns non-empty groups in display order.
 */
export function groupTasks(tasks: readonly TaskSummary[], now: Date = new Date()): readonly TaskGroup[] {
  const todayIndex = dayIndex(localDay(now))
  const buckets = new Map<TaskGroupKey, TaskSummary[]>()
  for (const task of tasks) {
    const key = bucketOf(task.dueAt, todayIndex)
    const bucket = buckets.get(key)
    if (bucket === undefined) buckets.set(key, [task])
    else bucket.push(task)
  }
  const groups: TaskGroup[] = []
  for (const key of GROUP_ORDER) {
    const bucket = buckets.get(key)
    if (bucket !== undefined) groups.push({ key, tasks: bucket })
  }
  return groups
}

/**
 * Name the bucket one due instant belongs to, for row styling.
 * @param dueAt - due instant, or undefined when the task has no due date.
 * @param now - instant the panel renders.
 * @returns the bucket key.
 */
export function dueBucket(dueAt: string | undefined, now: Date = new Date()): TaskGroupKey {
  return bucketOf(dueAt, dayIndex(localDay(now)))
}

/**
 * Name the bucket one due instant belongs to relative to today's index.
 * @param dueAt - due instant, or undefined when the task has no due date.
 * @param todayIndex - index of the local day `now` falls on.
 * @returns the bucket key.
 */
function bucketOf(dueAt: string | undefined, todayIndex: number): TaskGroupKey {
  if (dueAt === undefined) return 'none'
  const day = localDay(new Date(dueAt))
  if (day === '') return 'none'
  const offset = dayIndex(day) - todayIndex
  if (offset < 0) return 'overdue'
  if (offset === 0) return 'today'
  if (offset === 1) return 'tomorrow'
  return offset <= WEEK_DAYS ? 'week' : 'later'
}

/**
 * Count whole calendar days between 1970-01-01 and one local day.
 * @param day - `YYYY-MM-DD`.
 * @returns the day index, or NaN for a malformed day.
 */
function dayIndex(day: string): number {
  const [year, month, date] = day.split('-').map(Number)
  if (year === undefined || month === undefined || date === undefined) return Number.NaN
  return Math.floor(Date.UTC(year, month - 1, date) / MS_PER_DAY)
}
