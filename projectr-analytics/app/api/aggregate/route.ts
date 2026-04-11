/**
 * Aggregate API
 * Takes a list of ZIP codes and returns normalized city/borough-level stats.
 * Used when viewing city or borough mode instead of single-ZIP /api/market.
 *
 * Aggregation rules:
 * - Population, housing units, permits → SUM
 * - Rent, income, home value → weighted average (by population where available, else simple avg)
 * - Vacancy rate → weighted average
 * - Growth rates → simple average
 * - FRED (unemployment, GDP) → pull for the primary county (first ZIP's county)
 * - Metro velocity → pull for the metro of the first ZIP
 */
import { type NextRequest, NextResponse } from 'next/server'
import { supabase } from '@/lib/supabase'
import { geocodeZip } from '@/lib/geocoder'
import { fetchFred } from '@/lib/fetchers'
import { ensureAreaMasterDataCached } from '@/lib/ensure-zip-cache'

export const dynamic = 'force-dynamic'

function wavg(values: Array<{ value: number; weight: number }>): number | null {
  const valid = values.filter((v) => v.value > 0 && v.weight > 0)
  if (!valid.length) return null
  const totalWeight = valid.reduce((s, v) => s + v.weight, 0)
  return Math.round(valid.reduce((s, v) => s + v.value * v.weight, 0) / totalWeight)
}

function avg(values: (number | null)[]): number | null {
  const valid = values.filter((v): v is number => v != null && v > 0)
  if (!valid.length) return null
  return parseFloat((valid.reduce((s, v) => s + v, 0) / valid.length).toFixed(2))
}

