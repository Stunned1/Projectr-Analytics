import { transformFredData, transformHudData, transformCensusData } from './transformers'
import type { GeoResult } from './geocoder'
import type { MasterDataRow } from './supabase'

type PartialRow = Omit<MasterDataRow, 'id' | 'created_at'>

// ── FRED ──────────────────────────────────────────────────────────────────────
// Searches for the monthly unemployment series for a county, then fetches it.
// FRED doesn't have a predictable series ID for monthly county data, so we search.
export async function fetchFred(geo: GeoResult, zip: string): Promise<PartialRow[]> {
  const key = process.env.FRED_API_KEY
  const searchQuery = `unemployment rate ${geo.city} county ${geo.state}`

  try {
    // Find the monthly series for this county
    const searchUrl = `https://api.stlouisfed.org/fred/series/search?search_text=${encodeURIComponent(searchQuery)}&api_key=${key}&file_type=json&limit=10`
    const searchRes = await fetch(searchUrl, { next: { revalidate: 604800 } })
    if (!searchRes.ok) return []

    const searchData = await searchRes.json()
    // Pick the monthly unemployment rate series (not annual, not persons)
    const series = (searchData.seriess ?? []).find(
      (s: { title: string; frequency_short: string }) =>
        s.title.toLowerCase().includes('unemployment rate') &&
        s.frequency_short === 'M'
    )
    if (!series) return []

    const obsUrl = `https://api.stlouisfed.org/fred/series/observations?series_id=${series.id}&api_key=${key}&file_type=json&sort_order=desc&limit=24`
    const obsRes = await fetch(obsUrl, { next: { revalidate: 604800 } })
    if (!obsRes.ok) return []

    const obsData = await obsRes.json()
    return transformFredData(series.id, 'Unemployment_Rate', obsData.observations ?? [], zip)
  } catch {
    return []
  }
}

// ── HUD / RENT BY BEDROOMS ────────────────────────────────────────────────────
// HUD API requires a free Bearer token (get one at huduser.gov/portal/dataset/fmr-api.html).
// If HUD_API_TOKEN is set, we use the live API. Otherwise we fall back to
// Census ACS B25031 (median gross rent by bedrooms) which is always free.
export async function fetchHud(geo: GeoResult, zip: string): Promise<PartialRow[]> {
  const hudToken = process.env.HUD_API_TOKEN

  if (hudToken) {
    try {
      const res = await fetch(`https://www.huduser.gov/hudapi/public/fmr/data/${zip}`, {
        headers: { Authorization: `Bearer ${hudToken}` },
        next: { revalidate: 2592000 },
      })
      if (res.ok) {
        const data = await res.json()
        const basicdata = data?.data?.basicdata
        if (basicdata) {
          const fmrMap: Record<string, number> = {
            '0': basicdata.Efficiency,
            '1': basicdata.One_Bedroom,
            '2': basicdata.Two_Bedroom,
            '3': basicdata.Three_Bedroom,
            '4': basicdata.Four_Bedroom,
          }
          return transformHudData(fmrMap, zip)
        }
      }
    } catch { /* fall through to Census fallback */ }
  }

  // Fallback: Census ACS B25031 — median gross rent by bedrooms
  try {
    const key = process.env.CENSUS_API_KEY
    const vars = 'B25031_001E,B25031_002E,B25031_003E,B25031_004E,B25031_005E,B25031_006E'
    const url = `https://api.census.gov/data/2022/acs/acs5?get=${vars}&for=zip%20code%20tabulation%20area:${zip}&key=${key}`
    const res = await fetch(url, { next: { revalidate: 604800 } })
    if (!res.ok) return []

    const data = await res.json()
    if (!data[1]) return []

    const values: string[] = data[1]
    // B25031 response: [0]=all rents, [1]=studio, [2]=1BR, [3]=2BR, [4]=3BR, [5]=4BR, [6]=ZCTA id
    const fmrMap: Record<string, number> = {
      '0': parseFloat(values[1]), // studio
      '1': parseFloat(values[2]), // 1BR
      '2': parseFloat(values[3]), // 2BR
      '3': parseFloat(values[4]), // 3BR
      '4': parseFloat(values[5]), // 4BR
    }
    return transformHudData(
      Object.fromEntries(Object.entries(fmrMap).filter(([, v]) => !isNaN(v) && v > 0)),
      zip
    )
  } catch {
    return []
  }
}

// ── CENSUS ACS ────────────────────────────────────────────────────────────────
export async function fetchCensus(zip: string): Promise<PartialRow[]> {
  const key = process.env.CENSUS_API_KEY
  const vars = 'B01003_001E,B19013_001E,B25064_001E,B07003_004E'

  try {
    const url = `https://api.census.gov/data/2022/acs/acs5?get=${vars}&for=zip%20code%20tabulation%20area:${zip}&key=${key}`
    const res = await fetch(url, { next: { revalidate: 604800 } })
    if (!res.ok) return []

    const data = await res.json()
    if (!data[1]) return []

    const headers: string[] = data[0]
    const values: string[] = data[1]

    const variables: Record<string, number | null> = {}
    headers.forEach((h, i) => {
      const val = parseFloat(values[i])
      variables[h] = isNaN(val) || val < 0 ? null : val
    })

    return transformCensusData(variables, zip)
  } catch {
    return []
  }
}
