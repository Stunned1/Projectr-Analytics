// Translates a zip code to lat/lng using zippopotam.us (free, no key)
// Then resolves FIPS via Census relationship files

export interface GeoResult {
  lat: number
  lng: number
  city: string
  state: string       // e.g. "VA"
  stateFips: string   // e.g. "51"
  countyFips: string  // e.g. "121"
  fullFips: string    // e.g. "51121"
}

// Maps state abbreviation → FIPS (needed for HUD + FRED)
const STATE_FIPS: Record<string, string> = {
  AL:'01',AK:'02',AZ:'04',AR:'05',CA:'06',CO:'08',CT:'09',DE:'10',FL:'12',GA:'13',
  HI:'15',ID:'16',IL:'17',IN:'18',IA:'19',KS:'20',KY:'21',LA:'22',ME:'23',MD:'24',
  MA:'25',MI:'26',MN:'27',MS:'28',MO:'29',MT:'30',NE:'31',NV:'32',NH:'33',NJ:'34',
  NM:'35',NY:'36',NC:'37',ND:'38',OH:'39',OK:'40',OR:'41',PA:'42',RI:'44',SC:'45',
  SD:'46',TN:'47',TX:'48',UT:'49',VT:'50',VA:'51',WA:'53',WV:'54',WI:'55',WY:'56',
  DC:'11',PR:'72',
}

const SUCCESS_TTL_MS = 24 * 60 * 60 * 1000
const MISS_TTL_MS = 15 * 60 * 1000

const resolvedCache = new Map<string, { expiresAt: number; value: GeoResult | null }>()
const inflight = new Map<string, Promise<GeoResult | null>>()

function parseCoord(v: unknown): number | null {
  const n = typeof v === 'number' ? v : parseFloat(String(v))
  return Number.isFinite(n) ? n : null
}

function parseStateFromMatchedAddress(matchedAddress: string): string | null {
  // Typical format: "1 MAIN ST, BLACKSBURG, VA, 24060"
  const m = matchedAddress.match(/,\s*([A-Z]{2})\s*,\s*\d{5}(?:-\d{4})?$/)
  return m?.[1] ?? null
}

async function resolveCountyFips(lat: number, lng: number): Promise<string> {
  try {
    const censusRes = await fetch(
      `https://geocoding.geo.census.gov/geocoder/geographies/coordinates?x=${lng}&y=${lat}&benchmark=Public_AR_Current&vintage=Current_Current&layers=Counties&format=json`,
      { next: { revalidate: 86400 }, signal: AbortSignal.timeout(10000) }
    )
    if (!censusRes.ok) return '000'
    const censusData = await censusRes.json()
    const county = censusData?.result?.geographies?.Counties?.[0]
    return county?.COUNTY ? String(county.COUNTY) : '000'
  } catch {
    return '000'
  }
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

async function geocodeViaCensusAddress(zip: string): Promise<{ lat: number; lng: number; city: string; state: string } | null> {
  try {
    const censusRes = await fetch(
      `https://geocoding.geo.census.gov/geocoder/locations/address?street=1+Main+St&zip=${zip}&benchmark=Public_AR_Current&format=json`,
      { next: { revalidate: 86400 }, signal: AbortSignal.timeout(10000) }
    )
    if (!censusRes.ok) return null
    const data = await censusRes.json()
    const match = data?.result?.addressMatches?.[0]
    const coords = match?.coordinates
    if (!coords) return null

    const lat = parseCoord(coords.y)
    const lng = parseCoord(coords.x)
    const city = match?.addressComponents?.city as string | undefined
    const stateFromComponents = match?.addressComponents?.state as string | undefined
    const state = stateFromComponents ?? parseStateFromMatchedAddress(match?.matchedAddress ?? '')

    if (lat === null || lng === null || !city || !state) return null
    return { lat, lng, city, state }
  } catch {
    return null
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
    const base =
      (await geocodeViaZippopotam(normalized)) ??
      (await geocodeViaCensusAddress(normalized))

    if (!base) return null

    const stateFips = STATE_FIPS[base.state]
    if (!stateFips) return null

    const countyFips = await resolveCountyFips(base.lat, base.lng)
    return {
      lat: base.lat,
      lng: base.lng,
      city: base.city,
      state: base.state,
      stateFips,
      countyFips,
      fullFips: `${stateFips}${countyFips}`,
    } satisfies GeoResult
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
