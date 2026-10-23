/**
 * Activity log entries as sentences, for the Activity page. The API returns entries as stored
 * (packages/api/src/routes/activity.ts); an action without a sentence here falls back to its name.
 */
import { describeUserAgent } from './user-agent'

export interface ActivityPerson {
  id: string | null
  name: string | null
  email: string | null
}

export interface ActivityEntry {
  id: string
  at: string
  action: string
  actor: ActivityPerson | null
  target: (ActivityPerson & { type: string }) | null
  details: Record<string, unknown> | null
  ipAddress: string | null
}

const SIGN_IN_METHODS: Record<string, string> = {
  password: 'a password',
  'password+code': 'a password and a code',
  'password+backup_code': 'a password and a backup code',
  passkey: 'a passkey',
  setup: 'the setup page',
}

const BULK: Record<string, string> = {
  'tag-add': 'added keywords to',
  'tag-remove': 'removed keywords from',
  rating: 'rated',
  flag: 'flagged',
  label: 'labelled',
  preset: 'applied a preset to',
  gps: 'set the place of',
  title: 'set the title of',
  caption: 'set the caption of',
  'album-add': 'added to an album',
  delete: 'deleted',
  'ai-queue': 'queued AI review for',
  'ai-accept': 'accepted AI suggestions for',
}

const SCOPES: Record<string, string> = { nobody: 'nobody', admins: 'administrators', everyone: 'everyone' }

const nameOf = (p: ActivityPerson | null | undefined, fallback = 'Someone') => p?.name || p?.email || fallback
const plural = (n: unknown, one: string) => (typeof n === 'number' ? `${n} ${n === 1 ? one : `${one}s`}` : `some ${one}s`)
const str = (v: unknown) => (typeof v === 'string' ? v : '')

