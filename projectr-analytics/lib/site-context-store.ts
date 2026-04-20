import { SITE_CONTEXT_CATEGORY_LABELS, type SitePlacesContextResponse } from '@/lib/google-places-site-context'

export const SITE_CONTEXT_STORAGE_KEY = 'projectr-site-context-v1'

export interface SiteContextCacheInput {
  lat: number
  lng: number
  radiusMeters: number
}

interface SiteContextStoreState {
  entries: Record<string, SitePlacesContextResponse>
  buildKey: (input: SiteContextCacheInput) => string
  read: (input: SiteContextCacheInput) => SitePlacesContextResponse | null
  write: (input: SiteContextCacheInput, value: SitePlacesContextResponse) => void
  clear: () => void
  resetForTests: () => void
}

interface SiteContextStoreApi {
  getState: () => SiteContextStoreState
}

function normalizeCoordinate(value: number): string {
  if (!Number.isFinite(value)) return 'NaN'
  return (Math.round(value * 100000) / 100000).toFixed(5)
}

function normalizeRadius(value: number): string {
  if (!Number.isFinite(value)) return 'NaN'
  return String(Math.max(0, Math.round(value)))
}

function isFiniteNumber(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value)
}

function normalizeCountByCategory(value: unknown): SitePlacesContextResponse['countsByCategory'][number] | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null

  const candidate = value as Partial<SitePlacesContextResponse['countsByCategory'][number]>
  if (
    typeof candidate.category !== 'string' ||
    typeof candidate.label !== 'string' ||
    !Object.hasOwn(SITE_CONTEXT_CATEGORY_LABELS, candidate.category) ||
    SITE_CONTEXT_CATEGORY_LABELS[candidate.category as keyof typeof SITE_CONTEXT_CATEGORY_LABELS] !== candidate.label ||
    !isFiniteNumber(candidate.count)
  ) {
    return null
  }

  return {
    category: candidate.category as SitePlacesContextResponse['countsByCategory'][number]['category'],
    label: candidate.label,
    count: Math.max(0, Math.round(candidate.count)),
  }
}

function normalizeTopPlace(
  value: unknown
): SitePlacesContextResponse['topPlaces'][number] | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null

  const candidate = value as Partial<SitePlacesContextResponse['topPlaces'][number]>
  if (typeof candidate.name !== 'string' || typeof candidate.categoryLabel !== 'string') {
    return null
  }

  if ('distanceMeters' in candidate && candidate.distanceMeters !== undefined && !isFiniteNumber(candidate.distanceMeters)) {
    return null
  }

  const normalized: SitePlacesContextResponse['topPlaces'][number] = {
    name: candidate.name,
    categoryLabel: candidate.categoryLabel,
  }

  if (isFiniteNumber(candidate.distanceMeters)) {
    normalized.distanceMeters = Math.max(0, Math.round(candidate.distanceMeters))
  }

  return normalized
}

function normalizeEntry(value: unknown): SitePlacesContextResponse | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null

  const candidate = value as Partial<SitePlacesContextResponse>
  if (
    !isFiniteNumber(candidate.radiusMeters) ||
    typeof candidate.summary !== 'string' ||
    !Array.isArray(candidate.countsByCategory) ||
    !Array.isArray(candidate.topPlaces) ||
    !candidate.source ||
    typeof candidate.source !== 'object' ||
    (candidate.source as { provider?: unknown }).provider !== 'google_places'
  ) {
    return null
  }

  const countsByCategory = candidate.countsByCategory.map(normalizeCountByCategory)
  if (countsByCategory.some((entry) => entry == null)) {
    return null
  }

  const topPlaces = candidate.topPlaces.map(normalizeTopPlace)
  if (topPlaces.some((entry) => entry == null)) {
    return null
  }

  return {
    radiusMeters: Math.max(0, Math.round(candidate.radiusMeters)),
    summary: candidate.summary,
    countsByCategory: countsByCategory as SitePlacesContextResponse['countsByCategory'],
    topPlaces: topPlaces as SitePlacesContextResponse['topPlaces'],
    source: {
      provider: 'google_places',
    },
  }
}

function normalizeEntries(state: unknown): Record<string, SitePlacesContextResponse> {
  if (!state || typeof state !== 'object' || Array.isArray(state)) return {}

  const entries = (state as { entries?: unknown }).entries
  if (!entries || typeof entries !== 'object' || Array.isArray(entries)) return {}

  const normalized: Record<string, SitePlacesContextResponse> = {}
  for (const [key, value] of Object.entries(entries as Record<string, unknown>)) {
    const entry = normalizeEntry(value)
    if (entry) normalized[key] = entry
  }
  return normalized
}

function readSessionStorageEntries(): Record<string, SitePlacesContextResponse> {
  if (typeof sessionStorage === 'undefined') return {}

  const raw = sessionStorage.getItem(SITE_CONTEXT_STORAGE_KEY)
  if (!raw) return {}

  try {
    const parsed = JSON.parse(raw) as unknown
    return normalizeEntries(
      parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? (parsed as { state?: unknown }).state : null
    )
  } catch {
    return {}
  }
}

function writeSessionStorageEntries(entries: Record<string, SitePlacesContextResponse>) {
  if (typeof sessionStorage === 'undefined') return

  sessionStorage.setItem(
    SITE_CONTEXT_STORAGE_KEY,
    JSON.stringify({
      state: {
        entries,
      },
      version: 0,
    })
  )
}

export function buildSiteContextCacheKey(input: SiteContextCacheInput): string {
  return ['site-context', normalizeCoordinate(input.lat), normalizeCoordinate(input.lng), normalizeRadius(input.radiusMeters)].join(':')
}

const storeState: SiteContextStoreState = {
  entries: {},
  buildKey: buildSiteContextCacheKey,
  read(input) {
    if (Object.keys(storeState.entries).length === 0) {
      storeState.entries = readSessionStorageEntries()
    }
    return storeState.entries[buildSiteContextCacheKey(input)] ?? null
  },
  write(input, value) {
    if (Object.keys(storeState.entries).length === 0) {
      storeState.entries = readSessionStorageEntries()
    }
    storeState.entries = {
      ...storeState.entries,
      [buildSiteContextCacheKey(input)]: value,
    }
    writeSessionStorageEntries(storeState.entries)
  },
  clear() {
    storeState.entries = {}
    writeSessionStorageEntries({})
  },
  resetForTests() {
    storeState.entries = {}
    writeSessionStorageEntries({})
  },
}

export const useSiteContextStore: SiteContextStoreApi = {
  getState: () => storeState,
}
