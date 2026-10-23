/** Help articles (src/content/help/*.md): the help centre at /help, and each page's "?" link. */
import { defineCollection } from 'astro:content'
import { glob } from 'astro/loaders'
import { z } from 'astro/zod'
import { HELP_SECTIONS } from './lib/help'


const help = defineCollection({
  loader: glob({ pattern: '*.md', base: './src/content/help' }),
  schema: z.object({
    title: z.string(),
    /** One sentence for the help centre and search. */
    summary: z.string(),
    section: z.enum(HELP_SECTIONS),
    /** Order within its section. */
    order: z.number(),
  }),
})

export const collections = { help }
