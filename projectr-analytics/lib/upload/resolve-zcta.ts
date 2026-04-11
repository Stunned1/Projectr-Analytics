/** Resolve USPS-style ZIP (ZCTA5) from coordinates using Census Geocoder (no API key). */

function extractZctaFromGeographies(geos: unknown): string | null {
  if (!geos || typeof geos !== 'object') return null

  for (const [bucketKey, value] of Object.entries(geos)) {
    if (!/ZCTA|ZIP\s+Code\s+Tabulation/i.test(bucketKey)) continue
    if (!Array.isArray(value) || value.length === 0) continue
    for (const entry of value) {
      if (!entry || typeof entry !== 'object') continue
      const row = entry as Record<string, unknown>
      for (const k of ['ZCTA5', 'ZCTA5CE20', 'ZCTA5CE10', 'GEOID', 'ZIP'] as const) {
        const v = row[k]
        if (typeof v !== 'string') continue
        const digits = v.replace(/\D/g, '')
        if (digits.length >= 5 && /^\d{5}/.test(digits)) return digits.slice(0, 5)
      }
    }
  }
  return null
}

async function censusZctaRequest(lat: number, lng: number, layers: string): Promise<string | null> {
  const url =
    `https://geocoding.geo.census.gov/geocoder/geographies/coordinates?` +
    `x=${encodeURIComponent(String(lng))}&y=${encodeURIComponent(String(lat))}` +
    `&benchmark=Public_AR_Current&vintage=Current_Current${layers}&format=json`

  const res = await fetch(url, { signal: AbortSignal.timeout(12000), cache: 'no-store' })
  if (!res.ok) return null
  const data = await res.json()
  return extractZctaFromGeographies(data?.result?.geographies)
}

async function zipFromGoogleReverse(lat: number, lng: number, apiKey: string): Promise<string | null> {
  const url =
    `https://maps.googleapis.com/maps/api/geocode/json?latlng=` +
    `${encodeURIComponent(`${lat},${lng}`)}&key=${encodeURIComponent(apiKey)}`
  try {
    const res = await fetch(url, { signal: AbortSignal.timeout(12000), cache: 'no-store' })
    if (!res.ok) return null
    const data = await res.json()
    const results = data?.results
    if (!Array.isArray(results) || results.length === 0) return null
    const components = results[0]?.address_components
    if (!Array.isArray(components)) return null
    const zipComp = components.find(
      (c: { types?: string[] }) => Array.isArray(c.types) && c.types.includes('postal_code')
    )
    const longName = typeof zipComp?.long_name === 'string' ? zipComp.long_name : ''
    const m = longName.match(/^(\d{5})(?:-\d{4})?$/)
    return m ? m[1] : null
  } catch {
    return null
  }
}

export interface ResolveZctaOptions {
  /** Used when Census does not return a ZCTA for the coordinates. */
  googleApiKey?: string | null
}

export async function resolveZctaFromCoordinates(
  lat: number,
  lng: number,
  options?: ResolveZctaOptions
): Promise<string | null> {
  try {
    const fromZctaLayer = await censusZctaRequest(lat, lng, '&layers=84')
    if (fromZctaLayer) return fromZctaLayer
    const fromDefault = await censusZctaRequest(lat, lng, '')
    if (fromDefault) return fromDefault
    const googleKey = options?.googleApiKey
    if (googleKey) {
      const fromGoogle = await zipFromGoogleReverse(lat, lng, googleKey)
      if (fromGoogle) return fromGoogle
    }
    return null
  } catch {
    return null
  }
}
