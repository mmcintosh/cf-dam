import { describe, expect, it } from 'vitest'
import { createDamApi } from './index'

describe('GET /health', () => {
  it('reports the service and which bindings are present', async () => {
    const res = await createDamApi().request('/health', {}, {})
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({
      ok: true,
      service: 'cf-dam',
      version: '0.0.0',
      bindings: { db: false, mediaBucket: false },
    })
  })
})
