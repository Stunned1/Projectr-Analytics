/**
 * Google Geocoding API — freeform addresses and place names (Client CSV normalize, upload pipeline).
 * Prefer a server-only key when available.
 */

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

/** Prefers ROOFTOP / RANGE_INTERPOLATED when multiple results exist. */
export async function geocodeAddressForward(address: string): Promise<ForwardGeocodeResult | null> {
  const key = getGoogleForwardGeocodeKey()
  if (!key) return null

  const trimmed = address.trim()
  if (trimmed.length < 3) return null

  const url = `https://maps.googleapis.com/maps/api/geocode/json?address=${encodeURIComponent(trimmed)}&key=${encodeURIComponent(key)}`
  try {
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
    return { lat: loc.lat, lng: loc.lng, formattedAddress, postalCode }
  } catch {
    return null
  }
}
