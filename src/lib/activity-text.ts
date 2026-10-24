/**
 * Activity log entries as sentences, for the Activity page. The API returns entries as stored
 * (packages/api/src/routes/activity.ts); an action without a sentence here falls back to its name.
 */
import { format, t } from '@cf-dam/i18n/client'
import type { MessageKey } from '@cf-dam/i18n'
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

const SIGN_IN_METHODS: Record<string, MessageKey> = {
  password: 'act.method.password',
  'password+code': 'act.method.passwordCode',
  'password+backup_code': 'act.method.passwordBackup',
  passkey: 'act.method.passkey',
  setup: 'act.method.setup',
}

// One whole sentence per kind of change, so each language can place the photo count where it belongs.
const BULK: Record<string, MessageKey> = {
  'tag-add': 'act.bulk.tagAdd',
  'tag-remove': 'act.bulk.tagRemove',
  rating: 'act.bulk.rating',
  flag: 'act.bulk.flag',
  label: 'act.bulk.label',
  preset: 'act.bulk.preset',
  gps: 'act.bulk.gps',
  title: 'act.bulk.title',
  caption: 'act.bulk.caption',
  'album-add': 'act.bulk.albumAdd',
  delete: 'act.bulk.delete',
  'ai-queue': 'act.bulk.aiQueue',
  'ai-accept': 'act.bulk.aiAccept',
  people: 'act.bulk.people',
}

const SCOPES: Record<string, MessageKey> = { admins: 'act.scope.admins', everyone: 'act.scope.everyone' }
const ROLES = ['admin', 'editor', 'viewer', 'client']
const STAGES = ['booked', 'shot', 'editing', 'proofing', 'final_edits', 'delivered', 'completed', 'cancelled']

const nameOf = (p: ActivityPerson | null | undefined, fallback?: string) => p?.name || p?.email || fallback || t('act.someone')
const str = (v: unknown) => (typeof v === 'string' ? v : '')
const num = (v: unknown) => (typeof v === 'number' ? format().number(v) : '?')
const roles = (v: unknown[]) => format().list(v.map((r) => (ROLES.includes(String(r)) ? t(`role.${r}` as MessageKey) : String(r))))

/** An alert's sentence as stored with it (packages/api/src/catalog/alerts.ts), in the reader's language. */
function alertText(v: unknown): string {
  const text = v as { key?: string; params?: Record<string, string | number> } | null
  if (typeof text?.key !== 'string') return ''
  const stage = text.params?.stage
  const params = typeof stage === 'string' ? { ...text.params, stage: t(`alert.stage.${stage}` as MessageKey) } : text.params
  const sentence = t(text.key as MessageKey, params)
  return sentence === text.key ? '' : sentence.replace(`alert.stage.${String(stage)}`, String(stage))
}

