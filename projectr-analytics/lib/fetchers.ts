import { transformFredData, transformHudData, transformCensusData } from './transformers'
import type { GeoResult } from './geocoder'
import type { MasterDataRow } from './supabase'

type PartialRow = Omit<MasterDataRow, 'id' | 'created_at'>

// ── FRED helpers ──────────────────────────────────────────────────────────────
async function fredSearch(query: string, key: string, filter: (s: { title: string; frequency_short: string }) => boolean) {
  const res = await fetch(
    `https://api.stlouisfed.org/fred/series/search?search_text=${encodeURIComponent(query)}&api_key=${key}&file_type=json&limit=10`,
    { next: { revalidate: 604800 } }
  )
  if (!res.ok) return null
  const data = await res.json()
  return (data.seriess ?? []).find(filter) ?? null
}

async function fredObs(seriesId: string, key: string, limit = 24) {
  const res = await fetch(
    `https://api.stlouisfed.org/fred/series/observations?series_id=${seriesId}&api_key=${key}&file_type=json&sort_order=desc&limit=${limit}`,
    { next: { revalidate: 604800 } }
  )
  if (!res.ok) return []
  const data = await res.json()
  return data.observations ?? []
}

// ── FRED ──────────────────────────────────────────────────────────────────────
export async function fetchFred(geo: GeoResult, zip: string): Promise<PartialRow[]> {
  const key = process.env.FRED_API_KEY!
  const results: PartialRow[] = []

  try {
    const countyQuery = `${geo.city} county ${geo.state}`

    // Fire all 3 FRED searches concurrently
    const [unemploySeries, laborForceSeries, employedSeries, gdpSeries] = await Promise.all([
      fredSearch(`unemployment rate ${countyQuery}`, key,
        (s) => s.title.toLowerCase().includes('unemployment rate') && s.frequency_short === 'M'),
      fredSearch(`civilian labor force ${countyQuery}`, key,
        (s) => s.title.toLowerCase().includes('civilian labor force') && !s.title.toLowerCase().includes('unemploy') && s.frequency_short === 'M'),
      fredSearch(`employed persons ${countyQuery}`, key,
        (s) => s.title.toLowerCase().includes('employed persons') && s.frequency_short === 'M'),
      fredSearch(`real gross domestic product all industries ${countyQuery}`, key,
        (s) => s.title.toLowerCase().includes('real gross domestic product') && s.title.toLowerCase().includes('all industries') && s.frequency_short === 'A'),
    ])

    // Fetch observations concurrently for found series
    const obsFetches = await Promise.all([
      unemploySeries ? fredObs(unemploySeries.id, key, 24) : Promise.resolve([]),
      laborForceSeries ? fredObs(laborForceSeries.id, key, 24) : Promise.resolve([]),
      employedSeries ? fredObs(employedSeries.id, key, 24) : Promise.resolve([]),
      gdpSeries ? fredObs(gdpSeries.id, key, 10) : Promise.resolve([]),
    ])

    const [unemployObs, lfObs, empObs, gdpObs] = obsFetches

    if (unemploySeries && unemployObs.length) {
      results.push(...transformFredData(unemploySeries.id, 'Unemployment_Rate', unemployObs, zip))
    }

    if (laborForceSeries && employedSeries && lfObs.length && empObs.length) {
      const lfMap = new Map(lfObs.map((o: { date: string; value: string }) => [o.date, parseFloat(o.value)]))
      const empRows = empObs
        .filter((o: { date: string; value: string }) => o.value !== '.' && lfMap.has(o.date))
        .map((o: { date: string; value: string }) => {
          const lf = lfMap.get(o.date) as number
          const emp = parseFloat(o.value)
          return { date: o.date, value: lf > 0 ? String(((emp / lf) * 100).toFixed(2)) : '.' }
        })
      results.push(...transformFredData('computed', 'Employment_Rate', empRows, zip))
    }

    if (gdpSeries && gdpObs.length) {
      results.push(...transformFredData(gdpSeries.id, 'Real_GDP', gdpObs, zip))
    }
  } catch {
    // return whatever we have
  }

  return results
}

