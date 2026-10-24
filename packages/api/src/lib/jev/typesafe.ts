/**
 * The TypeSafe call (ported from jev-photolab lib/typesafe.mjs). Retries rate limits, server errors and timeouts a
 * few times, then throws: a failure is an error, never an answer. The key stays on the server (a Worker secret).
 */
import type { Question } from './questions'

export const ENDPOINT = 'https://api.typesafe.ai/v1/systemone'
export const MODEL = 'jev-1.14.0'
const RETRY = new Set([408, 429, 500, 502, 503, 504, 529])

export interface Answer {
  noul?: number
  choice?: string
  score?: number
  probabilities?: Record<string, number>
  box?: Record<string, number>
}

export interface Reply {
  answers: Record<string, Answer>
  usage?: { input_tokens?: number }
}

export interface Ask {
  state: Record<string, string>
  questions: Record<string, Question>
  assets?: Record<string, { type: 'image'; format: 'jpg' | 'png'; data_base64: string }>
}

/** TypeSafe answered, and said no: a request it will never take (an image size it refuses), not worth retrying. */
export class TypeSafeRefused extends Error {}

export function typesafe(options: {
  apiKey: string
  fetch?: typeof fetch
  timeoutMs?: number
  retries?: number
  pause?: (attempt: number, retryAfter: string | null) => Promise<void>
}): (ask: Ask) => Promise<Reply> {
  const { apiKey, timeoutMs = 20_000, retries = 2 } = options
  const send = options.fetch ?? ((...a: Parameters<typeof fetch>) => fetch(...a))
  const wait = options.pause ?? pause
  return async ({ state, questions, assets }) => {
    const headers: Record<string, string> = { authorization: `Bearer ${apiKey}`, 'content-type': 'application/json' }
    // Images are a TypeSafe preview: every request carrying one says so.
    if (assets) headers['TypeSafe-Danger-Zone-Images'] = 'true'
    const body = JSON.stringify({ model: MODEL, state, questions, ...(assets && { assets }) })
    for (let attempt = 0; ; attempt++) {
      let res: Response
      try {
        res = await send(ENDPOINT, { method: 'POST', headers, body, signal: AbortSignal.timeout(timeoutMs) })
      } catch (e) {
        if (attempt < retries) {
          await wait(attempt, null)
          continue
        }
        throw new Error(`TypeSafe unreachable: ${e instanceof Error ? e.message : String(e)}`)
      }
      if (RETRY.has(res.status) && attempt < retries) {
        await res.body?.cancel()
        await wait(attempt, res.headers.get('retry-after'))
        continue
      }
      const json = (await res.json().catch(() => null)) as (Reply & { detail?: { message?: string } }) | null
      // Only a refused image is the image's fault; any other 400 is the request's, and should fail loudly.
      const message = json?.detail?.message ?? ''
      if (res.status === 400 && /image/i.test(message)) throw new TypeSafeRefused(`TypeSafe refused it: ${message.slice(0, 200)}`)
      if (!res.ok) throw new Error(`TypeSafe ${res.status}: ${JSON.stringify(json).slice(0, 300)}`)
      if (!json?.answers) throw new Error(`TypeSafe sent no answers: ${JSON.stringify(json).slice(0, 300)}`)
      return json
    }
  }
}

// Wait as the server asks (capped at 10 s), else 0.5 s, 1 s, 2 s… with a little jitter.
const pause = (attempt: number, retryAfter: string | null) =>
  new Promise<void>((resolve) =>
    setTimeout(resolve, Math.min(10_000, Number(retryAfter) > 0 ? Number(retryAfter) * 1000 : 500 * 2 ** attempt + Math.random() * 250)),
  )
