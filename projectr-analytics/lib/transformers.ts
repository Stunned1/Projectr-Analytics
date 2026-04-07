import type { MasterDataRow, VisualBucket } from './supabase'

// FRED series IDs for key metrics
export const FRED_SERIES: Record<string, { id: string; metric: string }> = {
  unemployment: { id: 'LAUCN', metric: 'Unemployment_Rate' },
  medianIncome:  { id: 'MHIVA', metric: 'Median_Household_Income' },
}

export function transformFredData(
  seriesId: string,
  metricName: string,
  observations: Array<{ date: string; value: string }>,
  submarketId: string
): Omit<MasterDataRow, 'id' | 'created_at'>[] {
  return observations
    .filter((o) => o.value !== '.' && o.value !== '')
    .slice(-12) // last 12 periods
    .map((o) => ({
      submarket_id: submarketId,
      geometry: null,
      metric_name: metricName,
      metric_value: parseFloat(o.value),
      time_period: o.date,
      data_source: 'FRED',
      visual_bucket: 'TIME_SERIES' as VisualBucket,
    }))
}

export function transformHudData(
  fmrData: Record<string, number>,
  submarketId: string
): Omit<MasterDataRow, 'id' | 'created_at'>[] {
  return Object.entries(fmrData).map(([bedroom, rent]) => ({
    submarket_id: submarketId,
    geometry: null,
    metric_name: `FMR_${bedroom}BR`,
    metric_value: rent,
    time_period: new Date().toISOString().split('T')[0],
    data_source: 'HUD',
    visual_bucket: 'TABULAR' as VisualBucket,
  }))
}

export function transformCensusData(
  variables: Record<string, number | null>,
  submarketId: string
): Omit<MasterDataRow, 'id' | 'created_at'>[] {
  const metricMap: Record<string, string> = {
    B01003_001E: 'Total_Population',
    B19013_001E: 'Median_Household_Income',
    B25064_001E: 'Median_Gross_Rent',
    B07003_004E: 'Moved_From_Different_State',
  }
  return Object.entries(variables)
    .filter(([key]) => metricMap[key] && variables[key] !== null)
    .map(([key, value]) => ({
      submarket_id: submarketId,
      geometry: null,
      metric_name: metricMap[key],
      metric_value: value as number,
      time_period: new Date().toISOString().split('T')[0],
      data_source: 'Census ACS',
      visual_bucket: 'TABULAR' as VisualBucket,
    }))
}
