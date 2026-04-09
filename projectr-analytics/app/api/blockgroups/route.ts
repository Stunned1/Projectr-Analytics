/**
 * Census Block Group boundaries + ACS data for a county
 * Returns GeoJSON FeatureCollection with population density per block group
 * Used for sub-ZIP choropleth visualization
 */
import { type NextRequest, NextResponse } from 'next/server'

export const dynamic = 'force-dynamic'

const TIGER_URL = 'https://tigerweb.geo.census.gov/arcgis/rest/services/TIGERweb/tigerWMS_Current/MapServer/10/query'
const CENSUS_URL = 'https://api.census.gov/data/2022/acs/acs5'

export async function GET(request: NextRequest) {
  const stateFips = request.nextUrl.searchParams.get('state')
  const countyFips = request.nextUrl.searchParams.get('county')

  if (!stateFips || !countyFips) {
    return NextResponse.json({ error: 'Missing state or county FIPS' }, { status: 400 })
  }

  try {
    // Fetch block group boundaries + ACS data in parallel
    const [boundaryRes, acsRes] = await Promise.all([
      fetch(
        `${TIGER_URL}?where=STATE%3D'${stateFips}'+AND+COUNTY%3D'${countyFips}'&outFields=GEOID,STATE,COUNTY,TRACT,BLKGRP&geometryPrecision=4&f=geojson`,
        { cache: 'no-store' } // skip Next.js cache — response can be >2MB
      ),
      fetch(
        `${CENSUS_URL}?get=B01003_001E,B25001_001E,B25003_002E&for=block%20group:*&in=state:${stateFips}%20county:${countyFips}&key=${process.env.CENSUS_API_KEY}`,
        { next: { revalidate: 86400 * 7 } }
      ),
    ])

    if (!boundaryRes.ok) return NextResponse.json({ error: 'Boundary fetch failed' }, { status: 500 })

    const geojson = await boundaryRes.json()

    // Build a lookup of ACS data by GEOID (state+county+tract+blockgroup)
    const acsMap: Record<string, { population: number; housing_units: number; owner_occupied: number }> = {}
    if (acsRes.ok) {
      const acsData = await acsRes.json()
      const headers: string[] = acsData[0]
      const popIdx = headers.indexOf('B01003_001E')
      const huIdx = headers.indexOf('B25001_001E')
      const ooIdx = headers.indexOf('B25003_002E')
      const stateIdx = headers.indexOf('state')
      const countyIdx = headers.indexOf('county')
      const tractIdx = headers.indexOf('tract')
      const bgIdx = headers.indexOf('block group')

      for (const row of acsData.slice(1)) {
        const geoid = `${row[stateIdx]}${row[countyIdx]}${row[tractIdx]}${row[bgIdx]}`
        const pop = parseInt(row[popIdx])
        acsMap[geoid] = {
          population: isNaN(pop) || pop < 0 ? 0 : pop,
          housing_units: parseInt(row[huIdx]) || 0,
          owner_occupied: parseInt(row[ooIdx]) || 0,
        }
      }
    }

    // Merge ACS data into GeoJSON properties
    for (const feature of geojson.features ?? []) {
      const geoid = feature.properties?.GEOID
      const acs = acsMap[geoid] ?? { population: 0, housing_units: 0, owner_occupied: 0 }
      feature.properties = { ...feature.properties, ...acs }
    }

    // Warn if response is large
    const featureCount = geojson.features?.length ?? 0
    if (featureCount > 300) {
      // Large county — return a sample to keep response manageable
      geojson.features = geojson.features.slice(0, 300)
    }

    return NextResponse.json(geojson)
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Unexpected error'
    return NextResponse.json({ error: message }, { status: 500 })
  }
}
