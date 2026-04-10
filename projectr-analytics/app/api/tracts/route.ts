/**
 * Census Tract boundaries + ACS data (rent, income, vacancy)
 * Better than block groups — larger, more meaningful, better data coverage
 * Used for sub-ZIP choropleth showing rent/income variation across neighborhoods
 */
import { type NextRequest, NextResponse } from 'next/server'

export const dynamic = 'force-dynamic'

const TIGER_URL = 'https://tigerweb.geo.census.gov/arcgis/rest/services/TIGERweb/tigerWMS_Current/MapServer/8/query'
const CENSUS_URL = 'https://api.census.gov/data/2022/acs/acs5'

export async function GET(request: NextRequest) {
  const stateFips = request.nextUrl.searchParams.get('state')
  const countyFips = request.nextUrl.searchParams.get('county')

  if (!stateFips || !countyFips) {
    return NextResponse.json({ error: 'Missing state or county FIPS' }, { status: 400 })
  }

  try {
    const [boundaryRes, acsRes] = await Promise.all([
      fetch(
        `${TIGER_URL}?where=STATE%3D'${stateFips}'+AND+COUNTY%3D'${countyFips}'&outFields=GEOID,TRACT&geometryPrecision=4&f=geojson`,
        { cache: 'no-store' }
      ),
      fetch(
        `${CENSUS_URL}?get=B25064_001E,B19013_001E,B25002_001E,B25002_003E,B01003_001E&for=tract:*&in=state:${stateFips}%20county:${countyFips}&key=${process.env.CENSUS_API_KEY}`,
        { next: { revalidate: 86400 * 7 } }
      ),
    ])

    if (!boundaryRes.ok) return NextResponse.json({ error: 'Boundary fetch failed' }, { status: 500 })
    const geojson = await boundaryRes.json()

    // Build ACS lookup by tract GEOID
    const acsMap: Record<string, {
      median_rent: number | null
      median_income: number | null
      vacancy_rate: number | null
      population: number | null
    }> = {}

    if (acsRes.ok) {
      const acsData = await acsRes.json()
      const headers: string[] = acsData[0]
      const rentIdx = headers.indexOf('B25064_001E')
      const incomeIdx = headers.indexOf('B19013_001E')
      const totalUnitsIdx = headers.indexOf('B25002_001E')
      const vacantIdx = headers.indexOf('B25002_003E')
      const popIdx = headers.indexOf('B01003_001E')
      const stateIdx = headers.indexOf('state')
      const countyIdx = headers.indexOf('county')
      const tractIdx = headers.indexOf('tract')

      for (const row of acsData.slice(1)) {
        const geoid = `${row[stateIdx]}${row[countyIdx]}${row[tractIdx]}`
        const rent = parseInt(row[rentIdx])
        const income = parseInt(row[incomeIdx])
        const totalUnits = parseInt(row[totalUnitsIdx])
        const vacant = parseInt(row[vacantIdx])
        const pop = parseInt(row[popIdx])

        acsMap[geoid] = {
          median_rent: rent > 0 ? rent : null,
          median_income: income > 0 ? income : null,
          vacancy_rate: totalUnits > 0 && vacant >= 0 ? parseFloat(((vacant / totalUnits) * 100).toFixed(1)) : null,
          population: pop > 0 ? pop : null,
        }
      }
    }

    // Merge ACS into GeoJSON
    for (const feature of geojson.features ?? []) {
      const geoid = feature.properties?.GEOID
      const acs = acsMap[geoid] ?? { median_rent: null, median_income: null, vacancy_rate: null, population: null }
      feature.properties = { ...feature.properties, ...acs }
    }

    return NextResponse.json(geojson)
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Unexpected error'
    return NextResponse.json({ error: message }, { status: 500 })
  }
}
