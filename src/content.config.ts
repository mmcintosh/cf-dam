/**
 * Help articles: the help centre at /help, and each page's "?" link. English in src/content/help/<slug>.md;
 * translations in src/content/help/<lang>/<slug>.md (same slug, id `<lang>/<slug>`), each saying how far it's
 * been checked and which English text it was made from, so a changed English article shows them as stale.
 */
import { defineCollection } from 'astro:content'
import { glob } from 'astro/loaders'
import { z } from 'astro/zod'
import { HELP_SECTIONS } from './lib/help'

const help = defineCollection({
  loader: glob({ pattern: '**/*.md', base: './src/content/help' }),
  schema: z.object({
    title: z.string(),
    /** One sentence for the help centre and search. */
    summary: z.string(),
    section: z.enum(HELP_SECTIONS),
    /** Order within its section. */
    order: z.number(),
    /** Translations only: machine → ai-reviewed → ai-reviewed-2 → native-confirmed. */
    review: z.enum(['machine', 'ai-reviewed', 'ai-reviewed-2', 'native-confirmed']).optional(),
    /** Translations only: the first 12 hex of the SHA-256 of the English file they were made from. */
    source: z.string().optional(),
  }),
})

export const collections = { help }
