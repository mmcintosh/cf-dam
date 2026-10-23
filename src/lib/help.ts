import type { MessageKey } from '@cf-dam/i18n'

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

/** Each section's name in the reader's language (the English names above are the articles' own values). */
export const HELP_SECTION_KEYS: Record<(typeof HELP_SECTIONS)[number], MessageKey> = {
  'Getting started': 'helpSection.gettingStarted',
  'Your photos': 'helpSection.yourPhotos',
  Sharing: 'helpSection.sharing',
  'Where photos are kept': 'helpSection.whereKept',
  'Computers and NAS': 'helpSection.computers',
  'People and security': 'helpSection.people',
  Settings: 'helpSection.settings',
}

