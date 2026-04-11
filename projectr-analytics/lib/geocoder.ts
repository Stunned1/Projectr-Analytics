// ZIP → lat/lng: Zippopotam (free) first, then Census 2020 ZCTA internal point (TigerWeb) + county FIPS.
// Results persist to Supabase `zip_geocode_cache` (365d TTL) and an in-process LRU for hot paths.

import { supabase } from '@/lib/supabase'

export interface GeoResult {
  lat: number
  lng: number
  city: string
  state: string // e.g. "VA"
  stateFips: string // e.g. "51"
  countyFips: string // e.g. "121"
  fullFips: string // e.g. "51121"
}

const STATE_FIPS: Record<string, string> = {
  AL:'01',AK:'02',AZ:'04',AR:'05',CA:'06',CO:'08',CT:'09',DE:'10',FL:'12',GA:'13',
  HI:'15',ID:'16',IL:'17',IN:'18',IA:'19',KS:'20',KY:'21',LA:'22',ME:'23',MD:'24',
  MA:'25',MI:'26',MN:'27',MS:'28',MO:'29',MT:'30',NE:'31',NV:'32',NH:'33',NJ:'34',
  NM:'35',NY:'36',NC:'37',ND:'38',OH:'39',OK:'40',OR:'41',PA:'42',RI:'44',SC:'45',
  SD:'46',TN:'47',TX:'48',UT:'49',VT:'50',VA:'51',WA:'53',WV:'54',WI:'55',WY:'56',
  DC:'11',PR:'72',
}

const STATE_FIPS_TO_ABBR: Record<string, string> = Object.fromEntries(
  Object.entries(STATE_FIPS).map(([abbr, fips]) => [fips, abbr])
)

const TIGERWEB_ZCTA_LAYER =
  'https://tigerweb.geo.census.gov/arcgis/rest/services/TIGERweb/PUMA_TAD_TAZ_UGA_ZCTA/MapServer/1/query'

const SUCCESS_TTL_MS = 24 * 60 * 60 * 1000
const MISS_TTL_MS = 15 * 60 * 1000
const DB_CACHE_MAX_AGE_MS = 365 * 24 * 60 * 60 * 1000

const resolvedCache = new Map<string, { expiresAt: number; value: GeoResult | null }>()
const inflight = new Map<string, Promise<GeoResult | null>>()

function parseCoord(v: unknown): number | null {
  if (v == null) return null
  const s = String(v).replace(/^\+/, '').trim()
  const n = typeof v === 'number' ? v : parseFloat(s)
  return Number.isFinite(n) ? n : null
}

interface CountyHit {
  stateFips: string
  countyFips: string
  countyBasename: string | null
}

async function fetchCountyFromLatLng(lat: number, lng: number): Promise<CountyHit | null> {
  try {
    const censusRes = await fetch(
      `https://geocoding.geo.census.gov/geocoder/geographies/coordinates?x=${lng}&y=${lat}&benchmark=Public_AR_Current&vintage=Current_Current&layers=Counties&format=json`,
      { next: { revalidate: 86400 }, signal: AbortSignal.timeout(10000) }
    )
    if (!censusRes.ok) return null
    const censusData = await censusRes.json()
    const county = censusData?.result?.geographies?.Counties?.[0]
    if (!county?.COUNTY || county.STATE == null) return null
    return {
      countyFips: String(county.COUNTY),
      stateFips: String(county.STATE),
      countyBasename: typeof county.BASENAME === 'string' ? county.BASENAME : null,
    }
  } catch {
    return null
  }
}

async function resolveCountyFips(lat: number, lng: number): Promise<string> {
  const hit = await fetchCountyFromLatLng(lat, lng)
  return hit?.countyFips ?? '000'
}

async function geocodeViaZippopotam(zip: string): Promise<{ lat: number; lng: number; city: string; state: string } | null> {
  try {
    const zipRes = await fetch(`https://api.zippopotam.us/us/${zip}`, {
      next: { revalidate: 86400 },
      signal: AbortSignal.timeout(8000),
    })
    if (!zipRes.ok) return null
    const zipData = await zipRes.json()
    const place = zipData.places?.[0]
    if (!place) return null

    const lat = parseCoord(place.latitude)
    const lng = parseCoord(place.longitude)
    const city = place['place name'] as string | undefined
    const state = place['state abbreviation'] as string | undefined

    if (lat === null || lng === null || !city || !state) return null
    return { lat, lng, city, state }
  } catch {
    return null
  }
}

