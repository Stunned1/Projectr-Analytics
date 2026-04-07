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

export async function geocodeZip(zip: string): Promise<GeoResult | null> {
  try {
    // Step 1: lat/lng + state from zippopotam
    const zipRes = await fetch(`https://api.zippopotam.us/us/${zip}`, {
      next: { revalidate: 86400 },
    })
    if (!zipRes.ok) return null
    const zipData = await zipRes.json()
    const place = zipData.places?.[0]
    if (!place) return null

    const lat = parseFloat(place.latitude)
    const lng = parseFloat(place.longitude)
    const state = place['state abbreviation'] as string
    const stateFips = STATE_FIPS[state]
    if (!stateFips) return null

    // Step 2: county FIPS from Census geocoder (zip → county crosswalk)
    const censusRes = await fetch(
      `https://geocoding.geo.census.gov/geocoder/geographies/coordinates?x=${lng}&y=${lat}&benchmark=Public_AR_Current&vintage=Current_Current&layers=Counties&format=json`,
      { next: { revalidate: 86400 } }
    )

    let countyFips = '000'
    if (censusRes.ok) {
      const censusData = await censusRes.json()
      const county = censusData?.result?.geographies?.Counties?.[0]
      if (county?.COUNTY) countyFips = county.COUNTY
    }

    return {
      lat,
      lng,
      city: place['place name'],
      state,
      stateFips,
      countyFips,
      fullFips: `${stateFips}${countyFips}`,
    }
  } catch {
    return null
  }
}
