/**
 * AI review of photos with Workers AI: tags, alt text, a caption, a short scene description (for
 * describe-it search), a people count and a quality grade, in one call per photo.
 *
 * The model sees a 1024 px JPEG made from the stored preview, never the original, so an archived
 * original can still be analysed and the cost doesn't grow with file size. Models are swappable
 * (settings); two input styles are supported: chat messages with an image part (Llama 4 Scout,
 * Mistral Small 3.1, Gemma 4) and Moondream's query task.
 */
import { countedImages } from '../lib/images'
import type { DamBindings } from '../env'
import { renditionStore } from '../storage/connections'
import { renditionKey } from './renditions'
import type { Language } from '@cf-dam/i18n'

export interface VisionModel {
  id: string
  label: string
  style: 'chat' | 'moondream'
  /** Supports response_format json_schema, so the output shape is enforced by the model server. */
  jsonSchema: boolean
  /** Writes Spanish, German, French and Italian well (spike S3, 2026-10-23); otherwise it writes English. */
  languages: boolean
  note: string
}

export const VISION_MODELS: readonly VisionModel[] = [
  // Measured 2026-10-17 on Workers AI (one 1024 px JPEG): seconds and neurons per photo.
  { id: '@cf/mistralai/mistral-small-3.1-24b-instruct', label: 'Mistral Small 3.1', style: 'chat', jsonSchema: false, languages: true, note: 'Default. Fastest full model (~3 s), richest descriptions, ~41 neurons.' },
  { id: '@cf/meta/llama-4-scout-17b-16e-instruct', label: 'Llama 4 Scout', style: 'chat', jsonSchema: true, languages: true, note: 'Concise single-word tags, ~12 s, ~56 neurons.' },
  { id: '@cf/google/gemma-4-26b-a4b-it', label: 'Gemma 4', style: 'chat', jsonSchema: false, languages: true, note: 'Cheapest full model (~26 neurons), ~16 s.' },
  { id: '@cf/moondream/moondream3.1-9B-A2B', label: 'Moondream 3.1', style: 'moondream', jsonSchema: false, languages: false, note: 'Fastest (~1.5 s, ~29 neurons); simpler tags, no quality grade.' },
]
export const DEFAULT_VISION_MODEL = VISION_MODELS[0]!.id
/** Workers AI's published price per 1,000 neurons, for estimates shown to people. */
export const USD_PER_1000_NEURONS = 0.011

export const QUALITY = ['excellent', 'good', 'fair', 'poor'] as const
export type Quality = (typeof QUALITY)[number]

export interface VisionResult {
  tags: string[]
  alt: string
  caption: string
  description: string
  people: number
  quality: Quality | null
  /** Text visible in the picture (signs, shirts, documents), as written. Empty when there is none. */
  text: string
  /** Tokens (and neurons, Workers AI's billing unit) when the model reports them. */
  usage: { prompt: number; completion: number; neurons: number | null } | null
}

export interface VisionContext {
  /** Free text from settings, e.g. "Wedding and landscape photographer in western Norway". */
  photographer?: string | null
  filename?: string
  existingKeywords?: string[]
  capturedAt?: string | null
  /** The language to write in; English when absent. */
  language?: Language
}

/** How the prompt names each language: in English (the instructions are English), then in itself. */
const WRITE_IN: Record<Language, string> = { en: 'English', es: 'Spanish (español)', de: 'German (Deutsch)', fr: 'French (français)', it: 'Italian (italiano)' }

const SCHEMA = {
  type: 'object',
  properties: {
    tags: { type: 'array', items: { type: 'string' }, description: '8 to 15 lowercase search keywords' },
    alt: { type: 'string', description: 'Alt text for screen readers, under 125 characters' },
    caption: { type: 'string', description: 'One or two sentence caption' },
    description: { type: 'string', description: 'What is in the picture, for search: subjects, setting, colours, light, mood' },
    people: { type: 'integer', description: 'Number of people visible' },
    quality: { type: 'string', enum: [...QUALITY], description: 'Technical quality: focus, exposure, noise' },
    text: { type: 'string', description: 'Any readable text in the picture, exactly as written; empty if none' },
  },
  required: ['tags', 'alt', 'caption', 'description', 'people', 'quality', 'text'],
} as const

