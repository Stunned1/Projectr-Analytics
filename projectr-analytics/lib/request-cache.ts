const inFlight = new Map<string, Promise<unknown>>()
const responseCache = new Map<string, { expiresAt: number; data: unknown }>()

const DEFAULT_TTL_MS = 5 * 60 * 1000
const MAX_CACHE_ENTRIES = 40
const PERF_DEBUG = process.env.NEXT_PUBLIC_PERF_DEBUG === '1'

interface DedupedFetchOptions {
  ttlMs?: number
  cacheKey?: string
}

export async function dedupedFetchJson<T>(
  url: string,
  options: DedupedFetchOptions = {}
): Promise<T> {
  const cacheKey = options.cacheKey ?? url
  const ttlMs = options.ttlMs ?? DEFAULT_TTL_MS

  const cached = responseCache.get(cacheKey)
  if (cached && cached.expiresAt > Date.now()) {
    if (PERF_DEBUG) console.log('[fetch] CACHED', cacheKey)
    return cached.data as T
  }

  const existing = inFlight.get(cacheKey)
  if (existing) {
    if (PERF_DEBUG) console.log('[fetch] DEDUPED', cacheKey)
    return existing as Promise<T>
  }
  if (PERF_DEBUG) console.log('[fetch] NEW', cacheKey)

  const request = fetch(url)
    .then(async (res) => {
      if (!res.ok) {
        throw new Error(`Request failed (${res.status}) for ${url}`)
      }
      const data = (await res.json()) as T
      if (ttlMs > 0) {
        responseCache.set(cacheKey, { data, expiresAt: Date.now() + ttlMs })
        if (responseCache.size > MAX_CACHE_ENTRIES) {
          const firstKey = responseCache.keys().next().value
          if (typeof firstKey === 'string') responseCache.delete(firstKey)
        }
      }
      return data
    })
    .finally(() => {
      inFlight.delete(cacheKey)
    })

  inFlight.set(cacheKey, request)
  return request
}
