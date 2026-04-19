import { type NextRequest, NextResponse } from 'next/server'
import { hydrateAreaZipResults } from '@/lib/area-search'
import { buildCountyAreaKey, normalizeCountyDisplayName } from '@/lib/area-keys'
import { fetchCountyBoundaryFeature } from '@/lib/county-boundary'
import { fetchTexasZctaRowsByCounty } from '@/lib/data/bigquery-texas-zcta'
import {
  mergeTexasCountyCoverageRows,
  shouldMergeTexasCountyCoverage,
  type CountyZipCoverageRow,
} from '@/lib/data/texas-county-coverage'
import { geoTrendsStub, geocodeZip } from '@/lib/geocoder'
import { supabase } from '@/lib/supabase'
import { normalizeUsStateToAbbr } from '@/lib/us-state-abbr'

export const dynamic = 'force-dynamic'

const MAX_COUNTY_ZIPS = 400
const TIGER_COUNTY_LAYER =
  'https://tigerweb.geo.census.gov/arcgis/rest/services/TIGERweb/State_County/MapServer/1/query'
const TIGER_ZCTA_LAYER =
  'https://tigerweb.geo.census.gov/arcgis/rest/services/TIGERweb/PUMA_TAD_TAZ_UGA_ZCTA/MapServer/1/query'

type CountyLookupRow = CountyZipCoverageRow

type TigerCountyFeature = {
  geometry?: Record<string, unknown> | null
}

type TigerZctaFeature = {
  attributes?: {
    ZCTA5?: string | null
    INTPTLAT?: string | number | null
    INTPTLON?: string | number | null
  } | null
}

function parseCoordinate(value: unknown): number | null {
  if (typeof value === 'number' && Number.isFinite(value)) return value
  if (typeof value !== 'string') return null
  const parsed = Number.parseFloat(value)
  return Number.isFinite(parsed) ? parsed : null
}

async function resolveCountyFips(countyName: string, stateAbbr: string): Promise<string | null> {
  const stateFips = geoTrendsStub(countyName, stateAbbr).stateFips
  if (!stateFips) return null

  try {
    const params = new URLSearchParams({
      get: 'NAME',
      for: 'county:*',
      in: `state:${stateFips}`,
    })
    if (process.env.CENSUS_API_KEY) {
      params.set('key', process.env.CENSUS_API_KEY)
    }

    const res = await fetch(`https://api.census.gov/data/2020/dec/pl?${params.toString()}`, {
      next: { revalidate: 86400 },
      signal: AbortSignal.timeout(10000),
    })
    if (!res.ok) return null

    const rows = (await res.json()) as string[][]
    const countyBase = countyName.replace(/\s+county$/i, '').trim().toLowerCase()
    for (const row of rows.slice(1)) {
      const [name, , countyFips] = row
      const base = String(name ?? '')
        .replace(/\s+County,.*$/i, '')
        .trim()
        .toLowerCase()
      if (base === countyBase && countyFips) return countyFips
    }
    return null
  } catch {
    return null
  }
}