/** 2020 ZCTA internal point (INTPT) from Census TigerWeb — no synthetic street address. */
async function geocodeViaCensusZctaInternalPoint(zip: string): Promise<GeoResult | null> {
  try {
    const params = new URLSearchParams({
      where: `ZCTA5='${zip}'`,
      outFields: 'ZCTA5,INTPTLAT,INTPTLON',
      returnGeometry: 'false',
      f: 'json',
    })
    const res = await fetch(`${TIGERWEB_ZCTA_LAYER}?${params}`, {
      next: { revalidate: 86400 },
      signal: AbortSignal.timeout(12000),
    })
    if (!res.ok) return null
    const data = await res.json()
    const attrs = data?.features?.[0]?.attributes
    if (!attrs) return null

    const lat = parseCoord(attrs.INTPTLAT)
    const lng = parseCoord(attrs.INTPTLON)
    if (lat === null || lng === null) return null

    const countyHit = await fetchCountyFromLatLng(lat, lng)
    if (!countyHit) return null

    const stateAbbr = STATE_FIPS_TO_ABBR[countyHit.stateFips]
    if (!stateAbbr) return null

    return {
      lat,
      lng,
      city: countyHit.countyBasename ?? `ZIP ${zip}`,
      state: stateAbbr,
      stateFips: countyHit.stateFips,
      countyFips: countyHit.countyFips,
      fullFips: `${countyHit.stateFips}${countyHit.countyFips}`,
    } satisfies GeoResult
  } catch {
    return null
  }
}

function rowToGeo(row: {
  lat: number
  lng: number
  city: string
  state: string
  state_fips: string
  county_fips: string
}): GeoResult {
  return {
    lat: row.lat,
    lng: row.lng,
    city: row.city,
    state: row.state,
    stateFips: row.state_fips,
    countyFips: row.county_fips,
    fullFips: `${row.state_fips}${row.county_fips}`,
  }
}

async function readGeocodeFromDb(zip: string): Promise<GeoResult | null> {
  try {
    const cutoff = new Date(Date.now() - DB_CACHE_MAX_AGE_MS).toISOString()
    const { data, error } = await supabase
      .from('zip_geocode_cache')
      .select('lat, lng, city, state, state_fips, county_fips, updated_at')
      .eq('zip', zip)
      .gte('updated_at', cutoff)
      .maybeSingle()

    if (error || !data) return null
    return rowToGeo(data as { lat: number; lng: number; city: string; state: string; state_fips: string; county_fips: string })
  } catch {
    return null
  }
}

async function persistGeocodeToDb(zip: string, geo: GeoResult, source: string): Promise<void> {
  try {
    await supabase.from('zip_geocode_cache').upsert(
      {
        zip,
        lat: geo.lat,
        lng: geo.lng,
        city: geo.city,
        state: geo.state,
        state_fips: geo.stateFips,
        county_fips: geo.countyFips,
        source,
        updated_at: new Date().toISOString(),
      },
      { onConflict: 'zip' }
    )
  } catch {
    /* table missing or RLS — in-process cache still helps */
  }
}

export async function geocodeZip(zip: string): Promise<GeoResult | null> {
  const normalized = zip.trim()
  if (!/^\d{5}$/.test(normalized)) return null

  const cached = resolvedCache.get(normalized)
  if (cached && cached.expiresAt > Date.now()) {
    return cached.value
  }

  const existing = inflight.get(normalized)
  if (existing) return existing

  const request = (async () => {
    const fromDb = await readGeocodeFromDb(normalized)
    if (fromDb) return fromDb

    const base =
      (await geocodeViaZippopotam(normalized)) ??
      null

    if (base) {
      const stateFips = STATE_FIPS[base.state]
      if (!stateFips) return null

      const countyFips = await resolveCountyFips(base.lat, base.lng)
      const result: GeoResult = {
        lat: base.lat,
        lng: base.lng,
        city: base.city,
        state: base.state,
        stateFips,
        countyFips,
        fullFips: `${stateFips}${countyFips}`,
      }
      await persistGeocodeToDb(normalized, result, 'zippopotam')
      return result
    }

    const fromZcta = await geocodeViaCensusZctaInternalPoint(normalized)
    if (fromZcta) {
      await persistGeocodeToDb(normalized, fromZcta, 'census_zcta')
    }
    return fromZcta
  })()

  inflight.set(normalized, request)
  try {
    const result = await request
    resolvedCache.set(normalized, {
      value: result,
      expiresAt: Date.now() + (result ? SUCCESS_TTL_MS : MISS_TTL_MS),
    })
    return result
  } finally {
    inflight.delete(normalized)
  }
}
