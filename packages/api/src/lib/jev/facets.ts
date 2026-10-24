/**
 * Library facets for one photo (ported from jev-photolab facets/classify.mjs and lib/answers.mjs): one request asks
 * every question in questions.ts; decide() turns the answers into tags and facet values.
 *
 * A missing or malformed answer sets nothing and is listed in `missing`; a failed call throws (try again later,
 * never store "no facets").
 */
import { FACETS, TAG_FACETS, type Question, type TagFacet } from './questions'
import type { Answer, Ask, Reply } from './typesafe'

export const YES = 0.7
export const NO = 0.3
/** A Choice is used when its top option has at least this much of the probability. */
export const CHOICE = 0.6
/** Facets that imply another: a bird is an animal, a child a person. */
const IMPLIES: Partial<Record<TagFacet, TagFacet>> = { bird: 'animal', child: 'person' }

export const PEOPLE = ['none', 'one', 'two_to_five', 'six_or_more'] as const
export type People = (typeof PEOPLE)[number]

export interface FacetResult {
  /** Facets Jev is sure of (≥ YES). */
  tags: TagFacet[]
  /** Between NO and YES: not tags; a later run or a person can settle them. */
  unsure: TagFacet[]
  people: People | null
  setting: 'indoors' | 'outdoors' | null
  medium: string | null
  /** Every yes/no answer as a probability, kept so thresholds can change without asking again. */
  scores: Partial<Record<TagFacet, number>>
  missing: string[]
}

/** Did every question come back, as the right type, with a usable value? */
export function problems(questions: Record<string, Question>, answers: Record<string, Answer> | undefined): string[] {
  const bad: string[] = []
  for (const [id, q] of Object.entries(questions)) {
    const a = answers?.[id]
    const ok =
      !!a &&
      (q.type === 'noul'
        ? Number.isFinite(a.noul) && a.noul! >= 0 && a.noul! <= 1
        : q.type === 'choice'
          ? !!q.criteria && typeof a.choice === 'string' && Object.hasOwn(q.criteria, a.choice) && typeof a.probabilities === 'object'
          : q.type === 'score'
            ? Number.isFinite(a.score) && typeof a.probabilities === 'object'
            : ['top', 'left', 'bottom', 'right'].every((k) => Number.isFinite(a.box?.[k])))
    if (!ok) bad.push(id)
  }
  return bad
}

export function request(image: { data_base64: string; format: 'jpg' | 'png' }): Ask {
  const ref = crypto.randomUUID() // a fresh reference that can't clash with any text
  return { state: { image: ref }, assets: { [ref]: { type: 'image', ...image } }, questions: FACETS }
}

export function decide(answers: Record<string, Answer>): FacetResult {
  const missing = problems(FACETS, answers)
  const ok = (q: string) => !missing.includes(q)
  const p = (q: string) => (ok(q) ? answers[q]!.noul : undefined)
  const top = (q: string) => (ok(q) && (answers[q]!.probabilities?.[answers[q]!.choice!] ?? 0) >= CHOICE ? answers[q]!.choice! : null)
  const sure = new Set<TagFacet>(TAG_FACETS.filter((q) => (p(q) ?? 0) >= YES))
  for (const [q, implied] of Object.entries(IMPLIES) as [TagFacet, TagFacet][]) if (sure.has(q)) sure.add(implied)
  const unsure = TAG_FACETS.filter((q) => !sure.has(q) && p(q) !== undefined && p(q)! > NO && p(q)! < YES)
  const person = sure.has('person') ? 'yes' : p('person') !== undefined && p('person')! <= NO ? 'no' : 'unsure'
  return {
    tags: TAG_FACETS.filter((q) => sure.has(q)),
    unsure,
    people: person === 'no' ? 'none' : person === 'yes' ? (top('people_count') as People | null) : null,
    setting: top('setting') as FacetResult['setting'],
    medium: top('medium'),
    scores: Object.fromEntries(TAG_FACETS.filter(ok).map((q) => [q, p(q)])),
    missing,
  }
}

export async function classifyImage(
  image: { data_base64: string; format: 'jpg' | 'png' },
  ask: (ask: Ask) => Promise<Reply>,
): Promise<FacetResult & { tokens: number | null }> {
  const reply = await ask(request(image))
  return { ...decide(reply.answers), tokens: reply.usage?.input_tokens ?? null }
}
