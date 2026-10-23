/**
 * IPTC field and group names in the reader's language. The API keeps English names (IPTC_FIELDS); pages
 * show these instead, falling back to the API's name for a field this list doesn't know.
 */
import type { MessageKey } from '@cf-dam/i18n'
import { t } from '@cf-dam/i18n/client'

const FIELDS = new Set(['headline', 'creator', 'creatorTitle', 'credit', 'source', 'copyright', 'usageTerms', 'copyrightUrl', 'contactEmail', 'contactPhone', 'contactUrl', 'sublocation', 'city', 'state', 'country', 'countryCode', 'jobId', 'instructions'])
const GROUPS = new Set(['Description', 'Rights', 'Contact', 'Location', 'Workflow'])

export const iptcLabel = (field: { key: string; label: string }): string => (FIELDS.has(field.key) ? t(`iptc.field.${field.key}` as MessageKey) : field.label)
export const iptcGroup = (group: string): string => (GROUPS.has(group) ? t(`iptc.group.${group}` as MessageKey) : group)