// ── HUD / RENT BY BEDROOMS ────────────────────────────────────────────────────
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
          return transformHudData({
            '0': basicdata.Efficiency,
            '1': basicdata.One_Bedroom,
            '2': basicdata.Two_Bedroom,
            '3': basicdata.Three_Bedroom,
            '4': basicdata.Four_Bedroom,
          }, zip)
        }
      }
    } catch { /* fall through */ }
  }

  // Fallback: Census ACS B25031 — median gross rent by bedrooms
  try {
    const key = process.env.CENSUS_API_KEY
    const vars = 'B25031_001E,B25031_002E,B25031_003E,B25031_004E,B25031_005E,B25031_006E'
    const res = await fetch(
      `https://api.census.gov/data/2022/acs/acs5?get=${vars}&for=zip%20code%20tabulation%20area:${zip}&key=${key}`,
      { next: { revalidate: 604800 } }
    )
    if (!res.ok) return []
    const data = await res.json()
    if (!data[1]) return []
    const values: string[] = data[1]
    const fmrMap: Record<string, number> = {
      '0': parseFloat(values[1]),
      '1': parseFloat(values[2]),
      '2': parseFloat(values[3]),
      '3': parseFloat(values[4]),
      '4': parseFloat(values[5]),
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
// Fetches demographics + vacancy rate + population growth (2019 vs 2022)
export async function fetchCensus(zip: string, geo: GeoResult): Promise<PartialRow[]> {
  const key = process.env.CENSUS_API_KEY
  const results: PartialRow[] = []

  try {
    // 2022 snapshot: population, income, rent, migration, vacancy
    // B25002: total housing units, occupied, vacant
    const vars2022 = 'B01003_001E,B19013_001E,B25064_001E,B07003_004E,B25002_001E,B25002_003E'
    const res2022 = await fetch(
      `https://api.census.gov/data/2022/acs/acs5?get=${vars2022}&for=zip%20code%20tabulation%20area:${zip}&key=${key}`,
      { next: { revalidate: 604800 } }
    )
    if (res2022.ok) {
      const data = await res2022.json()
      if (data[1]) {
        const headers: string[] = data[0]
        const values: string[] = data[1]
        const vars: Record<string, number | null> = {}
        headers.forEach((h, i) => {
          const v = parseFloat(values[i])
          vars[h] = isNaN(v) || v < 0 ? null : v
        })
        results.push(...transformCensusData(vars, zip))

        // Compute vacancy rate
        const totalUnits = vars['B25002_001E']
        const vacantUnits = vars['B25002_003E']
        if (totalUnits && vacantUnits && totalUnits > 0) {
          results.push({
            submarket_id: zip,
            geometry: null,
            metric_name: 'Vacancy_Rate',
            metric_value: parseFloat(((vacantUnits / totalUnits) * 100).toFixed(2)),
            time_period: new Date().toISOString().split('T')[0],
            data_source: 'Census ACS',
            visual_bucket: 'TABULAR',
          })
        }
      }
    }

    // 2019 population for YoY growth calculation
    const res2019 = await fetch(
      `https://api.census.gov/data/2019/acs/acs5?get=B01003_001E&for=zip%20code%20tabulation%20area:${zip}&in=state:${geo.stateFips}&key=${key}`,
      { next: { revalidate: 604800 } }
    )
    if (res2019.ok) {
      const data2019 = await res2019.json()
      if (data2019[1]) {
        const pop2019 = parseFloat(data2019[1][0])
        const pop2022 = results.find((r) => r.metric_name === 'Total_Population')?.metric_value
        if (!isNaN(pop2019) && pop2019 > 0 && pop2022) {
          const growthPct = parseFloat((((pop2022 - pop2019) / pop2019) * 100).toFixed(2))
          results.push({
            submarket_id: zip,
            geometry: null,
            metric_name: 'Population_Growth_3yr',
            metric_value: growthPct,
            time_period: new Date().toISOString().split('T')[0],
            data_source: 'Census ACS',
            visual_bucket: 'TABULAR',
          })
        }
      }
    }
  } catch {
    // return whatever we have
  }

  return results
}

// ── BUILDING PERMITS (Census BPS) ─────────────────────────────────────────────
// Census Building Permits Survey — county level annual CSV
// URL: https://www2.census.gov/econ/bps/County/co{YEAR}a.txt
export async function fetchPermits(geo: GeoResult, zip: string): Promise<PartialRow[]> {
  const results: PartialRow[] = []
  const stateFips = geo.stateFips.padStart(2, '0')
  const countyFips = geo.countyFips.padStart(3, '0')

  for (const year of ['2023', '2022', '2021']) {
    try {
      const url = `https://www2.census.gov/econ/bps/County/co${year}a.txt`
      const res = await fetch(url, { next: { revalidate: 2592000 } })
      if (!res.ok) continue

      const text = await res.text()
      // Format: YEAR,STATE_FIPS,COUNTY_FIPS,...,1-unit Bldgs,Units,Value,...
      const line = text.split('\n').find((l) => l.startsWith(`${year},${stateFips},${countyFips},`))
      if (!line) continue

      const cols = line.split(',')
      // Columns: [0]=year, [1]=state, [2]=county, [3]=region, [4]=division, [5]=name
      // [6]=1unit_bldgs, [7]=1unit_units, [8]=1unit_value
      // [9]=2unit_bldgs, [10]=2unit_units, [11]=2unit_value
      // [12]=3-4unit_bldgs, [13]=3-4unit_units, [14]=3-4unit_value
      // [15]=5+unit_bldgs, [16]=5+unit_units, [17]=5+unit_value
      // Total = sum of all unit types
      const totalBldgs = [6, 9, 12, 15].reduce((sum, i) => sum + (parseFloat(cols[i]) || 0), 0)
      const totalUnits = [7, 10, 13, 16].reduce((sum, i) => sum + (parseFloat(cols[i]) || 0), 0)
      const totalValue = [8, 11, 14, 17].reduce((sum, i) => sum + (parseFloat(cols[i]) || 0), 0)

      if (totalBldgs > 0) results.push({ submarket_id: zip, geometry: null, metric_name: 'Permit_Buildings', metric_value: totalBldgs, time_period: `${year}-01-01`, data_source: 'Census BPS', visual_bucket: 'TIME_SERIES' })
      if (totalUnits > 0) results.push({ submarket_id: zip, geometry: null, metric_name: 'Permit_Units', metric_value: totalUnits, time_period: `${year}-01-01`, data_source: 'Census BPS', visual_bucket: 'TIME_SERIES' })
      if (totalValue > 0) results.push({ submarket_id: zip, geometry: null, metric_name: 'Permit_Value_USD', metric_value: totalValue, time_period: `${year}-01-01`, data_source: 'Census BPS', visual_bucket: 'TIME_SERIES' })
    } catch {
      continue
    }
  }

  return results
}