export function describeActivity(e: ActivityEntry): string {
  const who = nameOf(e.actor)
  // Done to an account: the person, or, once deleted, the email the entry kept.
  const whom = e.target?.type === 'user' ? nameOf(e.target, str(e.details?.email) || t('act.deletedPerson')) : ''
  const d = e.details ?? {}

  switch (e.action) {
    case 'auth.signed_in': {
      const method = SIGN_IN_METHODS[str(d.method)] ? t(SIGN_IN_METHODS[str(d.method)]) : str(d.method)
      return d.userAgent
        ? t('act.signedInFrom', { who, method, browser: describeUserAgent(str(d.userAgent)) })
        : t('act.signedIn', { who, method })
    }
    case 'auth.sign_in_failed':
      return typeof d.failures === 'number' && d.failures > 1
        ? t('act.signInFailedRow', { whom, count: d.failures })
        : t('act.signInFailed', { whom })
    case 'auth.locked':
      return t('act.locked', { whom })
    case 'auth.passkey_required':
      return t('act.passkeyRequired', { whom })
    case 'account.password_changed':
      return t('act.passwordChanged', { who })
    case 'account.two_factor_on':
      return t('act.twoFactorOn', { who })
    case 'account.two_factor_off':
      return t('act.twoFactorOff', { who })
    case 'account.passkey_added':
      return t('act.passkeyAdded', { who })
    case 'account.passkey_removed':
      return t('act.passkeyRemoved', { who })
    case 'account.session_ended':
      return t('act.sessionEnded', { who })
    case 'account.signed_out_elsewhere':
      return t('act.signedOutElsewhere', { who, count: typeof d.sessions === 'number' ? d.sessions : 0 })
    case 'setup.admin_created':
      return t('act.setup', { who })
    case 'policy.two_factor':
      return d.requiredFor === 'nobody'
        ? t('act.policyOptional', { who })
        : t('act.policyRequired', { who, scope: SCOPES[str(d.requiredFor)] ? t(SCOPES[str(d.requiredFor)]) : str(d.requiredFor) })
    case 'user.created':
      return Array.isArray(d.roles) ? t('act.userCreatedAs', { who, whom, roles: roles(d.roles) }) : t('act.userCreated', { who, whom })
    case 'user.updated': {
      const parts = [
        Array.isArray(d.roles) ? t('act.part.roles', { roles: roles(d.roles) }) : '',
        d.isActive === false ? t('act.part.deactivated') : d.isActive === true ? t('act.part.reactivated') : '',
        d.name ? t('act.part.renamed') : '',
      ].filter(Boolean)
      return parts.length ? t('act.userUpdatedParts', { who, whom, changes: format().list(parts) }) : t('act.userUpdated', { who, whom })
    }
    case 'user.password_reset':
      return t('act.passwordReset', { who, whom })
    case 'user.two_factor_reset':
      return t(d.passkeys ? 'act.twoFactorResetPasskeys' : 'act.twoFactorReset', { who, whom })
    case 'user.unlocked':
      return t('act.unlocked', { who, whom })
    case 'user.signed_out':
      return t('act.signedOutUser', { who, whom })
    case 'user.deleted':
      return t('act.userDeleted', { who, whom })
    case 'api_key.created':
      return t('act.apiKeyCreated', { who })
    case 'api_key.revoked':
      return t('act.apiKeyRevoked', { who })
    case 'asset.uploaded':
      return t('act.assetUploaded', { who })
    case 'asset.deleted':
      return t('act.assetDeleted', { who })
    case 'asset.storage_class_changed':
      return t('act.storageClassChanged', { who, class: str(d.to) || t('act.anotherClass') })
    case 'asset.restore_requested':
      return t('act.restoreRequested', { who })
    case 'duplicates.resolved':
      return t('act.duplicatesResolved', { who })
    case 'keyword.merged':
      return t('act.keywordMerged', { who })
    case 'keyword.deleted':
      return t('act.keywordDeleted', { who })
    case 'storage.connection_created':
      return t('act.connectionCreated', { who })
    case 'storage.imported':
      return t('act.imported', { who })
    case 'source.paired':
      return t('act.sourcePaired', { who })
    case 'source.revoked':
      return t('act.sourceRevoked', { who })
    case 'album.renamed':
      return t('act.albumRenamed', { who, from: str(d.from), to: str(d.to) })
    case 'album.deleted':
      return typeof d.links === 'number' && d.links > 0
        ? t('act.albumDeletedLinks', { who, name: str(d.name), links: t('albumTools.links', { count: d.links }) })
        : t('act.albumDeleted', { who, name: str(d.name) })
    case 'share.create':
      return t('act.shareCreate', { who })
    case 'share.revoke':
      return t('act.shareRevoke', { who })
    case 'client.invited':
      return t('act.clientInvited', { who, email: str(d.email) || t('act.aClient') })
    case 'client.joined':
      return t('act.clientJoined', { who })
    case 'client.removed':
      return t('act.clientRemoved', { who, whom: whom || t('act.aClient') })
    case 'client.created':
      return t('act.clientCreated', { who, name: str(d.name) || t('act.aClient') })
    case 'client.updated':
      return t('act.clientUpdated', { who, name: str(d.name) || t('act.aClient') })
    case 'client.past':
      return t('act.clientPast', { who, name: str(d.name) || t('act.aClient') })
    case 'client.current':
      return t('act.clientCurrent', { who, name: str(d.name) || t('act.aClient') })
    case 'client.linked':
      return t('act.clientLinked', { who, whom: whom || t('act.aClient') })
    case 'client.unlinked':
      return t('act.clientUnlinked', { who, whom: whom || t('act.aClient') })
    case 'client.erased':
      return t('act.clientErased', { who })
    case 'job.created':
      return t('act.jobCreated', { who, title: str(d.title) || t('act.aJob') })
    case 'job.updated':
      return t('act.jobUpdated', { who, title: str(d.title) || t('act.aJob') })
    case 'job.deleted':
      return t('act.jobDeleted', { who, title: str(d.title) || t('act.aJob') })
    case 'job.archived':
      return t('act.jobArchived', { count: num(d.photos), title: str(d.title) || t('act.aJob') })
    case 'job.archive_now':
      return t('act.jobArchiveNow', { who, title: str(d.title) || t('act.aJob') })
    case 'archive.settings_changed':
      return t('act.archiveSettings', { who })
    case 'job.restore':
      return t('act.jobRestore', { who, count: num(d.photos), title: str(d.title) || t('act.aJob') })
    case 'job.album_added':
      return t('act.jobAlbumAdded', { who, title: str(d.title) || t('act.aJob') })
    case 'job.stage': {
      const title = str(d.title) || t('act.aJob')
      const stage = STAGES.includes(str(d.to)) ? t(`job.stage.${str(d.to)}` as MessageKey) : str(d.to)
      // Moved by the sweep when photos arrived, or by a gallery ticked "Final delivery".
      if (d.by === 'photos') return t('act.jobStageAuto', { title, stage })
      if (d.by === 'final_delivery') return t('act.jobDelivered', { who, title })
      return t('act.jobStage', { who, title, stage })
    }
    case 'watermark.set':
      return t('act.watermarkSet', { who })
    case 'ai.settings_changed':
      return t('act.aiSettings', { who })
    case 'ai.backfill_queued':
      return t('act.aiBackfill', { who })
    case 'ai.facets_queued':
      return t('act.facetsQueued', { who })
    case 'storage.check_problem': {
      const where = str(d.connection) || t('act.itsStore')
      return t(d.result === 'missing' ? 'act.checkMissing' : d.result === 'changed' ? 'act.checkChanged' : 'act.checkUnreadable', { where })
    }
    case 'backup.started':
      return t('act.backupStarted', { who })
    case 'backup.done':
      return typeof d.rows === 'number' ? t('act.backupDoneRows', { rows: num(d.rows) }) : t('act.backupDone')
    case 'backup.failed':
      return str(d.error) ? t('act.backupFailedWhy', { error: str(d.error) }) : t('act.backupFailed')
    case 'backup.settings_changed':
      return t(d.connectionId ? 'act.backupSettings' : 'act.backupOff', { who })
    case 'previews.check_started':
      return t('act.previewsCheckStarted', { who })
    case 'previews.checked':
      return t('act.previewsChecked', { checked: num(d.checked), missing: num(d.missing) })
    case 'alert.dismissed': {
      const message = alertText(d.text) || str(d.message)
      return message ? t('act.alertDismissedWhy', { who, message }) : t('act.alertDismissed', { who })
    }
  }
  if (e.action.startsWith('asset.bulk_')) {
    const kind = e.action.slice('asset.bulk_'.length)
    const photos = typeof d.count === 'number' ? t('common.photos', { count: d.count }) : t('act.somePhotos')
    return BULK[kind] ? t(BULK[kind], { who, photos }) : t('act.bulk.changed', { who, photos, kind })
  }
  return t('act.unknown', { who, action: e.action })
}
