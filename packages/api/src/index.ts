import { Hono } from 'hono'
import { csrf } from 'hono/csrf'
import { HTTPException } from 'hono/http-exception'
import { createAuth } from './auth/auth'
import { authenticate } from './auth/principal'
import { handleAuthRequest } from './auth/guard'
import type { DamEnv } from './env'
import { activityRoutes } from './routes/activity'
import { agentRoutes } from './routes/agent'
import { aiRoutes } from './routes/ai'
import { alertRoutes } from './routes/alerts'
import { previewRoutes } from './routes/previews'
import { albumRoutes } from './routes/albums'
import { checkRoutes } from './routes/checks'
import { labelRoutes, tagRoutes } from './routes/keywords'
import { presetRoutes, savedSearchRoutes } from './routes/metadata'
import { assetRoutes } from './routes/assets'
import { backupRoutes } from './routes/backups'
import { clientRoutes } from './routes/clients'
import { jobRoutes } from './routes/jobs'
import { usageRoutes } from './routes/usage'
import { archiveRoutes } from './routes/archive'
import { connectionRoutes } from './routes/connections'
import { duplicateRoutes } from './routes/duplicates'
import { galleryRoutes } from './routes/gallery'
import { inviteRoutes } from './routes/invites'
import { runInLanguage } from '@cf-dam/i18n'
import { requestLanguage } from './lib/language'
import { mailRoutes } from './routes/mail'
import { meRoutes } from './routes/me'
import { setupRoutes } from './routes/setup'
import { shareRoutes } from './routes/shares'
import { sourceRoutes } from './routes/sources'
import { uploadRoutes } from './routes/uploads'
import { roleRoutes, userRoutes } from './routes/users'

export type { DamBindings, DamEnv } from './env'
export { ensureMigrated, migrate } from './db/migrate'
export { createAuth } from './auth/auth'
export { resolvePrincipal, principalJson, type Principal } from './auth/principal'
export { setupNeeded } from './routes/setup'
export { runSweep, type SweepResult } from './catalog/sweeper'
export { alertCount } from './catalog/alerts'
export { currentRestore as currentRestoreView } from './catalog/restore'
export { securityHeaders } from './lib/security-headers'
export { applyGalleryLanguage, languageCookie, readCookie, say, requestLanguage, setSiteLanguage, siteLanguage, pseudoAllowed, SITE_LANGUAGE_KEY, TIME_ZONE_COOKIE } from './lib/language'
export { wellKnownRoutes } from './routes/well-known'

export const API_VERSION = '0.1.0'

/** The DAM's JSON API, mounted by the app Worker at `/api`. */
export function createDamApi() {
  const api = new Hono<DamEnv>()

  // Cookie-authenticated form posts from another origin are refused. JSON requests can't be sent
  // cross-origin without a CORS preflight, which this API never grants.
  api.use('*', csrf())

  // Messages in the caller's language (packages/i18n). The site's Worker entry does the same for pages;
  // here too so the API on its own (tests, other mounts) speaks it.
  api.use('*', async (c, next) => runInLanguage(await requestLanguage(c.env, c.req.raw), next))

  api.get('/health', (c) =>
    c.json({
      ok: true,
      service: 'cf-dam',
      version: API_VERSION,
      bindings: {
        db: c.env?.DB !== undefined,
        mediaBucket: c.env?.MEDIA_BUCKET !== undefined,
      },
    }),
  )

  // Better Auth's endpoints, behind our limiter, password lockout and activity log (auth/guard.ts).
  api.on(['GET', 'POST'], '/auth/*', handleAuthRequest)

  api.route('/setup', setupRoutes)
  // Client galleries: no account, the link is the key (routes/gallery.ts).
  api.route('/public/galleries', galleryRoutes)
  // A new client choosing their password from their invite link (routes/invites.ts).
  api.route('/invites', inviteRoutes)

  api.use('*', authenticate())
  api.route('/me', meRoutes)
  api.route('/users', userRoutes)
  api.route('/activity', activityRoutes)
  api.route('/alerts', alertRoutes)
  api.route('/mail', mailRoutes)
  api.route('/roles', roleRoutes)
  api.route('/connections', connectionRoutes)
  api.route('/storage-checks', checkRoutes)
  api.route('/previews', previewRoutes)
  api.route('/backups', backupRoutes)
  api.route('/uploads', uploadRoutes)
  api.route('/assets', assetRoutes)
  api.route('/albums', albumRoutes)
  api.route('/shares', shareRoutes)
  api.route('/clients', clientRoutes)
  api.route('/jobs', jobRoutes)
  api.route('/usage', usageRoutes)
  api.route('/archive', archiveRoutes)
  api.route('/tags', tagRoutes)
  api.route('/labels', labelRoutes)
  api.route('/presets', presetRoutes)
  api.route('/saved-searches', savedSearchRoutes)
  api.route('/duplicates', duplicateRoutes)
  api.route('/ai', aiRoutes)
  api.route('/agent', agentRoutes)
  api.route('/sources', sourceRoutes)

  api.onError((error, c) => {
    // Middleware such as csrf() rejects by throwing; keep its status instead of turning it into a 500.
    if (error instanceof HTTPException) return error.getResponse()
    console.error('[api] unhandled error', error)
    return c.json({ error: 'internal_error' }, 500)
  })

  return api
}

