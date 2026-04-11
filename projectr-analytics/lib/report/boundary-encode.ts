import polyline from '@mapbox/polyline'

const TIGER_URL =
  'https://tigerweb.geo.census.gov/arcgis/rest/services/TIGERweb/tigerWMS_Current/MapServer/2/query'

function decimateRing(ring: [number, number][], maxPoints: number): [number, number][] {
  if (ring.length <= maxPoints) return ring
  const step = Math.ceil(ring.length / maxPoints)
  return ring.filter((_, i) => i % step === 0)
}

/** Google Static Maps compatible encoded polyline for ZIP outline (fill + stroke via path param). */
export async function encodeZipBoundaryPolyline(zip: string): Promise<string | null> {
  try {
    const url = `${TIGER_URL}?where=ZCTA5%3D'${zip}'&outFields=ZCTA5&geometryPrecision=4&f=geojson`
    const res = await fetch(url, { next: { revalidate: 86400 * 30 } })
    if (!res.ok) return null
    const geojson = await res.json()
    const ring = geojson?.features?.[0]?.geometry?.coordinates?.[0] as [number, number][] | undefined
    if (!ring?.length) return null
    const trimmed = decimateRing(ring, 72)
    const latLng: [number, number][] = trimmed.map(([lng, lat]) => [lat, lng])
    return polyline.encode(latLng)
  } catch {
    return null
  }
}
