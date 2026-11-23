/** Month arithmetic for the grid: current month's 42-cell coverage, in UTC days. */

/** Days a fixed six-row grid covers. */
const GRID_DAYS = 42

/** Milliseconds in one day. */
const DAY_MS = 86_400_000

/**
 * Shift a `YYYY-MM` month key by whole months.
 * @param month - current month key.
 * @param delta - months to move; negative moves backwards.
 * @returns the shifted month key.
 */
export function shiftMonth(month: string, delta: number): string {
  const { year, monthIndex } = parseMonth(month)
  const shifted = new Date(Date.UTC(year, monthIndex + delta, 1))
  return `${shifted.getUTCFullYear()}-${String(shifted.getUTCMonth() + 1).padStart(2, '0')}`
}

/**
 * Day the month grid starts on, in UTC.
 * @param month - month key.
 * @param weekStart - first column of the grid.
 * @returns the ISO `YYYY-MM-DD` date of the grid's first cell.
 */
export function gridStart(month: string, weekStart: 'monday' | 'sunday'): string {
  const { year, monthIndex } = parseMonth(month)
  const first = new Date(Date.UTC(year, monthIndex, 1))
  const weekday = first.getUTCDay()
  const offset = weekStart === 'monday' ? (weekday + 6) % 7 : weekday
  return isoDate(new Date(first.getTime() - offset * DAY_MS))
}

/**
 * Half-open range one month view reads.
 * @param month - month key.
 * @param weekStart - first column of the grid.
 * @returns ISO `YYYY-MM-DD` bounds; `end` is the day after the grid's last cell.
 */
export function monthRange(month: string, weekStart: 'monday' | 'sunday'): { readonly start: string; readonly end: string } {
  const start = new Date(`${gridStart(month, weekStart)}T00:00:00Z`)
  return { start: isoDate(start), end: isoDate(new Date(start.getTime() + GRID_DAYS * DAY_MS)) }
}

/**
 * Month key of one instant in local time.
 * @param date - instant to name.
 * @returns the `YYYY-MM` key.
 */
export function monthKey(date: Date): string {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}`
}

/**
 * Split one month key into its UTC-arithmetic parts.
 * @param month - month key in `YYYY-MM`.
 * @returns the year and the zero-based month index.
 * @throws when the key is not two dash-separated numbers.
 */
function parseMonth(month: string): { readonly year: number; readonly monthIndex: number } {
  const [yearText = '', monthText = ''] = month.split('-')
  const year = Number(yearText)
  const monthNumber = Number(monthText)
  if (!Number.isInteger(year) || !Number.isInteger(monthNumber) || monthNumber < 1 || monthNumber > 12) {
    throw new Error(`feishu-calendar: invalid month key "${month}"`)
  }
  return { year, monthIndex: monthNumber - 1 }
}

/**
 * Format one UTC day as `YYYY-MM-DD`.
 * @param date - the day.
 * @returns the ISO date.
 */
function isoDate(date: Date): string {
  return date.toISOString().slice(0, 10)
}