// Server-side reads for the Astro pages (permissions are checked by the page middleware).
export { assetJson, COUNT_CAP, getAsset, getLocations, getTags, listAssets, parseListFilters, type AssetJson, type ListFilters } from './catalog/assets'
export { DEFAULT_LABEL_NAMES, facets, geoPoints, getLabelNames, timeline, type Facets, type FacetValue, type KeywordFacet, type LabelNames } from './catalog/library'
export { keywordTree, type KeywordNode } from './catalog/keywords'
export { IPTC_FIELDS, listPresets, type IptcField, type IptcKey, type Preset } from './catalog/iptc'
export { listSavedSearches, normalizeQuery, type SavedSearch } from './routes/metadata'
export { folderOf } from './catalog/agents'
export { LABELS, type Label } from './catalog/assets'
export { duplicateCounts, exactGroups, similarGroups, type DuplicateGroup } from './catalog/duplicates'
export { aiStats, getAiSettings, type AiSettings, type AiStats } from './catalog/ai'
export { facetProblems, facetsAvailable, facetStats, type FacetProblem, type FacetStats } from './catalog/jev-facets'
export { meaningAvailable, resolveNear } from './catalog/meaning'
export { DEFAULT_PREFERENCES, getPreferences, preferenceAttributes, type Preferences } from './catalog/preferences'
export { handleWork, type WorkMessage } from './catalog/work'
export { USD_PER_1000_NEURONS, VISION_MODELS, type VisionModel } from './catalog/vision'
export { galleryJson } from './routes/gallery'
export { CLIENT_ROLE, clientGalleries, isClientOnly, readInvite, type ClientGalleryJson, type MemberJson } from './catalog/clients'
export { clientDownloads, clientPeople, countPastClients, getClient, listClients, type ClientDownloadJson, type ClientJson, type ClientPersonJson, type ClientSummary } from './catalog/client-records'
export { jobArchiveStatus, ARCHIVE_JOB_CLASSES } from './catalog/archive-jobs'
export { albumStorage, jobRestoreStatus, jobStorage, type JobRestoreStatus, type JobStorage } from './catalog/job-storage'
export { filterSummary, getJob, jobAlbums, listJobs, needsAttention, KINDS, OPEN_STAGES, OPTIONAL_STAGES, STAGES, type AttentionJson, type JobAlbumJson, type JobJson, type JobSummary, type Kind, type Stage } from './catalog/jobs'
export { getStats, type StatsSnapshot } from './catalog/stats'
export { clientShares, jobShares, listShares, getShare, openGallery, recordEvent, shareVisitors, sharePicks, shareDownloads, DOWNLOAD_SIZES, type ShareJson, type VisitorJson, type GalleryItem, type DownloadSize } from './catalog/shares'
export { getWatermark, WATERMARK_POSITIONS, type WatermarkSettings } from './catalog/watermark'
export { browserOrigins, getConnection, listConnections, type Connection } from './storage/connections'
export { ARCHIVE_CLASSES, S3_STORAGE_CLASSES, RESTORE_TIERS } from './storage/types'
