/**
 * Google Geocoding API — freeform addresses and place names (Client CSV normalize, upload pipeline).
 * Reads/writes a shared Supabase-backed cache so expensive address geocodes survive restarts.
 */

import { supabase } from '@/lib/supabase'

export function getGoogleForwardGeocodeKey(): string | null {
  const a = process.env.GOOGLE_GEOCODING_API_KEY?.trim()
  const b = process.env.NEXT_PUBLIC_GOOGLE_MAPS_API_KEY?.trim()
  return a || b || null
}

export interface ForwardGeocodeResult {
  lat: number
  lng: number
  formattedAddress: string
  /** USPS ZIP when Google returned a postal_code component */
  postalCode?: string
}

export interface ForwardGeocodeOptions {
  allowLiveLookup?: boolean
}

type AddressGeocodeCacheRow = {
  normalized_query: string
  resolution_status: 'ok' | 'miss'
  lat: number | null
  lng: number | null
  formatted_address: string | null
  postal_code: string | null
  updated_at: string
}

type CacheEntry = {
  expiresAt: number
  value: ForwardGeocodeResult | null
}

const SUCCESS_TTL_MS = 24 * 60 * 60 * 1000
const MISS_TTL_MS = 15 * 60 * 1000
const DB_CACHE_MAX_AGE_MS = 365 * 24 * 60 * 60 * 1000
const DB_BATCH_SIZE = 200

const resolvedCache = new Map<string, CacheEntry>()
const inflight = new Map<string, Promise<ForwardGeocodeResult | null>>()

export function normalizeForwardGeocodeQuery(address: string): string | null {
  const trimmed = address.trim()
  if (trimmed.length < 3) return null
  return trimmed.toLowerCase().replace(/\s+/g, ' ')
}

function cacheTtlFor(value: ForwardGeocodeResult | null): number {
  return value ? SUCCESS_TTL_MS : MISS_TTL_MS
}

function chunk<T>(values: T[], size: number): T[][] {
  const result: T[][] = []
  for (let index = 0; index < values.length; index += size) {
    result.push(values.slice(index, index + size))
  }
  return result
}

function mapRowToForwardResult(row: AddressGeocodeCacheRow): ForwardGeocodeResult | null {
  if (
    row.resolution_status !== 'ok' ||
    typeof row.lat !== 'number' ||
    !Number.isFinite(row.lat) ||
    typeof row.lng !== 'number' ||
    !Number.isFinite(row.lng)
  ) {
    return null
  }

  return {
    lat: row.lat,
    lng: row.lng,
    formattedAddress: row.formatted_address?.trim() || row.normalized_query,
    postalCode: row.postal_code?.trim() || undefined,
  }
}

async function readCachedForwardGeocodeFromDb(
  normalizedQuery: string
): Promise<{ hit: boolean; value: ForwardGeocodeResult | null }> {
  try {
    const cutoff = new Date(Date.now() - DB_CACHE_MAX_AGE_MS).toISOString()
    const { data, error } = await supabase
      .from('address_geocode_cache')
      .select('normalized_query, resolution_status, lat, lng, formatted_address, postal_code, updated_at')
      .eq('normalized_query', normalizedQuery)
      .gte('updated_at', cutoff)
      .maybeSingle()

    if (error || !data) {
      return { hit: false, value: null }
    }

    return {
      hit: true,
      value: mapRowToForwardResult(data as AddressGeocodeCacheRow),
    }
  } catch {
    return { hit: false, value: null }
  }
}

async function persistForwardGeocodeToDb(
  normalizedQuery: string,
  result: ForwardGeocodeResult | null
): Promise<void> {
  try {
    const row = {
      normalized_query: normalizedQuery,
      resolution_status: result ? 'ok' : 'miss',
      lat: result?.lat ?? null,
      lng: result?.lng ?? null,
      formatted_address: result?.formattedAddress ?? null,
      postal_code: result?.postalCode ?? null,
      source: 'google_forward_geocode',
      updated_at: new Date().toISOString(),
    }
    await supabase.from('address_geocode_cache').upsert(
      row as never,
      { onConflict: 'normalized_query' }
    )
  } catch {
    /* table missing or RLS - in-process cache still helps */
  }
}

export async function readCachedForwardGeocodes(
  addresses: string[]
): Promise<Map<string, ForwardGeocodeResult | null>> {
  const normalizedQueries = Array.from(
    new Set(
      addresses
        .map((address) => normalizeForwardGeocodeQuery(address))
        .filter((value): value is string => Boolean(value))
    )
  )

  const results = new Map<string, ForwardGeocodeResult | null>()
  if (normalizedQueries.length === 0) return results

  try {
    const cutoff = new Date(Date.now() - DB_CACHE_MAX_AGE_MS).toISOString()
    for (const batch of chunk(normalizedQueries, DB_BATCH_SIZE)) {
      const { data, error } = await supabase
        .from('address_geocode_cache')
        .select('normalized_query, resolution_status, lat, lng, formatted_address, postal_code, updated_at')
        .in('normalized_query', batch)
        .gte('updated_at', cutoff)

      if (error || !Array.isArray(data)) continue

      for (const row of data as AddressGeocodeCacheRow[]) {
        const value = mapRowToForwardResult(row)
        results.set(row.normalized_query, value)
        resolvedCache.set(row.normalized_query, {
          expiresAt: Date.now() + cacheTtlFor(value),
          value,
        })
      }
    }
  } catch {
    return results
  }

  return results
}

