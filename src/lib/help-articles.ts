/**
 * The help articles in the reader's language: each English article, or its translation where there is one
 * (src/content/help/<lang>/<slug>.md). Slugs and sections stay those of the English article.
 */
import { getCollection, type CollectionEntry } from 'astro:content'
import type { UiLanguage } from '@cf-dam/i18n'

export interface HelpArticle {
  slug: string
  entry: CollectionEntry<'help'>
  /** False when the reader's language has no translation yet, so English is shown. */
  translated: boolean
}

export async function helpArticles(lang: UiLanguage): Promise<HelpArticle[]> {
  const all = await getCollection('help')
  const byId = new Map(all.map((entry) => [entry.id, entry]))
  return all
    .filter((entry) => !entry.id.includes('/'))
    .map((english) => {
      const translation = lang === 'en' ? undefined : byId.get(`${lang}/${english.id}`)
      return { slug: english.id, entry: translation ?? english, translated: lang === 'en' || translation !== undefined }
    })
    .sort((a, b) => a.entry.data.order - b.entry.data.order)
}
