const inFlight = new Map<string, Promise<unknown>>()
const responseCache = new Map<string, { expiresAt: number; data: unknown }>()

const DEFAULT_TTL_MS = 5 * 60 * 1000
const MAX_CACHE_ENTRIES = 100
const PERF_DEBUG = process.env.NEXT_PUBLIC_PERF_DEBUG === '1'

interface DedupedFetchOptions {
  ttlMs?: number
  cacheKey?: string
  init?: RequestInit
  allowErrorBody?: boolean
}

export async function dedupedFetchJson<T>(
  url: string,
  options: DedupedFetchOptions = {}
): Promise<T> {
  const init = options.init
  const method = (init?.method ?? 'GET').toUpperCase()
  const cacheKey =
    options.cacheKey ?? (method === 'GET' || method === 'HEAD' ? url : null)
  const ttlMs = options.ttlMs ?? DEFAULT_TTL_MS
  const allowErrorBody = options.allowErrorBody === true

  if (cacheKey) {
    const cached = responseCache.get(cacheKey)
    if (cached && cached.expiresAt > Date.now()) {
      if (PERF_DEBUG) console.log('[fetch] CACHED', cacheKey)
      return cached.data as T
    }
  }

  if (cacheKey) {
    const existing = inFlight.get(cacheKey)
    if (existing) {
      if (PERF_DEBUG) console.log('[fetch] DEDUPED', cacheKey)
      return existing as Promise<T>
    }
  }
  if (PERF_DEBUG) console.log('[fetch] NEW', cacheKey ?? `${method}:${url}`)

  const request = fetch(url, init)
    .then(async (res) => {
      if (!res.ok) {
        if (allowErrorBody) {
          return (await res.json()) as T
        }
        throw new Error(`Request failed (${res.status}) for ${url}`)
      }
      const data = (await res.json()) as T
      if (cacheKey && ttlMs > 0) {
        responseCache.set(cacheKey, { data, expiresAt: Date.now() + ttlMs })
        if (responseCache.size > MAX_CACHE_ENTRIES) {
          const firstKey = responseCache.keys().next().value
          if (typeof firstKey === 'string') responseCache.delete(firstKey)
        }
      }
      return data
    })
    .finally(() => {
      if (cacheKey) inFlight.delete(cacheKey)
    })

  if (cacheKey) inFlight.set(cacheKey, request)
  return request
}
