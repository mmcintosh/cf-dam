/**
 * "Safari on macOS" from a User-Agent header, for the sessions list and the activity log. Rough on
 * purpose: enough to recognise your own browsers, not to fingerprint anyone.
 */
import { t } from '@cf-dam/i18n/client'

const BROWSERS: [RegExp, string][] = [
  [/Edg(e|A|iOS)?\//, 'Edge'],
  [/OPR\/|Opera/, 'Opera'],
  [/Firefox\/|FxiOS\//, 'Firefox'],
  [/Chrome\/|CriOS\//, 'Chrome'],
  [/Safari\//, 'Safari'],
  [/^curl\//, 'curl'],
]

const SYSTEMS: [RegExp, string][] = [
  [/iPhone/, 'iPhone'],
  [/iPad/, 'iPad'],
  [/Android/, 'Android'],
  [/CrOS/, 'ChromeOS'],
  [/Mac OS X|Macintosh/, 'macOS'],
  [/Windows/, 'Windows'],
  [/Linux/, 'Linux'],
]

export function describeUserAgent(userAgent: string | null | undefined): string {
  if (!userAgent) return t('browser.unknown')
  const browser = BROWSERS.find(([pattern]) => pattern.test(userAgent))?.[1]
  const system = SYSTEMS.find(([pattern]) => pattern.test(userAgent))?.[1]
  if (browser && system) return t('browser.on', { browser, system })
  return browser ?? system ?? t('browser.unknown')
}
