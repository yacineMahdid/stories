import type { WorldTime } from '../shapes/types'

/**
 * World time: a numeric calendar (year, month, day, hour) shared by backstory events and
 * story pages, so everything can be placed on one chronology. Years can be negative.
 */

export const isSet = (t: WorldTime | null | undefined): t is WorldTime => t?.year != null

/** A sortable number. Missing parts sort to the start of their parent unit. */
export function timeKey(t: WorldTime): number {
  return (t.year ?? 0) * 1e6 + (t.month ?? 0) * 1e4 + (t.day ?? 0) * 1e2 + (t.hour ?? 0)
}

export function compareTime(a: WorldTime, b: WorldTime) {
  return timeKey(a) - timeKey(b)
}

/** True when two times describe the same moment to the precision both of them give. */
export function sameMoment(a: WorldTime, b: WorldTime) {
  if (!isSet(a) || !isSet(b)) return false
  return (['year', 'month', 'day', 'hour'] as const).every((k) => a[k] == null || b[k] == null || a[k] === b[k])
}

/** 15.5 → "15:30". */
export function formatHour(hour: number): string {
  const minutes = Math.round(hour * 60)
  return `${String(Math.floor(minutes / 60)).padStart(2, '0')}:${String(minutes % 60).padStart(2, '0')}`
}

/** "15:30", "15.5" or "15" → 15.5 (null when empty or not a time). */
export function parseHour(text: string): number | null {
  const v = text.trim()
  if (!v) return null
  const m = /^(\d{1,2})(?::(\d{1,2}))?$/.exec(v)
  if (m) return Number(m[1]) + (m[2] ? Number(m[2]) / 60 : 0)
  const n = Number(v)
  return isNaN(n) ? null : n
}

export function formatTime(t: WorldTime): string {
  if (!isSet(t)) return 'undated'
  const parts = [`Year ${t.year}`]
  if (t.month != null) parts.push(`month ${t.month}`)
  if (t.day != null) parts.push(`day ${t.day}`)
  let s = parts.join(', ')
  if (t.hour != null) s += `, ${formatHour(t.hour)}`
  return s
}

export function formatSpan(start: WorldTime, end: WorldTime): string {
  if (!isSet(end)) return formatTime(start)
  return `${formatTime(start)} → ${formatTime(end)}`
}

/** Has this event (or span) begun by time `t`? Is it still ongoing? */
export function relation(start: WorldTime, end: WorldTime, t: WorldTime): 'past' | 'ongoing' | 'future' {
  if (compareTime(start, t) > 0) return 'future'
  if (isSet(end) && compareTime(end, t) >= 0) return 'ongoing'
  return isSet(end) ? 'past' : compareTime(start, t) === 0 ? 'ongoing' : 'past'
}

export function ageAt(born: number | null, t: WorldTime): number | null {
  if (born == null || !isSet(t)) return null
  return t.year! - born
}