export function buildPrompt(context: VisionContext): string {
  const hints = [
    context.photographer ? `About the photographer: ${context.photographer}` : null,
    context.filename ? `File name: ${context.filename}` : null,
    context.capturedAt ? `Taken: ${context.capturedAt}` : null,
    context.existingKeywords?.length ? `Keywords already on the photo: ${context.existingKeywords.slice(0, 20).join(', ')}` : null,
  ].filter(Boolean)
  return [
    'You catalogue photos for a professional photo archive. Describe only what is visible; do not guess names of people or places unless they are unmistakable or given below.',
    ...hints,
    'Reply with JSON only, no prose, in exactly this shape:',
    // German capitalises nouns, so its tags aren't asked to be lowercase.
    `{"tags": ["8 to 15 ${context.language === 'de' ? '' : 'lowercase '}search keywords"], "alt": "alt text under 125 characters", "caption": "one or two sentences", "description": "subjects, setting, colours, light and mood", "people": 0, "quality": "excellent | good | fair | poor", "text": "readable text in the picture exactly as written (signs, shirts, documents), at most 500 characters, or empty"}`,
    // Last, so it outweighs the English of the shape above (a first try left alt and tags in English).
    ...(context.language && context.language !== 'en'
      ? [
          `Language: write every tag, the alt text, the caption and the description in ${WRITE_IN[context.language]}, not English.${context.language === 'de' ? ' Capitalise nouns in tags as German does.' : ''} Only the JSON keys and the quality value stay in English, and "text" is copied exactly as written in the picture.`,
        ]
      : []),
  ].join('\n')
}

/** Pull the first JSON object out of a model reply (models sometimes wrap it in prose or fences). */
export function extractJson(text: string): unknown {
  const fenced = /```(?:json)?\s*([\s\S]*?)```/.exec(text)?.[1]
  const candidate = fenced ?? text
  const start = candidate.indexOf('{')
  const end = candidate.lastIndexOf('}')
  if (start < 0) throw new Error('The model did not return JSON.')
  if (end <= start) throw new Error('The model’s reply was cut off before the end.')
  return JSON.parse(candidate.slice(start, end + 1))
}

// The shape's own placeholders, which a small model sometimes hands back as its answer.
const PLACEHOLDERS = new Set(['alt text under 125 characters', 'one or two sentences', 'subjects, setting, colours, light and mood', '8 to 15 lowercase search keywords'])
const clean = (value: unknown, max: number) => {
  const text = typeof value === 'string' ? value.replace(/\s+/g, ' ').trim().slice(0, max) : ''
  return PLACEHOLDERS.has(text.toLowerCase()) ? '' : text
}

/** German capitalises nouns, so its tags keep their case; other languages' tags are lowercased. */
export function normalizeResult(raw: unknown, language: Language = 'en'): Omit<VisionResult, 'usage'> {
  const obj = (typeof raw === 'object' && raw !== null ? raw : {}) as Record<string, unknown>
  const tags = Array.isArray(obj.tags) ? obj.tags : typeof obj.tags === 'string' ? obj.tags.split(',') : []
  const quality = typeof obj.quality === 'string' ? obj.quality.toLowerCase().trim() : ''
  const people = typeof obj.people === 'number' ? obj.people : Number.parseInt(String(obj.people ?? '0'), 10)
  return {
    tags: [...new Set(tags.map((t) => (language === 'de' ? clean(t, 40) : clean(t, 40).toLowerCase())).filter((t) => t.length > 1 && t.length <= 40))].slice(0, 20),
    alt: clean(obj.alt, 250),
    caption: clean(obj.caption, 600),
    description: clean(obj.description, 1500),
    people: Number.isFinite(people) && people >= 0 ? Math.min(Math.round(people), 999) : 0,
    quality: (QUALITY as readonly string[]).includes(quality) ? (quality as Quality) : null,
    // Models sometimes say "none" rather than leaving it empty.
    text: /^(none|n\/a|no text|)$/i.test(clean(obj.text, 2000)) ? '' : clean(obj.text, 2000),
  }
}