async function fetchCountyTigerFallbackRows(countyFips: string, stateAbbr: string): Promise<CountyLookupRow[]> {
  const stateFips = geoTrendsStub('', stateAbbr).stateFips
  if (!stateFips) return []

  try {
    const countyParams = new URLSearchParams({
      where: `STATE='${stateFips}' AND COUNTY='${countyFips}'`,
      outFields: 'GEOID',
      returnGeometry: 'true',
      f: 'json',
    })

    const countyRes = await fetch(`${TIGER_COUNTY_LAYER}?${countyParams.toString()}`, {
      next: { revalidate: 86400 },
      signal: AbortSignal.timeout(15000),
    })
    if (!countyRes.ok) return []

    const countyData = (await countyRes.json()) as { features?: TigerCountyFeature[] }
    const countyGeometry = countyData.features?.[0]?.geometry
    if (!countyGeometry) return []

    const zctaBody = new URLSearchParams({
      geometry: JSON.stringify(countyGeometry),
      geometryType: 'esriGeometryPolygon',
      inSR: '102100',
      spatialRel: 'esriSpatialRelIntersects',
      outFields: 'ZCTA5,INTPTLAT,INTPTLON',
      returnGeometry: 'false',
      f: 'json',
    })

    const zctaRes = await fetch(TIGER_ZCTA_LAYER, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded;charset=UTF-8' },
      body: zctaBody.toString(),
      signal: AbortSignal.timeout(20000),
    })
    if (!zctaRes.ok) return []

    const zctaData = (await zctaRes.json()) as { features?: TigerZctaFeature[] }
    const tigerRows = (zctaData.features ?? [])
      .map((feature) => {
        const zip = String(feature.attributes?.ZCTA5 ?? '').trim()
        if (!/^\d{5}$/.test(zip)) return null
        return {
          zip,
          lat: parseCoordinate(feature.attributes?.INTPTLAT),
          lng: parseCoordinate(feature.attributes?.INTPTLON),
        }
      })
      .filter((row): row is { zip: string; lat: number | null; lng: number | null } => row !== null)

    const zipList = Array.from(new Set(tigerRows.map((row) => row.zip))).slice(0, MAX_COUNTY_ZIPS)
    if (zipList.length === 0) return []

    const [{ data: lookupRows }, { data: cacheRows }] = await Promise.all([
      supabase
        .from('zip_metro_lookup')
        .select('zip, city, state, metro_name, lat, lng')
        .in('zip', zipList)
        .limit(MAX_COUNTY_ZIPS),
      supabase
        .from('zip_geocode_cache')
        .select('zip, city, state, lat, lng, county_fips')
        .in('zip', zipList)
        .limit(MAX_COUNTY_ZIPS),
    ])

    const tigerByZip = new Map(tigerRows.map((row) => [row.zip, row]))
    const lookupByZip = new Map(
      ((lookupRows ?? []) as CountyLookupRow[]).map((row) => [row.zip, row])
    )
    const cacheByZip = new Map(
      ((cacheRows ?? []) as Array<{
        zip: string
        city: string | null
        state: string | null
        lat: number | null
        lng: number | null
        county_fips: string | null
      }>).map((row) => [row.zip, row])
    )

    const validatedRows: Array<CountyLookupRow | null> = await Promise.all(
      zipList.map(async (zip) => {
        const cache = cacheByZip.get(zip)
        const cachedCountyFips = cache?.county_fips?.trim() || null
        if (cachedCountyFips && cachedCountyFips !== countyFips) return null
        if (!cachedCountyFips) {
          const geocoded = await geocodeZip(zip)
          if (!geocoded || geocoded.countyFips !== countyFips) return null
        }

        const lookup = lookupByZip.get(zip)
        const tiger = tigerByZip.get(zip)
        const lat = lookup?.lat ?? cache?.lat ?? tiger?.lat ?? null
        const lng = lookup?.lng ?? cache?.lng ?? tiger?.lng ?? null

        return {
          zip,
          city: lookup?.city ?? cache?.city ?? `ZIP ${zip}`,
          state: lookup?.state ?? cache?.state ?? stateAbbr ?? null,
          metro_name: lookup?.metro_name ?? null,
          lat,
          lng,
        } satisfies CountyLookupRow
      })
    )

    return validatedRows.filter(
      (row): row is CountyLookupRow => row != null && row.lat != null && row.lng != null
    )
  } catch {
    return []
  }
}

