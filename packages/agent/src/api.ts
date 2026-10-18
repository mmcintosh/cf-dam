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

/** No answer from cf-dam (network down, DNS) after every retry. */
export class LinkError extends Error {}

/** 0: the agent's own "couldn't make a preview"; the rest are cf-dam refusing one file. */
const FILE_STATUSES = new Set([0, 400, 404, 409, 413, 415, 422])

/**
 * Whether an error is the link's or cf-dam's rather than one file's: no network, cf-dam down, a proxy
 * in the way, paused, unpaired. Those stop the scan without recording anything, and the next scan
 * tries again. Anything else (cf-dam refused the file, it couldn't be read or rendered) is recorded
 * against that file, and the scan carries on.
 */
export const isLinkError = (error: unknown) =>
  error instanceof Paused || error instanceof Unpaired || error instanceof LinkError || (error instanceof ApiError && !FILE_STATUSES.has(error.status))

export type FetchLike = (url: string, init?: RequestInit) => Promise<Response>

/** cf-dam's refusals are JSON with a known error code. */
const fromCfDam = (res: Response, body: unknown) =>
  (res.headers.get('Content-Type') ?? '').includes('application/json') && ['unauthenticated', 'forbidden'].includes((body as { error?: unknown } | null)?.error as string)

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
  async call<T>(method: string, path: string, body?: unknown, opts: { raw?: BodyInit; contentType?: string; retries?: number } = {}): Promise<{ status: number; body: T }> {
    const retries = opts.retries ?? this.retries
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
        if (attempt >= retries) throw new LinkError(`${method} ${path}: ${error instanceof Error ? error.message : String(error)}`)
        await sleep(delay)
        delay = Math.min(delay * 2, 60_000)
        continue
      }
      if ((res.status === 429 || res.status >= 500) && attempt < retries) {
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
      // Only cf-dam's own answer means the key is no good. A firewall rule, Cloudflare Access or a
      // proxy can also say 401/403, in HTML: that's the link, not the key.
      if ((res.status === 401 || res.status === 403) && this.apiKey && fromCfDam(res, parsed)) throw new Unpaired('cf-dam no longer accepts this agent’s key.')
      if (res.status >= 400 && res.status !== 202 && res.status !== 410) {
        const message = (parsed as { message?: string; error?: string } | null)?.message ?? (parsed as { error?: string } | null)?.error ?? `HTTP ${res.status}`
        throw new ApiError(`${method} ${path}: ${message}`, res.status)
      }
      return { status: res.status, body: parsed as T }
    }
  }
}
