/**
 * Colour label names for display. The stored names stay as they are (XMP writes them, and Lightroom matches
 * them by name), but the built-in English defaults are shown in the reader's language. A name someone
 * chose is shown as they wrote it.
 */
import { DEFAULT_LABEL_NAMES, type LabelNames } from '@cf-dam/api'
import type { MessageKey, Translate } from '@cf-dam/i18n'

export function displayLabelNames(names: LabelNames, t: Translate): LabelNames {
  return Object.fromEntries(
    Object.entries(names).map(([colour, name]) => [colour, name === DEFAULT_LABEL_NAMES[colour as keyof LabelNames] ? t(`label.${colour}` as MessageKey) : name]),
  ) as LabelNames
}