export function describeActivity(e: ActivityEntry): string {
  const who = nameOf(e.actor)
  // Done to an account: the person, or, once deleted, the email the entry kept.
  const whom = e.target?.type === 'user' ? nameOf(e.target, str(e.details?.email) || 'a deleted person') : ''
  const d = e.details ?? {}

  switch (e.action) {
    case 'auth.signed_in': {
      const method = SIGN_IN_METHODS[str(d.method)] ?? str(d.method)
      const from = d.userAgent ? ` from ${describeUserAgent(str(d.userAgent))}` : ''
      return `${who} signed in with ${method}${from}`
    }
    case 'auth.sign_in_failed':
      return `Wrong password for ${whom}${typeof d.failures === 'number' && d.failures > 1 ? ` (${d.failures} in a row)` : ''}`
    case 'auth.locked':
      return `${whom}'s password sign-in was locked after too many wrong passwords`
    case 'auth.passkey_required':
      return `${whom} gave the right password alone and was asked to use their passkey`
    case 'account.password_changed':
      return `${who} changed their password`
    case 'account.two_factor_on':
      return `${who} turned on sign-in codes`
    case 'account.two_factor_off':
      return `${who} turned off sign-in codes`
    case 'account.passkey_added':
      return `${who} added a passkey`
    case 'account.passkey_removed':
      return `${who} removed a passkey`
    case 'account.session_ended':
      return `${who} signed out another browser`
    case 'account.signed_out_elsewhere':
      return `${who} signed out of ${plural(d.sessions, 'other browser')}`
    case 'setup.admin_created':
      return `${who} set up the archive`
    case 'policy.two_factor':
      return d.requiredFor === 'nobody' ? `${who} made two-factor sign-in optional` : `${who} required two-factor sign-in for ${SCOPES[str(d.requiredFor)] ?? str(d.requiredFor)}`
    case 'user.created':
      return `${who} added ${whom}${Array.isArray(d.roles) ? ` as ${d.roles.join(', ')}` : ''}`
    case 'user.updated': {
      const parts = [
        Array.isArray(d.roles) ? `made them ${d.roles.join(', ')}` : '',
        d.isActive === false ? 'deactivated them' : d.isActive === true ? 'reactivated them' : '',
        d.name ? 'renamed them' : '',
      ].filter(Boolean)
      return `${who} changed ${whom}${parts.length ? `: ${parts.join(', ')}` : ''}`
    }
    case 'user.password_reset':
      return `${who} set a temporary password for ${whom}`
    case 'user.two_factor_reset':
      return `${who} reset ${whom}'s codes${d.passkeys ? ' and passkeys' : ''}`
    case 'user.unlocked':
      return `${who} unlocked ${whom}'s password sign-in`
    case 'user.signed_out':
      return `${who} signed ${whom} out everywhere`
    case 'user.deleted':
      return `${who} deleted ${whom}`
    case 'api_key.created':
      return `${who} made an API key`
    case 'api_key.revoked':
      return `${who} revoked an API key`
    case 'asset.uploaded':
      return `${who} uploaded a photo`
    case 'asset.deleted':
      return `${who} deleted a photo`
    case 'asset.storage_class_changed':
      return `${who} moved a photo's original to ${str(d.to) || 'another storage class'}`
    case 'asset.restore_requested':
      return `${who} asked for an archived original back`
    case 'duplicates.resolved':
      return `${who} resolved duplicates`
    case 'keyword.merged':
      return `${who} merged keywords`
    case 'keyword.deleted':
      return `${who} deleted a keyword`
    case 'storage.connection_created':
      return `${who} added a storage connection`
    case 'storage.imported':
      return `${who} imported photos from storage`
    case 'source.paired':
      return `${who} connected an agent`
    case 'source.revoked':
      return `${who} disconnected an agent`
    case 'album.renamed':
      return `${who} renamed the album “${str(d.from)}” to “${str(d.to)}”`
    case 'album.deleted':
      return `${who} deleted the album “${str(d.name)}”${typeof d.links === 'number' && d.links > 0 ? ` and its ${plural(d.links, 'client gallery link')}` : ''}`
    case 'share.create':
      return `${who} made a client gallery link`
    case 'share.revoke':
      return `${who} revoked a client gallery link`
    case 'client.invited':
      return `${who} invited ${str(d.email) || 'a client'} to a client gallery`
    case 'client.joined':
      return `${who} chose a password and joined as a client`
    case 'client.removed':
      return `${who} took ${whom || 'a client'} off a client gallery`
    case 'watermark.set':
      return `${who} changed the watermark`
    case 'ai.settings_changed':
      return `${who} changed the AI review settings`
    case 'ai.backfill_queued':
      return `${who} queued AI review for the library`
    case 'storage.check_problem': {
      const where = str(d.connection) || 'its store'
      const what = d.result === 'missing' ? `is missing from ${where}` : d.result === 'changed' ? `has changed in ${where}` : `couldn't be checked in ${where}`
      return `Storage check: a photo's original ${what}`
    }
    case 'backup.started':
      return `${who} started a catalog backup`
    case 'backup.done':
      return `The catalog was backed up${typeof d.rows === 'number' ? ` (${d.rows.toLocaleString()} rows)` : ''}`
    case 'backup.failed':
      return `A catalog backup failed${str(d.error) ? `: ${str(d.error)}` : ''}`
    case 'backup.settings_changed':
      return d.connectionId ? `${who} changed the backup settings` : `${who} turned catalog backups off`
    case 'previews.check_started':
      return `${who} started a check of every preview`
    case 'previews.checked':
      return `Previews checked: ${typeof d.checked === 'number' ? d.checked.toLocaleString() : '?'}, of which ${typeof d.missing === 'number' ? d.missing.toLocaleString() : '?'} were missing and are being made again`
    case 'alert.dismissed':
      return `${who} dismissed an alert${str(d.message) ? `: ${str(d.message)}` : ''}`
  }
  if (e.action.startsWith('asset.bulk_')) {
    const verb = BULK[e.action.slice('asset.bulk_'.length)] ?? `changed (${e.action.slice('asset.bulk_'.length)})`
    return `${who} ${verb} ${plural(d.count, 'photo')}`
  }
  return `${who}: ${e.action}`
}
