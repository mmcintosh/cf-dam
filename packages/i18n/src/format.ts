/**
 * Dates, numbers, sizes and sorting for a language, through Intl. Times show in the person's time zone
 * when it's known (the browser reports it); until then in UTC, labelled as such.
 */
import { intlTag, type UiLanguage } from './languages'

export interface Format {
  date(value: Date | string | number): string
  dateTime(value: Date | string | number): string
  time(value: Date | string | number): string
  number(value: number, options?: Intl.NumberFormatOptions): string
  /** File sizes in the language's own units (French "Mo", German "MB"…), powers of 1024 as before. */
  bytes(value: number): string
  /** "3 days ago", "in 2 hours". */
  relative(value: Date | string | number, now?: number): string
  /** "a, b and c". */
  list(items: readonly string[]): string
  /** Sort names as the language does (accents, case), not A–Z by code point. */
  compare(a: string, b: string): number
}

const UNITS = ['byte', 'kilobyte', 'megabyte', 'gigabyte', 'terabyte'] as const

const toDate = (value: Date | string | number) => (value instanceof Date ? value : new Date(value))

export function createFormat(lang: UiLanguage, timeZone?: string): Format {
  const tag = intlTag(lang)
  // An unknown zone would throw; fall back to UTC rather than break the page.
  let zone = 'UTC'
  try {
    if (timeZone) {
      new Intl.DateTimeFormat('en', { timeZone }).format(0)
      zone = timeZone
    }
  } catch {}
  // Intl won't take dateStyle/timeStyle with a zone name, so a labelled time spells out its fields.
  const labelled = zone === 'UTC' && !timeZone
  const clock = { hour: 'numeric', minute: '2-digit' } as const
  const day = { year: 'numeric', month: 'short', day: 'numeric' } as const
  const date = new Intl.DateTimeFormat(tag, { dateStyle: 'medium', timeZone: zone })
  const dateTime = labelled
    ? new Intl.DateTimeFormat(tag, { ...day, ...clock, timeZone: zone, timeZoneName: 'short' })
    : new Intl.DateTimeFormat(tag, { dateStyle: 'medium', timeStyle: 'short', timeZone: zone })
  const time = labelled ? new Intl.DateTimeFormat(tag, { ...clock, timeZone: zone, timeZoneName: 'short' }) : new Intl.DateTimeFormat(tag, { timeStyle: 'short', timeZone: zone })
  const relative = new Intl.RelativeTimeFormat(tag, { numeric: 'auto' })
  const list = new Intl.ListFormat(tag, { type: 'conjunction' })
  const collator = new Intl.Collator(tag, { sensitivity: 'base', numeric: true })

  return {
    date: (v) => date.format(toDate(v)),
    dateTime: (v) => dateTime.format(toDate(v)),
    time: (v) => time.format(toDate(v)),
    number: (v, options) => new Intl.NumberFormat(tag, options).format(v),
    bytes(value) {
      let unit = 0
      let n = Math.max(0, value)
      while (n >= 1024 && unit < UNITS.length - 1) {
        n /= 1024
        unit += 1
      }
      return new Intl.NumberFormat(tag, { style: 'unit', unit: UNITS[unit], unitDisplay: 'short', maximumFractionDigits: unit === 0 ? 0 : n < 10 ? 1 : 0 }).format(n)
    },
    relative(v, now = Date.now()) {
      const seconds = Math.round((toDate(v).getTime() - now) / 1000)
      const steps: [Intl.RelativeTimeFormatUnit, number][] = [
        ['year', 31_536_000],
        ['month', 2_592_000],
        ['week', 604_800],
        ['day', 86_400],
        ['hour', 3_600],
        ['minute', 60],
      ]
      for (const [unit, size] of steps) {
        if (Math.abs(seconds) >= size) return relative.format(Math.round(seconds / size), unit)
      }
      return relative.format(seconds, 'second')
    },
    list: (items) => list.format(items),
    compare: (a, b) => collator.compare(a, b),
  }
}
