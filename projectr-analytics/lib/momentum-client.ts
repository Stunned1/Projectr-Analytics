export interface MomentumScoreRow {
  zip: string
  score: number
  label?: 'Strong' | 'Moderate' | 'Weak' | 'No Data'
  components: {
    jobMarket: number | null
    rentGrowth: number | null
    permitDensity: number | null
    popGrowth: number | null
  }
}

export interface MomentumApiResponse {
  scores: MomentumScoreRow[]
  zip_count: number
}

const MOMENTUM_CACHE_TTL_MS = 5 * 60 * 1000
const momentumResponseCache = new Map<string, { expiresAt: number; data: MomentumApiResponse }>()
const momentumInflight = new Map<string, Promise<MomentumApiResponse>>()

export function normalizeMomentumZipList(
  zips: Iterable<string> | null | undefined,
  limit = 40
): string[] {
  if (!zips) return []

  const normalized = Array.from(
    new Set(
      Array.from(zips)
        .map((zip) => String(zip).trim())
        .filter((zip) => /^\d{5}$/.test(zip))
    )
  ).sort()

  return normalized.slice(0, limit)
}

export function getMomentumZipKey(
  zips: Iterable<string> | null | undefined,
  limit = 40
): string {
  return normalizeMomentumZipList(zips, limit).join(',')
}

export function getMomentumScore(
  response: MomentumApiResponse | null | undefined,
  zip: string | null | undefined
): number | null {
  if (!response || !zip) return null
  return response.scores.find((row) => row.zip === zip)?.score ?? null
}

export async function fetchMomentumScores(
  zips: Iterable<string> | null | undefined,
  options: { limit?: number; ttlMs?: number } = {}
): Promise<MomentumApiResponse> {
  const limit = options.limit ?? 40
  const ttlMs = options.ttlMs ?? MOMENTUM_CACHE_TTL_MS
  const normalizedZips = normalizeMomentumZipList(zips, limit)

  if (normalizedZips.length === 0) {
    return { scores: [], zip_count: 0 }
  }

  const cacheKey = normalizedZips.join(',')
  const cached = momentumResponseCache.get(cacheKey)
  if (cached && cached.expiresAt > Date.now()) {
    return cached.data
  }

  const existing = momentumInflight.get(cacheKey)
  if (existing) {
    return existing
  }

  const request = fetch('/api/momentum', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ zips: normalizedZips }),
  })
    .then(async (res) => {
      if (!res.ok) {
        const payload = (await res.json().catch(() => ({}))) as { error?: string }
        throw new Error(payload.error || `Momentum request failed (${res.status})`)
      }
      const payload = (await res.json()) as MomentumApiResponse
      if (ttlMs > 0) {
        momentumResponseCache.set(cacheKey, {
          data: payload,
          expiresAt: Date.now() + ttlMs,
        })
      }
      return payload
    })
    .finally(() => {
      momentumInflight.delete(cacheKey)
    })

  momentumInflight.set(cacheKey, request)
  return request
}
