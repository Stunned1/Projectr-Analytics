/**
 * Aggregate API
 * Takes a list of ZIP codes and returns normalized city/county/metro stats.
 * Used when viewing multi-ZIP areas instead of single-ZIP /api/market.
 *
 * Aggregation rules:
 * - Population, housing units, permits → SUM
 * - Rent, income, home value → weighted average (by population where available, else simple avg)
 * - Vacancy rate → weighted average
 * - Growth rates → simple average
 * - FRED (unemployment, GDP) → pull for the primary county (first ZIP's county), unless
 *   the caller passed a county/metro areaKey with direct precomputed rows.
 * - Metro velocity → pull for the metro of the first ZIP
 */
import { type NextRequest, NextResponse } from 'next/server'
import { supabase } from '@/lib/supabase'
import { getAreaRows, getRowsForSubmarkets } from '@/lib/data/market-data-router'
import { resolveZipAreaContext } from '@/lib/data/zip-area-context'
import { geocodeZip } from '@/lib/geocoder'
import { fetchFred } from '@/lib/fetchers'
import { ensureAreaMasterDataCached } from '@/lib/ensure-zip-cache'

export const dynamic = 'force-dynamic'

type AreaKind = 'county' | 'metro'

type CachedRow = {
  submarket_id: string | null
  metric_name: string
  metric_value: number | null
  data_source: string
  time_period: string | null
}

type FredPoint = {
  metric_name: string
  metric_value: number
  time_period: string | null
}

type ZillowSnapshotRow = {
  zip: string
  zori_latest: number | null
  zhvi_latest: number | null
  zori_growth_12m: number | null
  zhvi_growth_12m: number | null
  zhvf_growth_1yr: number | null
}

const ZIP_CACHE_METRICS = [
  'Total_Population',
  'Total_Housing_Units',
  'Vacant_Units',
  'Vacancy_Rate',
  'Median_Household_Income',
  'Median_Gross_Rent',
  'Moved_From_Different_State',
  'Permit_Units',
  'Permit_Value_USD',
] as const

function wavg(values: Array<{ value: number; weight: number }>): number | null {
  const valid = values.filter((v) => v.value > 0 && v.weight > 0)
  if (!valid.length) return null
  const totalWeight = valid.reduce((s, v) => s + v.weight, 0)
  return Math.round(valid.reduce((s, v) => s + v.value * v.weight, 0) / totalWeight)
}

function avg(values: Array<number | null | undefined>): number | null {
  const valid = values.filter((v): v is number => v != null && v > 0)
  if (!valid.length) return null
  return parseFloat((valid.reduce((s, v) => s + v, 0) / valid.length).toFixed(2))
}

function inferAreaKind(areaKey: string | null): AreaKind | null {
  if (!areaKey) return null
  if (areaKey.startsWith('county:')) return 'county'
  if (areaKey.startsWith('metro:')) return 'metro'
  return null
}

function metricTimeKey(row: Pick<CachedRow, 'time_period'>): string {
  return row.time_period ?? ''
}

function latestMetricRows(rows: CachedRow[]): CachedRow[] {
  const latest = new Map<string, CachedRow>()
  for (const row of rows) {
    if (row.metric_value == null) continue
    const existing = latest.get(row.metric_name)
    if (!existing || metricTimeKey(row).localeCompare(metricTimeKey(existing)) > 0) {
      latest.set(row.metric_name, row)
    }
  }
  return Array.from(latest.values()).sort((a, b) => a.metric_name.localeCompare(b.metric_name))
}

function latestMetricValue(rows: CachedRow[], metricName: string): number | null {
  let latest: CachedRow | null = null
  for (const row of rows) {
    if (row.metric_name !== metricName || row.metric_value == null) continue
    if (!latest || metricTimeKey(row).localeCompare(metricTimeKey(latest)) > 0) {
      latest = row
    }
  }
  return latest?.metric_value ?? null
}

function firstLatestMetricValue(rows: CachedRow[], metricNames: string[]): number | null {
  for (const metricName of metricNames) {
    const value = latestMetricValue(rows, metricName)
    if (value != null) return value
  }
  return null
}

