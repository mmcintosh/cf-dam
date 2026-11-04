/**
 * A gallery is open through the whole of its last day, in the time zone of whoever sets it: `expiresAt` is the start
 * of the next day there. Both directions use the browser's own calendar (not UTC, and not "+24 hours", which is an
 * hour out on the days clocks change), so editing a gallery and saving it again keeps the same last day.
 */
const pad = (n: number) => String(n).padStart(2, '0')

/** The last day a link works ('YYYY-MM-DD'), from when it closes. */
export function lastDay(expiresAt: string | number | Date): string {
  const d = new Date(new Date(expiresAt).getTime() - 1)
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`
}

/** When a link closes (ISO), given its last day ('YYYY-MM-DD'): the start of the following day. */
export function closesAt(day: string): string {
  const [y, m, d] = day.split('-').map(Number) as [number, number, number]
  return new Date(y, m - 1, d + 1).toISOString()
}