export async function POST(request: NextRequest) {
  try {
    const body = await request.json()
    const zips: string[] = body.zips ?? []
    const label: string = body.label ?? 'Area'

    if (!zips.length) return NextResponse.json({ error: 'No ZIPs provided' }, { status: 400 })

    // Cold-fill Census ACS + BPS (and FRED/HUD) when this area was never loaded via /api/market — otherwise
    // borough/city PDF metrics (vacancy, permits, migration) stay empty.
    await ensureAreaMasterDataCached(zips)

    // 1. Pull Zillow snapshots for all ZIPs
    const { data: snapshots } = await supabase
      .from('zillow_zip_snapshot')
      .select('zip, zori_latest, zhvi_latest, zori_growth_12m, zhvi_growth_12m, zhvf_growth_1yr')
      .in('zip', zips)

    // 2. Pull cached Census/HUD data from projectr_master_data (include time_period for multi-year BPS)
    const { data: cachedRows } = await supabase
      .from('projectr_master_data')
      .select('submarket_id, metric_name, metric_value, data_source, time_period')
      .in('submarket_id', zips)
      .in('data_source', ['Census ACS', 'HUD', 'Census BPS'])

    type Cached = {
      submarket_id: string
      metric_name: string
      metric_value: number
      data_source: string
      time_period: string | null
    }
    const rows = (cachedRows ?? []) as Cached[]

    // Census BPS is county-level: same counts are stored per ZIP in the county. Build yearly series from
    // one anchor ZIP only; do not fold Permit_* into metricsByZip (multiple years would overwrite).
    const bpsUnitRows = rows.filter(
      (r) => r.data_source === 'Census BPS' && r.metric_name === 'Permit_Units' && r.time_period
    )
    const anchorZipForBps = zips.find((z) => bpsUnitRows.some((r) => r.submarket_id === z))
    const permitsByYear: { year: string; units: number }[] =
      anchorZipForBps != null
        ? bpsUnitRows
            .filter((r) => r.submarket_id === anchorZipForBps)
            .sort((a, b) => (a.time_period ?? '').localeCompare(b.time_period ?? ''))
            .map((r) => ({
              year: (r.time_period ?? '').slice(0, 4),
              units: Math.round(r.metric_value),
            }))
        : []

    const bpsValueRows = rows.filter(
      (r) => r.data_source === 'Census BPS' && r.metric_name === 'Permit_Value_USD' && r.time_period
    )
    let totalPermitValue: number | null = null
    if (anchorZipForBps && bpsValueRows.length > 0) {
      const v = bpsValueRows
        .filter((r) => r.submarket_id === anchorZipForBps)
        .reduce((s, r) => s + r.metric_value, 0)
      totalPermitValue = v > 0 ? Math.round(v) : null
    }

    const totalPermitUnits =
      permitsByYear.length > 0 ? permitsByYear.reduce((s, y) => s + y.units, 0) : null

    // Group ACS / HUD tabular metrics (single row per name per ZIP)
    const metricsByZip: Record<string, Record<string, number>> = {}
    for (const row of rows) {
      if (row.data_source === 'Census BPS') continue
      if (!metricsByZip[row.submarket_id]) metricsByZip[row.submarket_id] = {}
      metricsByZip[row.submarket_id][row.metric_name] = row.metric_value
    }

    // 3. Aggregate Zillow data
    const snaps = snapshots ?? []
    const populations = zips.map((z) => metricsByZip[z]?.['Total_Population'] ?? 0)
    const totalPop = populations.reduce((s, p) => s + p, 0)

    const avgZori = wavg(snaps.map((s, i) => ({
      value: s.zori_latest ?? 0,
      weight: populations[zips.indexOf(s.zip)] || 1,
    }))) ?? avg(snaps.map((s) => s.zori_latest))

    const avgZhvi = wavg(snaps.map((s) => ({
      value: s.zhvi_latest ?? 0,
      weight: populations[zips.indexOf(s.zip)] || 1,
    }))) ?? avg(snaps.map((s) => s.zhvi_latest))

    const avgZoriGrowth = avg(snaps.map((s) => s.zori_growth_12m))
    const avgZhviGrowth = avg(snaps.map((s) => s.zhvi_growth_12m))

    // 4. Aggregate Census data — vacancy: prefer summed units (true area rate); if unit rows
    //    are missing from cache (common until ZIPs are cold-loaded), fall back to weighted Vacancy_Rate.
    let vacancyRate: number | null = null
    const zipsWithUnitBreakdown = zips.filter((z) => {
      const total = metricsByZip[z]?.['Total_Housing_Units']
      const vacant = metricsByZip[z]?.['Vacant_Units']
      return total != null && total > 0 && vacant != null && Number.isFinite(vacant)
    })
    if (zipsWithUnitBreakdown.length > 0) {
      const th = zipsWithUnitBreakdown.reduce((s, z) => s + metricsByZip[z]!['Total_Housing_Units']!, 0)
      const tv = zipsWithUnitBreakdown.reduce((s, z) => s + metricsByZip[z]!['Vacant_Units']!, 0)
      vacancyRate = parseFloat(((tv / th) * 100).toFixed(1))
    } else {
      const weighted = zips
        .map((z) => {
          const rate = metricsByZip[z]?.['Vacancy_Rate']
          const w =
            metricsByZip[z]?.['Total_Population'] ??
            metricsByZip[z]?.['Total_Housing_Units'] ??
            0
          return rate != null && Number.isFinite(rate) && w > 0 ? { rate, w } : null
        })
        .filter((x): x is { rate: number; w: number } => x != null)
      if (weighted.length > 0) {
        const tw = weighted.reduce((s, x) => s + x.w, 0)
        vacancyRate = parseFloat(
          (weighted.reduce((s, x) => s + x.rate * x.w, 0) / tw).toFixed(1)
        )
      } else {
        const rates = zips
          .map((z) => metricsByZip[z]?.['Vacancy_Rate'])
          .filter((r): r is number => r != null && Number.isFinite(r))
        if (rates.length > 0) {
          vacancyRate = parseFloat(
            (rates.reduce((s, r) => s + r, 0) / rates.length).toFixed(1)
          )
        }
      }
    }

    const totalHousingUnits = zips.reduce((s, z) => s + (metricsByZip[z]?.['Total_Housing_Units'] ?? 0), 0)

    const avgIncome = wavg(zips.map((z) => ({
      value: metricsByZip[z]?.['Median_Household_Income'] ?? 0,
      weight: metricsByZip[z]?.['Total_Population'] ?? 1,
    })))

    const avgRent = wavg(zips.map((z) => ({
      value: metricsByZip[z]?.['Median_Gross_Rent'] ?? 0,
      weight: metricsByZip[z]?.['Total_Population'] ?? 1,
    })))

    const migrationMovers = zips.reduce((s, z) => s + (metricsByZip[z]?.['Moved_From_Different_State'] ?? 0), 0)

    // 5. Pull metro velocity for the first ZIP's metro
    const { data: lookup } = await supabase
      .from('zip_metro_lookup')
      .select('metro_name_short')
      .eq('zip', zips[0])
      .single()

    let metroVelocity = null
    if (lookup?.metro_name_short) {
      const { data: mv } = await supabase
        .from('zillow_metro_snapshot')
        .select('region_name, doz_pending_latest, price_cut_pct_latest, inventory_latest, as_of_date')
        .eq('region_name', lookup.metro_name_short)
        .single()
      metroVelocity = mv
    }

    // 6. Pull FRED data for the primary county (geocode first ZIP)
    let fredData: Array<{ metric_name: string; metric_value: number; time_period: string | null }> = []
    try {
      const geo = await geocodeZip(zips[0])
      if (geo) {
        const rows = await fetchFred(geo, zips[0])
        fredData = rows.map((r) => ({
          metric_name: r.metric_name,
          metric_value: r.metric_value ?? 0,
          time_period: r.time_period ?? null,
        }))
      }
    } catch { /* non-critical */ }

    return NextResponse.json({
      label,
      zip_count: zips.length,
      total_population: totalPop || null,
      zillow: {
        avg_zori: avgZori,
        avg_zhvi: avgZhvi,
        zori_growth_12m: avgZoriGrowth,
        zhvi_growth_12m: avgZhviGrowth,
      },
      housing: {
        total_units: totalHousingUnits || null,
        vacancy_rate: vacancyRate,
        median_income: avgIncome,
        median_rent: avgRent,
        migration_movers: migrationMovers > 0 ? migrationMovers : null,
      },
      permits: {
        total_units: totalPermitUnits,
        total_value: totalPermitValue,
        by_year: permitsByYear,
      },
      metro_velocity: metroVelocity,
      fred: fredData,
    })
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Unexpected error'
    return NextResponse.json({ error: message }, { status: 500 })
  }
}