function base64(bytes: ArrayBuffer): string {
  let binary = ''
  const view = new Uint8Array(bytes)
  for (let i = 0; i < view.length; i += 0x8000) binary += String.fromCharCode(...view.subarray(i, i + 0x8000))
  return btoa(binary)
}

/** The image the model sees: a 1024 px JPEG from the preview (or thumbnail). */
export async function modelImage(env: DamBindings, assetId: string): Promise<string | null> {
  const store = renditionStore(env)
  const source = (await store.get(renditionKey(assetId, 'preview'))) ?? (await store.get(renditionKey(assetId, 'thumb')))
  const images = countedImages(env)
  if (!source || !images) return null
  const jpeg = await images.input(source.body)
    .transform({ width: 1024, height: 1024, fit: 'scale-down' })
    .output({ format: 'image/jpeg', quality: 82 })
  return `data:image/jpeg;base64,${base64(await jpeg.response().arrayBuffer())}`
}

/** Replies come in three shapes: Workers AI native (`response`), OpenAI-style (`choices`), and Moondream (`result.answer`). */
interface ModelReply {
  response?: unknown
  result?: { response?: unknown; answer?: unknown }
  choices?: { message?: { content?: unknown } }[]
  usage?: { prompt_tokens?: number; completion_tokens?: number; neurons?: number }
}

/** A model call that hasn't answered by then won't: give up, and let the photo be retried. */
export const MODEL_TIMEOUT_MS = 90_000
/**
 * Room for the reply. A sign- or document-heavy photo's text made 1,000 tokens too few: the JSON was
 * cut off after the call was billed (review B6). The prompt also caps the text at 500 characters.
 */
const MAX_TOKENS = { chat: 2000, moondream: 1500 }

export async function analyzeImage(ai: Ai, modelId: string, dataUrl: string, context: VisionContext, timeoutMs = MODEL_TIMEOUT_MS): Promise<VisionResult> {
  const model = VISION_MODELS.find((m) => m.id === modelId) ?? VISION_MODELS[0]!
  const prompt = buildPrompt(context)
  // Bound: the binding's run() reads private fields from `this`.
  const call = ai.run.bind(ai) as unknown as (model: string, input: Record<string, unknown>) => Promise<ModelReply>
  const run = (id: string, input: Record<string, unknown>) => {
    let timer: ReturnType<typeof setTimeout> | undefined
    const late = new Promise<never>((_, reject) => {
      timer = setTimeout(() => reject(new Error(`The model didn’t answer within ${Math.round(timeoutMs / 1000)} s.`)), timeoutMs)
    })
    return Promise.race([call(id, input), late]).finally(() => clearTimeout(timer))
  }
  let reply: ModelReply
  if (model.style === 'moondream') {
    // stream: false explicitly; left unset, the binding hands back a stream.
    reply = await run(model.id, { task: 'query', image: dataUrl, question: prompt, reasoning: false, max_tokens: MAX_TOKENS.moondream, temperature: 0.2, stream: false })
  } else {
    reply = await run(model.id, {
      messages: [
        {
          role: 'user',
          content: [
            { type: 'text', text: prompt },
            { type: 'image_url', image_url: { url: dataUrl } },
          ],
        },
      ],
      max_tokens: MAX_TOKENS.chat,
      temperature: 0.2,
      ...(model.jsonSchema ? { response_format: { type: 'json_schema', json_schema: SCHEMA } } : {}),
    })
  }
  const payload = reply.response ?? reply.result?.answer ?? reply.result?.response ?? reply.choices?.[0]?.message?.content
  if (payload === undefined || payload === null) throw new Error('The model returned no answer.')
  const parsed = typeof payload === 'string' ? extractJson(payload) : payload
  return {
    ...normalizeResult(parsed, context.language),
    usage: reply.usage
      ? { prompt: reply.usage.prompt_tokens ?? 0, completion: reply.usage.completion_tokens ?? 0, neurons: reply.usage.neurons ?? null }
      : null,
  }
}