export async function GET(request: NextRequest) {
  const countyRaw = request.nextUrl.searchParams.get('county')?.trim()
  const stateRaw = request.nextUrl.searchParams.get('state')?.trim()

  if (!countyRaw) {
    return NextResponse.json({ error: 'Missing county' }, { status: 400 })
  }

  const stateAbbr = stateRaw ? normalizeUsStateToAbbr(stateRaw) : undefined
  if (stateRaw && !stateAbbr) {
    return NextResponse.json({ error: `Unrecognized state "${stateRaw}"` }, { status: 400 })
  }

  const countyName = normalizeCountyDisplayName(countyRaw)

  try {
    let resolvedCountyFips: string | null = null
    let query = supabase
      .from('zip_metro_lookup')
      .select('zip, city, state, metro_name, lat, lng, county_name')
      .not('lat', 'is', null)
      .limit(MAX_COUNTY_ZIPS)

    if (stateAbbr) query = query.eq('state', stateAbbr)

    const { data: exactRows } = await query.ilike('county_name', countyName)

    let rows: CountyLookupRow[] = (exactRows ?? []) as CountyLookupRow[]
    if (rows.length === 0) {
      const fuzzyPattern = `%${countyName.replace(/\s+county$/i, '').trim()}%`
      let fuzzyQuery = supabase
        .from('zip_metro_lookup')
        .select('zip, city, state, metro_name, lat, lng, county_name')
        .not('lat', 'is', null)
        .limit(MAX_COUNTY_ZIPS)

      if (stateAbbr) fuzzyQuery = fuzzyQuery.eq('state', stateAbbr)
      const { data: fuzzyRows } = await fuzzyQuery.ilike('county_name', fuzzyPattern)
      rows = (fuzzyRows ?? []) as CountyLookupRow[]
    }

    const canonicalStateAbbr = stateAbbr ?? undefined

    if (shouldMergeTexasCountyCoverage(canonicalStateAbbr, rows)) {
      const texasCoverageRows = await fetchTexasZctaRowsByCounty(countyName, canonicalStateAbbr, {
        limit: MAX_COUNTY_ZIPS,
      })
      if (texasCoverageRows.length > 0) {
        rows = mergeTexasCountyCoverageRows(rows, texasCoverageRows)
      }
    }

    // Some environments have `zip_metro_lookup.county_name` populated incorrectly (e.g. "TX").
    // Fall back to `zip_geocode_cache` county FIPS so Texas county search still resolves.
    if (rows.length === 0 && stateAbbr) {
      resolvedCountyFips = await resolveCountyFips(countyName, stateAbbr)
      if (resolvedCountyFips) {
        const { data: cachedCountyZips } = await supabase
          .from('zip_geocode_cache')
          .select('zip')
          .eq('state', stateAbbr)
          .eq('county_fips', resolvedCountyFips)
          .limit(MAX_COUNTY_ZIPS)

        const cachedCountyZipRows = (cachedCountyZips ?? []) as Array<{ zip: string | null }>
        const zipList = Array.from(
          new Set(cachedCountyZipRows.map((row) => row.zip).filter((zip): zip is string => Boolean(zip)))
        )
        if (zipList.length > 0) {
          const { data: lookupRows } = await supabase
            .from('zip_metro_lookup')
            .select('zip, city, state, metro_name, lat, lng')
            .in('zip', zipList)
            .not('lat', 'is', null)
            .limit(MAX_COUNTY_ZIPS)

          rows = (lookupRows ?? []) as CountyLookupRow[]
        }

        if (rows.length === 0) {
          rows = await fetchCountyTigerFallbackRows(resolvedCountyFips, stateAbbr)
        }
      }
    }

    if (rows.length === 0) {
      return NextResponse.json({ error: `No ZIPs found for "${countyRaw}"`, zips: [] }, { status: 404 })
    }

    const results = await hydrateAreaZipResults(
      rows.map((row) => ({
        zip: row.zip,
        city: row.city,
        state: row.state,
        metro_name: row.metro_name,
        lat: row.lat,
        lng: row.lng,
      }))
    )

    const labelState = stateAbbr ?? rows[0]?.state ?? null
    const label = labelState ? `${countyName}, ${labelState}` : countyName
    if (!resolvedCountyFips && labelState) {
      resolvedCountyFips = await resolveCountyFips(countyName, labelState)
    }
    const boundary =
      labelState && resolvedCountyFips
        ? await fetchCountyBoundaryFeature(labelState, resolvedCountyFips)
        : null

    return NextResponse.json({
      kind: 'county',
      county: countyName,
      state: labelState,
      area_key: labelState ? buildCountyAreaKey(countyName, labelState) : null,
      zip_count: results.length,
      boundary,
      zips: results,
      label,
    })
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Unexpected error'
    return NextResponse.json({ error: message }, { status: 500 })
  }
}
