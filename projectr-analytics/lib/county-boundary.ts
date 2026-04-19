import { geoTrendsStub } from '@/lib/geocoder'

const TIGER_COUNTY_SERVICE =
  'https://tigerweb.geo.census.gov/arcgis/rest/services/TIGERweb/State_County/MapServer'

const COUNTY_LAYER_ID = 1

export function buildCountyBoundaryQueryUrl(
  stateAbbr: string,
  countyFips: string
): string | null {
  const stateFips = geoTrendsStub('', stateAbbr).stateFips
  const normalizedCountyFips = countyFips.trim()
  if (!stateFips || !/^\d{3}$/.test(normalizedCountyFips)) return null

  const params = new URLSearchParams({
    where: `STATE='${stateFips}' AND COUNTY='${normalizedCountyFips}'`,
    outFields: 'NAME,STATE,COUNTY,GEOID',
    geometryPrecision: '4',
    f: 'geojson',
  })

  return `${TIGER_COUNTY_SERVICE}/${COUNTY_LAYER_ID}/query?${params.toString()}`
}

export async function fetchCountyBoundaryFeature(
  stateAbbr: string,
  countyFips: string
): Promise<object | null> {
  const url = buildCountyBoundaryQueryUrl(stateAbbr, countyFips)
  if (!url) return null

  try {
    const res = await fetch(url, {
      next: { revalidate: 86400 * 30 },
      signal: AbortSignal.timeout(15000),
    })
    if (!res.ok) return null

    const geojson = await res.json()
    return geojson?.features?.[0] ?? null
  } catch {
    return null
  }
}
