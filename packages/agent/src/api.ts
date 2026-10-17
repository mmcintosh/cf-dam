/** Talking to cf-dam: JSON in and out, the agent's key, and patient retries (NAS internet links drop). */

export class Paused extends Error {}
/** The key was revoked (or the agent removed): pair again. */
export class Unpaired extends Error {}
export class ApiError extends Error {
  constructor(
    message: string,
    readonly status: number,
  ) {
    super(message)
  }
}

export type FetchLike = (url: string, init?: RequestInit) => Promise<Response>

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))

export class Api {
  constructor(
    readonly baseUrl: string,
    public apiKey: string | null = null,
    private readonly fetchImpl: FetchLike = fetch,
    private readonly retries = 6,
  ) {}

  /**
   * One call, retried with backoff on network errors, 429 and 5xx (honouring Retry-After). 409
   * "paused" and 401/403 are not retried: the caller decides what to do.
   */
  async call<T>(method: string, path: string, body?: unknown, opts: { raw?: BodyInit; contentType?: string } = {}): Promise<{ status: number; body: T }> {
    const headers: Record<string, string> = { Origin: this.baseUrl }
    if (this.apiKey) headers.Authorization = `Bearer ${this.apiKey}`
    if (body !== undefined) headers['Content-Type'] = 'application/json'
    if (opts.contentType) headers['Content-Type'] = opts.contentType
    let delay = 1000
    for (let attempt = 0; ; attempt++) {
      let res: Response
      try {
        res = await this.fetchImpl(`${this.baseUrl}${path}`, { method, headers, body: opts.raw ?? (body === undefined ? undefined : JSON.stringify(body)) })
      } catch (error) {
        if (attempt >= this.retries) throw error
        await sleep(delay)
        delay = Math.min(delay * 2, 60_000)
        continue
      }
      if ((res.status === 429 || res.status >= 500) && attempt < this.retries) {
        const after = Number(res.headers.get('Retry-After'))
        await sleep(after > 0 ? after * 1000 : delay)
        delay = Math.min(delay * 2, 60_000)
        continue
      }
      const text = await res.text()
      let parsed: unknown = null
      try {
        parsed = text ? JSON.parse(text) : null
      } catch {
        parsed = text
      }
      if (res.status === 409 && (parsed as { error?: string } | null)?.error === 'paused') throw new Paused('Paused in cf-dam.')
      if ((res.status === 401 || res.status === 403) && this.apiKey) throw new Unpaired('cf-dam no longer accepts this agent’s key.')
      if (res.status >= 400 && res.status !== 202 && res.status !== 410) {
        const message = (parsed as { message?: string; error?: string } | null)?.message ?? (parsed as { error?: string } | null)?.error ?? `HTTP ${res.status}`
        throw new ApiError(`${method} ${path}: ${message}`, res.status)
      }
      return { status: res.status, body: parsed as T }
    }
  }
}