function latestMetricRowsByYear(rows: CachedRow[], metricName: string): CachedRow[] {
  const latestByYear = new Map<string, CachedRow>()
  for (const row of rows) {
    if (row.metric_name !== metricName || row.metric_value == null || !row.time_period) continue
    const year = row.time_period.slice(0, 4)
    if (!/^\d{4}$/.test(year)) continue
    const existing = latestByYear.get(year)
    if (!existing || metricTimeKey(row).localeCompare(metricTimeKey(existing)) > 0) {
      latestByYear.set(year, row)
    }
  }
  return Array.from(latestByYear.values()).sort((a, b) => metricTimeKey(a).localeCompare(metricTimeKey(b)))
}

export async function POST(request: NextRequest) {
  try {
    const body = await request.json()
    const zips: string[] = body.zips ?? []
    const label: string = body.label ?? 'Area'
    const areaKey =
      typeof body.areaKey === 'string' && body.areaKey.trim().length > 0 ? body.areaKey.trim() : null
    const areaKind = inferAreaKind(areaKey)

    if (!zips.length) return NextResponse.json({ error: 'No ZIPs provided' }, { status: 400 })

    let directAreaRows: CachedRow[] = []
    if (areaKey) {
      directAreaRows = (await getAreaRows(areaKey, { limit: 800 })) as CachedRow[]
    }

    const usesDirectAreaMetrics = directAreaRows.some((row) => row.metric_value != null)

    // Cold-fill ZIP cache only when we do not already have direct county / metro rows.
    if (!usesDirectAreaMetrics) {
      await ensureAreaMasterDataCached(zips)
    }

    // Pull the shared ZIP inputs in parallel after any cold-fill step.
    const [{ data: snapshots }, cachedRows, origin] = await Promise.all([
      supabase
        .from('zillow_zip_snapshot')
        .select('zip, zori_latest, zhvi_latest, zori_growth_12m, zhvi_growth_12m, zhvf_growth_1yr')
        .in('zip', zips),
      getRowsForSubmarkets(zips, {
        dataSource: ['Census ACS', 'HUD', 'Census BPS'],
        metricName: [...ZIP_CACHE_METRICS],
      }),
      resolveZipAreaContext(zips[0]),
    ])

    const rows = cachedRows as CachedRow[]

    const latestAreaMetrics = latestMetricRows(directAreaRows).map((row) => ({
      metric_name: row.metric_name,
      metric_value: row.metric_value as number,
      time_period: row.time_period,
      data_source: row.data_source,
    }))

    // Census BPS is county-level: same counts are stored per ZIP in the county. Build yearly series from
    // one anchor ZIP only; do not fold Permit_* into metricsByZip (multiple years would overwrite).
    const bpsUnitRows = rows.filter(
      (row) => row.data_source === 'Census BPS' && row.metric_name === 'Permit_Units' && row.time_period
    )
    const anchorZipForBps = zips.find((zip) => bpsUnitRows.some((row) => row.submarket_id === zip))
    const fallbackPermitsByYear: { year: string; units: number }[] =
      anchorZipForBps != null
        ? bpsUnitRows
            .filter((row) => row.submarket_id === anchorZipForBps)
            .sort((a, b) => metricTimeKey(a).localeCompare(metricTimeKey(b)))
            .map((row) => ({
              year: (row.time_period ?? '').slice(0, 4),
              units: Math.round(row.metric_value ?? 0),
            }))
        : []

    const directPermitRowsByYear = latestMetricRowsByYear(directAreaRows, 'Permit_Units')
    const permitsByYear =
      directPermitRowsByYear.length > 0
        ? directPermitRowsByYear.map((row) => ({
            year: (row.time_period ?? '').slice(0, 4),
            units: Math.round(row.metric_value ?? 0),
          }))
        : fallbackPermitsByYear

    const bpsValueRows = rows.filter(
      (row) => row.data_source === 'Census BPS' && row.metric_name === 'Permit_Value_USD' && row.time_period
    )
    let fallbackPermitValue: number | null = null
    if (anchorZipForBps && bpsValueRows.length > 0) {
      const value = bpsValueRows
        .filter((row) => row.submarket_id === anchorZipForBps)
        .reduce((sum, row) => sum + (row.metric_value ?? 0), 0)
      fallbackPermitValue = value > 0 ? Math.round(value) : null
    }

    const directPermitValue = latestMetricRowsByYear(directAreaRows, 'Permit_Value_USD')
      .reduce((sum, row) => sum + (row.metric_value ?? 0), 0)
    const totalPermitValue =
      directPermitValue > 0
        ? Math.round(directPermitValue)
        : fallbackPermitValue

    const totalPermitUnits =
      permitsByYear.length > 0 ? permitsByYear.reduce((sum, row) => sum + row.units, 0) : null

    // Group ACS / HUD tabular metrics (single row per name per ZIP)
    const metricsByZip: Record<string, Record<string, number>> = {}
    for (const row of rows) {
      if (row.data_source === 'Census BPS' || row.metric_value == null || !row.submarket_id) continue
      if (!metricsByZip[row.submarket_id]) metricsByZip[row.submarket_id] = {}
      metricsByZip[row.submarket_id][row.metric_name] = row.metric_value
    }

    // 3. Aggregate Zillow data
    const snaps: ZillowSnapshotRow[] = (snapshots ?? []) as ZillowSnapshotRow[]
    const populations = zips.map((zip) => metricsByZip[zip]?.['Total_Population'] ?? 0)
    const populationByZip = new Map(zips.map((zip, index) => [zip, populations[index] ?? 0]))
    const fallbackTotalPopulation = populations.reduce((sum, population) => sum + population, 0)

    const avgZori =
      wavg(
        snaps.map((snapshot) => ({
          value: snapshot.zori_latest ?? 0,
          weight: populationByZip.get(snapshot.zip) || 1,
        }))
      ) ?? avg(snaps.map((snapshot) => snapshot.zori_latest))

    const avgZhvi =
      wavg(
        snaps.map((snapshot) => ({
          value: snapshot.zhvi_latest ?? 0,
          weight: populationByZip.get(snapshot.zip) || 1,
        }))
      ) ?? avg(snaps.map((snapshot) => snapshot.zhvi_latest))

    const avgZoriGrowth = avg(snaps.map((snapshot) => snapshot.zori_growth_12m))
    const avgZhviGrowth = avg(snaps.map((snapshot) => snapshot.zhvi_growth_12m))

    // 4. Aggregate Census data - vacancy: prefer summed units (true area rate); if unit rows
    //    are missing from cache, fall back to weighted Vacancy_Rate.
    let fallbackVacancyRate: number | null = null
    const zipsWithUnitBreakdown = zips.filter((zip) => {
      const total = metricsByZip[zip]?.['Total_Housing_Units']
      const vacant = metricsByZip[zip]?.['Vacant_Units']
      return total != null && total > 0 && vacant != null && Number.isFinite(vacant)
    })
    if (zipsWithUnitBreakdown.length > 0) {
      const totalHousing = zipsWithUnitBreakdown.reduce(
        (sum, zip) => sum + metricsByZip[zip]!['Total_Housing_Units']!,
        0
      )
      const totalVacant = zipsWithUnitBreakdown.reduce(
        (sum, zip) => sum + metricsByZip[zip]!['Vacant_Units']!,
        0
      )
      fallbackVacancyRate = parseFloat(((totalVacant / totalHousing) * 100).toFixed(1))
    } else {
      const weighted = zips
        .map((zip) => {
          const rate = metricsByZip[zip]?.['Vacancy_Rate']
          const weight =
            metricsByZip[zip]?.['Total_Population'] ??
            metricsByZip[zip]?.['Total_Housing_Units'] ??
            0
          return rate != null && Number.isFinite(rate) && weight > 0 ? { rate, weight } : null
        })
        .filter((item): item is { rate: number; weight: number } => item != null)
      if (weighted.length > 0) {
        const totalWeight = weighted.reduce((sum, item) => sum + item.weight, 0)
        fallbackVacancyRate = parseFloat(
          (weighted.reduce((sum, item) => sum + item.rate * item.weight, 0) / totalWeight).toFixed(1)
        )
      } else {
        const rates = zips
          .map((zip) => metricsByZip[zip]?.['Vacancy_Rate'])
          .filter((rate): rate is number => rate != null && Number.isFinite(rate))
        if (rates.length > 0) {
          fallbackVacancyRate = parseFloat(
            (rates.reduce((sum, rate) => sum + rate, 0) / rates.length).toFixed(1)
          )
        }
      }
    }

    const fallbackTotalHousingUnits = zips.reduce(
      (sum, zip) => sum + (metricsByZip[zip]?.['Total_Housing_Units'] ?? 0),
      0
    )

    const fallbackMedianIncome = wavg(
      zips.map((zip) => ({
        value: metricsByZip[zip]?.['Median_Household_Income'] ?? 0,
        weight: metricsByZip[zip]?.['Total_Population'] ?? 1,
      }))
    )

    const fallbackMedianRent = wavg(
      zips.map((zip) => ({
        value: metricsByZip[zip]?.['Median_Gross_Rent'] ?? 0,
        weight: metricsByZip[zip]?.['Total_Population'] ?? 1,
      }))
    )

    const fallbackMigrationMovers = zips.reduce(
      (sum, zip) => sum + (metricsByZip[zip]?.['Moved_From_Different_State'] ?? 0),
      0
    )

    const totalPopulation =
      firstLatestMetricValue(directAreaRows, ['Total_Population', 'Projected_Total_Population']) ??
      (fallbackTotalPopulation || null)
    const totalHousingUnits =
      firstLatestMetricValue(directAreaRows, ['Total_Housing_Units']) ??
      (fallbackTotalHousingUnits || null)
    const vacancyRate =
      firstLatestMetricValue(directAreaRows, ['Vacancy_Rate']) ??
      fallbackVacancyRate
    const medianIncome =
      firstLatestMetricValue(directAreaRows, ['Median_Household_Income']) ??
      fallbackMedianIncome
    const medianRent =
      firstLatestMetricValue(directAreaRows, ['Median_Gross_Rent']) ??
      fallbackMedianRent
    const migrationMovers =
      firstLatestMetricValue(directAreaRows, ['Moved_From_Different_State']) ??
      (fallbackMigrationMovers > 0 ? fallbackMigrationMovers : null)

    // 5. Pull metro velocity for the first ZIP's metro
    let metroVelocity = null
    const metroNameShort = origin?.metro_name_short ?? null
    if (metroNameShort) {
      const { data: metroSnapshot } = await supabase
        .from('zillow_metro_snapshot')
        .select('region_name, doz_pending_latest, price_cut_pct_latest, inventory_latest, as_of_date')
        .eq('region_name', metroNameShort)
        .single()
      metroVelocity = metroSnapshot
    }

    // 6. Pull FRED data for the primary county (geocode first ZIP) unless the caller already
    //    has direct county / metro rows for those indicators.
    let fredData: FredPoint[] = directAreaRows
      .filter(
        (row): row is CachedRow & { metric_value: number; time_period: string } =>
          ['Unemployment_Rate', 'Employment_Rate', 'Real_GDP'].includes(row.metric_name) &&
          row.metric_value != null &&
          typeof row.time_period === 'string' &&
          row.time_period.length > 0
      )
      .sort((a, b) => {
        const metricCmp = a.metric_name.localeCompare(b.metric_name)
        return metricCmp !== 0 ? metricCmp : metricTimeKey(a).localeCompare(metricTimeKey(b))
      })
      .map((row) => ({
        metric_name: row.metric_name,
        metric_value: row.metric_value,
        time_period: row.time_period,
      }))

    if (fredData.length === 0) {
      try {
        const geo = await geocodeZip(zips[0])
        if (geo) {
          const fredRows = await fetchFred(geo, zips[0])
          fredData = fredRows.map((row) => ({
            metric_name: row.metric_name,
            metric_value: row.metric_value ?? 0,
            time_period: row.time_period ?? null,
          }))
        }
      } catch {
        // non-critical
      }
    }

    return NextResponse.json({
      label,
      area_key: areaKey,
      area_kind: areaKind,
      uses_direct_area_metrics: usesDirectAreaMetrics,
      area_metrics: latestAreaMetrics,
      zip_count: zips.length,
      total_population: totalPopulation,
      zillow: {
        avg_zori: avgZori,
        avg_zhvi: avgZhvi,
        zori_growth_12m: avgZoriGrowth,
        zhvi_growth_12m: avgZhviGrowth,
      },
      housing: {
        total_units: totalHousingUnits,
        vacancy_rate: vacancyRate,
        median_income: medianIncome,
        median_rent: medianRent,
        migration_movers: migrationMovers,
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
