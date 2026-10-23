/** The help centre's sections, in order. Kept apart from content.config.ts so pages that use them don't pull the file loader into the Worker. */
export const HELP_SECTIONS = [
  'Getting started',
  'Your photos',
  'Sharing',
  'Where photos are kept',
  'Computers and NAS',
  'People and security',
  'Settings',
] as const
