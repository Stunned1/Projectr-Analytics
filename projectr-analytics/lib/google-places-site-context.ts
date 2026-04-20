import {
  mapGoogleTypesToSiteContextCategory,
  SITE_CONTEXT_CATEGORY_LABELS,
  type SiteContextCategory,
} from '@/lib/site-context-taxonomy'

const GOOGLE_PLACES_SEARCH_NEARBY_URL = 'https://places.googleapis.com/v1/places:searchNearby'
const DEFAULT_GOOGLE_PLACES_FIELD_MASK = 'places.id,places.displayName,places.types,places.formattedAddress,places.location'
const DEFAULT_GOOGLE_PLACES_LIMIT = 20
const MAX_GOOGLE_PLACES_RADIUS_METERS = 50000

export interface SiteContextCount {
  category: SiteContextCategory
  label: string
  count: number
}

export interface NormalizedSiteContextPlace {
  id: string
  name: string
  category: SiteContextCategory | null
  types: readonly string[]
}

export interface SitePlacesContextResponse {
  radiusMeters: number
  summary: string
  countsByCategory: SiteContextCount[]
  topPlaces: Array<{
    name: string
    categoryLabel: string
    distanceMeters?: number
  }>
  source: {
    provider: 'google_places'
  }
}

type GooglePlacesSearchNearbyPlace = {
  id?: string
  displayName?: { text?: string | null }
  types?: string[]
  formattedAddress?: string | null
  location?: { latitude?: number | null; longitude?: number | null }
}

type GooglePlacesSearchNearbyResponse = {
  places?: GooglePlacesSearchNearbyPlace[]
}

export function categorizeGooglePlaceTypes(types: readonly string[]): SiteContextCategory | null {
  return mapGoogleTypesToSiteContextCategory(types)
}

export function summarizeSiteContext(radiusMeters: number, counts: readonly SiteContextCount[]): string {
  const safeRadius = Number.isFinite(radiusMeters) ? Math.max(0, Math.floor(radiusMeters)) : 0

  if (counts.length === 0) {
    return `No nearby place context found within ${safeRadius}m.`
  }

  const pieces = counts.map((entry) => `${entry.count} ${SITE_CONTEXT_CATEGORY_LABELS[entry.category].toLowerCase()}`)
  return `Within ${safeRadius}m: ${pieces.join(', ')}.`
}

export function getGooglePlacesApiKey(env: NodeJS.ProcessEnv = process.env): string | null {
  const configured = env.GOOGLE_PLACES_API_KEY?.trim() || env.GOOGLE_GEOCODING_API_KEY?.trim() || ''
  return configured.length > 0 ? configured : null
}

export function normalizeGooglePlacesSiteContextResponse(
  radiusMeters: number,
  places: readonly GooglePlacesSearchNearbyPlace[]
): SitePlacesContextResponse {
  const safeRadius = Number.isFinite(radiusMeters) ? Math.max(0, Math.floor(radiusMeters)) : 0
  const grouped = new Map<SiteContextCategory, number>()
  const normalizedPlaces = places
    .map((place) => {
      const category = categorizeGooglePlaceTypes(place.types ?? [])
      const id = typeof place.id === 'string' ? place.id.trim() : ''
      const name = typeof place.displayName?.text === 'string' ? place.displayName.text.trim() : ''

      if (!id || !name || !category) {
        return null
      }

      grouped.set(category, (grouped.get(category) ?? 0) + 1)

      return {
        id,
        name,
        category,
        types: Array.isArray(place.types) ? place.types.filter((type): type is string => typeof type === 'string') : [],
      } satisfies NormalizedSiteContextPlace
    })
    .filter((place): place is NormalizedSiteContextPlace => place != null)

  const counts = (Object.keys(SITE_CONTEXT_CATEGORY_LABELS) as SiteContextCategory[])
    .map((category) => ({
      category,
      label: SITE_CONTEXT_CATEGORY_LABELS[category],
      count: grouped.get(category) ?? 0,
    }))
    .filter((entry) => entry.count > 0)

  return {
    radiusMeters: safeRadius,
    summary: summarizeSiteContext(safeRadius, counts),
    countsByCategory: counts,
    topPlaces: normalizedPlaces.map((place) => ({
      name: place.name,
      categoryLabel: place.category ? SITE_CONTEXT_CATEGORY_LABELS[place.category] : 'Unknown',
    })),
    source: {
      provider: 'google_places',
    },
  }
}

function isAbortLikeError(error: unknown): boolean {
  return !!error && typeof error === 'object' && 'name' in error && (error as { name?: unknown }).name === 'AbortError'
}

function isFetchFailure(error: unknown): boolean {
  if (!error || typeof error !== 'object') return false
  if (isAbortLikeError(error)) return true
  const candidate = error as { cause?: unknown; code?: unknown }
  if (typeof candidate.code === 'string' && candidate.code.length > 0) return true
  return !!candidate.cause && typeof candidate.cause === 'object' && 'code' in (candidate.cause as object)
}

function boundedPlacesError(message: string, status = 503): Error & { status: number } {
  const error = new Error(message) as Error & { status: number }
  error.status = status
  return error
}

async function parsePlacesPayload(response: Response): Promise<unknown> {
  try {
    return (await response.json()) as unknown
  } catch {
    throw boundedPlacesError('Google Places site context returned an invalid payload.', 500)
  }
}

export async function fetchGooglePlacesSiteContext(
  lat: number,
  lng: number,
  radiusMeters: number,
  env: NodeJS.ProcessEnv = process.env
): Promise<SitePlacesContextResponse> {
  const apiKey = getGooglePlacesApiKey(env)
  if (!apiKey) {
    throw boundedPlacesError('Google Places API key is not configured.', 503)
  }

  if (!Number.isFinite(lat) || !Number.isFinite(lng) || !Number.isFinite(radiusMeters)) {
    throw boundedPlacesError('Invalid site context coordinates or radius.', 400)
  }

  let response: Response
  try {
    response = await fetch(GOOGLE_PLACES_SEARCH_NEARBY_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Goog-Api-Key': apiKey,
        'X-Goog-FieldMask': DEFAULT_GOOGLE_PLACES_FIELD_MASK,
      },
      body: JSON.stringify({
        includedTypes: ['restaurant', 'cafe', 'grocery_store', 'supermarket', 'pharmacy', 'gym', 'shopping_mall', 'store'],
        maxResultCount: DEFAULT_GOOGLE_PLACES_LIMIT,
        locationRestriction: {
          circle: {
            center: { latitude: lat, longitude: lng },
            radius: Math.min(Math.max(1, Math.floor(radiusMeters)), MAX_GOOGLE_PLACES_RADIUS_METERS),
          },
        },
      }),
      signal: AbortSignal.timeout(12000),
    })
  } catch (error) {
    if (isFetchFailure(error)) {
      throw boundedPlacesError('Google Places site context request failed.', 503)
    }
    throw error
  }

  if (!response.ok) {
    throw boundedPlacesError('Google Places site context request failed.', 503)
  }

  const payload = await parsePlacesPayload(response)
  if (!isPlacesResponse(payload)) {
    throw boundedPlacesError('Google Places site context returned an invalid payload.', 500)
  }

  return normalizeGooglePlacesSiteContextResponse(radiusMeters, payload.places ?? [])
}

function isPlacesResponse(payload: unknown): payload is GooglePlacesSearchNearbyResponse {
  if (!payload || typeof payload !== 'object') return false
  const places = (payload as GooglePlacesSearchNearbyResponse).places
  return places === undefined || Array.isArray(places)
}

export { SITE_CONTEXT_CATEGORY_LABELS }
