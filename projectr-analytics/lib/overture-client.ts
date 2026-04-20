const OVERTURE_URL = 'https://api.overturemapsapi.com/places'
const DEMO_KEY = 'DEMO-API-KEY'

export interface OverturePlace {
  id: string
  geometry: { type: string; coordinates: [number, number] }
  properties: {
    names: { primary: string }
    categories: { primary: string; alternate?: string[] }
    brand?: { names?: { primary?: string } }
    addresses?: Array<{ freeform?: string; locality?: string; postcode?: string }>
    confidence?: number
  }
}

export type OverturePlacesResponse = OverturePlace[] | { value?: OverturePlace[] | null }

export function getOvertureApiKey(env: NodeJS.ProcessEnv = process.env): string {
  const configured = env.OVERTURE_API_KEY?.trim()
  return configured && configured.length > 0 ? configured : DEMO_KEY
}

export function normalizeOverturePlacesResponse(payload: OverturePlacesResponse | null | undefined): OverturePlace[] {
  if (Array.isArray(payload)) return payload
  if (payload && Array.isArray(payload.value)) return payload.value
  return []
}

export function getOvertureApiKeyForTest(env: NodeJS.ProcessEnv = process.env): string {
  return getOvertureApiKey(env)
}

export function normalizeOverturePlacesResponseForTest(
  payload: OverturePlacesResponse | null | undefined
): OverturePlace[] {
  return normalizeOverturePlacesResponse(payload)
}

export async function fetchOverturePlaces(
  lat: number,
  lng: number,
  radius: number,
  categories?: string,
  limit = 500,
  extraParams?: Record<string, string | number | undefined>,
  options?: { throwOnHttpError?: boolean }
): Promise<OverturePlace[]> {
  const params = new URLSearchParams({
    lat: lat.toString(),
    lng: lng.toString(),
    radius: radius.toString(),
    limit: limit.toString(),
    format: 'json',
  })
  if (categories) params.set('categories', categories)
  if (extraParams) {
    for (const [key, value] of Object.entries(extraParams)) {
      if (value === undefined) continue
      params.set(key, value.toString())
    }
  }

  const res = await fetch(`${OVERTURE_URL}?${params}`, {
    headers: { 'x-api-key': getOvertureApiKey() },
    next: { revalidate: 86400 * 7 },
    signal: AbortSignal.timeout(12000),
  })

  if (!res.ok) {
    if (options?.throwOnHttpError) {
      const error = new Error(`Overture request failed: ${res.status} ${res.statusText}`) as Error & {
        status?: number
      }
      error.status = res.status
      throw error
    }
    return []
  }
  return normalizeOverturePlacesResponse((await res.json()) as OverturePlacesResponse)
}