async function mapWithConcurrency<T, R>(
  values: T[],
  concurrency: number,
  task: (value: T, index: number) => Promise<R>
): Promise<R[]> {
  if (values.length === 0) return []

  const results = new Array<R>(values.length)
  let nextIndex = 0

  async function worker() {
    while (nextIndex < values.length) {
      const currentIndex = nextIndex
      nextIndex += 1
      results[currentIndex] = await task(values[currentIndex], currentIndex)
    }
  }

  const workerCount = Math.min(Math.max(1, concurrency), values.length)
  await Promise.all(Array.from({ length: workerCount }, () => worker()))
  return results
}

export async function warmForwardGeocodes(
  addresses: string[],
  options: { limit?: number | null; concurrency?: number } = {}
): Promise<{
  requested: number
  cached: number
  attempted: number
  resolved: number
  missed: number
}> {
  const addressByNormalizedQuery = new Map<string, string>()
  for (const address of addresses) {
    const normalized = normalizeForwardGeocodeQuery(address)
    if (!normalized) continue
    if (!addressByNormalizedQuery.has(normalized)) {
      addressByNormalizedQuery.set(normalized, address.trim())
    }
  }

  const uniqueAddresses = Array.from(addressByNormalizedQuery.values())
  const cached = await readCachedForwardGeocodes(uniqueAddresses)
  const unresolved = Array.from(addressByNormalizedQuery.entries())
    .filter(([normalizedQuery]) => !cached.has(normalizedQuery))
    .map(([, address]) => address)

  const limit =
    options.limit == null
      ? unresolved.length
      : Math.max(0, Math.min(unresolved.length, Math.floor(options.limit)))
  const targets = unresolved.slice(0, limit)
  const concurrency = options.concurrency ?? 6

  const attempts = await mapWithConcurrency(targets, concurrency, async (address) => {
    const result = await geocodeAddressForward(address)
    return result
  })

  let resolved = 0
  let missed = 0
  for (const result of attempts) {
    if (result) resolved += 1
    else missed += 1
  }

  return {
    requested: uniqueAddresses.length,
    cached: cached.size,
    attempted: targets.length,
    resolved,
    missed,
  }
}

/** Prefers ROOFTOP / RANGE_INTERPOLATED when multiple results exist. */
export async function geocodeAddressForward(
  address: string,
  options: ForwardGeocodeOptions = {}
): Promise<ForwardGeocodeResult | null> {
  const allowLiveLookup = options.allowLiveLookup ?? true
  const normalizedQuery = normalizeForwardGeocodeQuery(address)
  if (!normalizedQuery) return null

  const cached = resolvedCache.get(normalizedQuery)
  if (cached && cached.expiresAt > Date.now()) {
    return cached.value
  }

  const existing = inflight.get(normalizedQuery)
  if (existing) return existing

  const request = (async () => {
    const dbCached = await readCachedForwardGeocodeFromDb(normalizedQuery)
    if (dbCached.hit) {
      resolvedCache.set(normalizedQuery, {
        expiresAt: Date.now() + cacheTtlFor(dbCached.value),
        value: dbCached.value,
      })
      return dbCached.value
    }

    if (!allowLiveLookup) return null

    const key = getGoogleForwardGeocodeKey()
    if (!key) return null

    let shouldPersistMiss = false

    try {
      const trimmed = address.trim()
      const url = `https://maps.googleapis.com/maps/api/geocode/json?address=${encodeURIComponent(trimmed)}&key=${encodeURIComponent(key)}`
      const response = await fetch(url, { cache: 'no-store', signal: AbortSignal.timeout(12000) })
      if (!response.ok) return null

      const data = (await response.json()) as {
        status?: string
        error_message?: string
        results?: Array<{
          formatted_address?: string
          geometry?: { location?: { lat?: number; lng?: number }; location_type?: string }
          address_components?: Array<{ long_name?: string; types?: string[] }>
        }>
      }

      if (data.status === 'ZERO_RESULTS') {
        shouldPersistMiss = true
        return null
      }

      if (data.status !== 'OK' || !Array.isArray(data.results) || data.results.length === 0) return null

      const prefer = data.results.find((r) => {
        const t = r.geometry?.location_type
        return t === 'ROOFTOP' || t === 'RANGE_INTERPOLATED'
      })
      const pick = prefer ?? data.results[0]
      const loc = pick?.geometry?.location
      if (typeof loc?.lat !== 'number' || typeof loc?.lng !== 'number') return null

      const formattedAddress =
        typeof pick.formatted_address === 'string' && pick.formatted_address.length > 0
          ? pick.formatted_address
          : trimmed
      const zipComponent = Array.isArray(pick.address_components)
        ? pick.address_components.find((c) => Array.isArray(c.types) && c.types.includes('postal_code'))
        : undefined
      const postalCode =
        zipComponent && typeof zipComponent.long_name === 'string' ? zipComponent.long_name : undefined

      const result: ForwardGeocodeResult = {
        lat: loc.lat,
        lng: loc.lng,
        formattedAddress,
        postalCode,
      }

      await persistForwardGeocodeToDb(normalizedQuery, result)
      return result
    } catch {
      return null
    } finally {
      if (shouldPersistMiss) {
        await persistForwardGeocodeToDb(normalizedQuery, null)
      }
    }
  })()

  inflight.set(normalizedQuery, request)
  const result = await request
  inflight.delete(normalizedQuery)
  resolvedCache.set(normalizedQuery, {
    expiresAt: Date.now() + cacheTtlFor(result),
    value: result,
  })
  return result
}
