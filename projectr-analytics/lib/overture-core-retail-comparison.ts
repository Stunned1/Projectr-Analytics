import { fetchOverturePlaces, type OverturePlace } from '@/lib/overture-client'
import {
  OVERTURE_CORE_RETAIL_BUCKET_LABELS,
  OVERTURE_CORE_RETAIL_BUCKET_KEYS,
  OVERTURE_CORE_RETAIL_CATEGORY_FILTER,
  OVERTURE_CORE_RETAIL_CATEGORY_TO_BUCKET,
} from '@/lib/overture-core-retail-taxonomy'

export const CORE_RETAIL_RADIUS_METERS = 1200

const CORE_RETAIL_CITIES = {
  austin: {
    key: 'austin',
    label: 'Austin',
    latitude: 30.2672,
    longitude: -97.7431,
  },
  dallas: {
    key: 'dallas',
    label: 'Dallas',
    latitude: 32.7767,
    longitude: -96.797,
  },
  houston: {
    key: 'houston',
    label: 'Houston',
    latitude: 29.7604,
    longitude: -95.3698,
  },
} as const

export const BUCKET_LABELS = OVERTURE_CORE_RETAIL_BUCKET_LABELS

export type CoreRetailCityKey = keyof typeof CORE_RETAIL_CITIES

export interface CoreRetailCity {
  key: CoreRetailCityKey
  label: string
  latitude: number
  longitude: number
}

export interface CoreRetailBucketRow {
  key: keyof typeof BUCKET_LABELS
  label: string
  cityAValue: number
  cityBValue: number
}

export interface CoreRetailComparisonResult {
  cityA: CoreRetailCity
  cityB: CoreRetailCity
  radiusMeters: number
  buckets: CoreRetailBucketRow[]
}

type CoreRetailFetchContext = {
  cityKey: CoreRetailCityKey
  city: CoreRetailCity
  radiusMeters: number
}

type CoreRetailFetcher = (context: CoreRetailFetchContext) => Promise<OverturePlace[]>

function resolveCoreRetailCity(name: string): CoreRetailCity | null {
  const normalized = name.trim().toLowerCase()
  if (normalized === 'austin') return CORE_RETAIL_CITIES.austin
  if (normalized === 'dallas') return CORE_RETAIL_CITIES.dallas
  if (normalized === 'houston') return CORE_RETAIL_CITIES.houston
  return null
}

function bucketCategory(category: string | null | undefined): keyof typeof BUCKET_LABELS | null {
  if (!category) return null
  const normalized = category.trim().toLowerCase()
  if (!(normalized in OVERTURE_CORE_RETAIL_CATEGORY_TO_BUCKET)) return null
  return OVERTURE_CORE_RETAIL_CATEGORY_TO_BUCKET[
    normalized as keyof typeof OVERTURE_CORE_RETAIL_CATEGORY_TO_BUCKET
  ] ?? null
}

function countBuckets(places: OverturePlace[]): Record<keyof typeof BUCKET_LABELS, number> {
  const counts = Object.fromEntries(
    OVERTURE_CORE_RETAIL_BUCKET_KEYS.map((key) => [key, 0])
  ) as Record<keyof typeof BUCKET_LABELS, number>

  for (const place of places) {
    const bucket = bucketCategory(place.properties?.categories?.primary)
    if (!bucket) continue
    counts[bucket] += 1
  }

  return counts
}

function hasUsableCounts(counts: Record<keyof typeof BUCKET_LABELS, number>): boolean {
  return OVERTURE_CORE_RETAIL_BUCKET_KEYS.some((key) => counts[key] > 0)
}

async function fetchCoreRetailPlaces(context: CoreRetailFetchContext): Promise<OverturePlace[]> {
  return fetchOverturePlaces(
    context.city.latitude,
    context.city.longitude,
    context.radiusMeters,
    OVERTURE_CORE_RETAIL_CATEGORY_FILTER,
    150
  )
}

export async function buildCoreRetailComparison(
  input: { cityA: string; cityB: string },
  fetcher: CoreRetailFetcher = fetchCoreRetailPlaces
): Promise<CoreRetailComparisonResult> {
  const cityA = resolveCoreRetailCity(input.cityA)
  const cityB = resolveCoreRetailCity(input.cityB)

  if (!cityA || !cityB) {
    throw new Error('Core retail comparison currently supports Austin compared with Houston or Dallas only.')
  }

  const [placesA, placesB] = await Promise.all([
    fetcher({ cityKey: cityA.key, city: cityA, radiusMeters: CORE_RETAIL_RADIUS_METERS }),
    fetcher({ cityKey: cityB.key, city: cityB, radiusMeters: CORE_RETAIL_RADIUS_METERS }),
  ])

  const countsA = countBuckets(placesA)
  const countsB = countBuckets(placesB)

  if (!hasUsableCounts(countsA) || !hasUsableCounts(countsB)) {
    throw new Error('Insufficient Overture retail context for one or both city cores.')
  }

  return {
    cityA,
    cityB,
    radiusMeters: CORE_RETAIL_RADIUS_METERS,
    buckets: OVERTURE_CORE_RETAIL_BUCKET_KEYS.map((key) => ({
      key,
      label: BUCKET_LABELS[key],
      cityAValue: countsA[key],
      cityBValue: countsB[key],
    })),
  }
}

export const resolveCoreRetailCityForTest = resolveCoreRetailCity
export const bucketCategoryForTest = bucketCategory
export const buildCoreRetailComparisonForTest = buildCoreRetailComparison
