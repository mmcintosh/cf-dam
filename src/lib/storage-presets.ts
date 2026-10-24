/** S3-compatible services offered when adding a storage connection, and the storage classes there are. */
export const ALL_CLASSES = ['STANDARD', 'INTELLIGENT_TIERING', 'STANDARD_IA', 'ONEZONE_IA', 'GLACIER_IR', 'GLACIER', 'DEEP_ARCHIVE']

export const PRESETS = {
  aws: { label: 'Amazon S3', endpoint: (r: string) => `https://s3.${r}.amazonaws.com`, region: 'us-east-1', pathStyle: false, classes: ALL_CLASSES },
  r2: { label: 'Cloudflare R2 (S3 API)', endpoint: () => 'https://<ACCOUNT_ID>.r2.cloudflarestorage.com', region: 'auto', pathStyle: true, classes: ['STANDARD', 'STANDARD_IA'] },
  b2: { label: 'Backblaze B2', endpoint: (r: string) => `https://s3.${r}.backblazeb2.com`, region: 'us-west-004', pathStyle: true, classes: ['STANDARD'] },
  wasabi: { label: 'Wasabi', endpoint: (r: string) => `https://s3.${r}.wasabisys.com`, region: 'us-east-1', pathStyle: true, classes: ['STANDARD'] },
  custom: { label: 'Other S3-compatible', endpoint: () => 'https://', region: 'us-east-1', pathStyle: true, classes: ['STANDARD'] },
} as const
export type PresetKey = keyof typeof PRESETS

/** Which service a connection's endpoint belongs to, for its kind ("Amazon S3", "Backblaze B2"…). */
export function serviceOf(endpoint: string | null): PresetKey {
  if (!endpoint) return 'custom'
  if (/amazonaws\.com/i.test(endpoint)) return 'aws'
  if (/r2\.cloudflarestorage\.com/i.test(endpoint)) return 'r2'
  if (/backblazeb2\.com/i.test(endpoint)) return 'b2'
  if (/wasabisys\.com/i.test(endpoint)) return 'wasabi'
  return 'custom'
}
