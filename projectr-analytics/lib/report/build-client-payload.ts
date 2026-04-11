import type { ClientReportPayload, ClientReportPin, MapLayersSnapshot } from './types'

type DataRow = {
  metric_name: string
  metric_value: number
  data_source: string
  time_period: string | null
}

function fredUnemploymentSeries(rows: DataRow[]): { date: string; value: number }[] {
  return rows
    .filter((r) => r.metric_name === 'Unemployment_Rate' && r.data_source === 'FRED' && r.time_period)
    .sort((a, b) => (a.time_period ?? '').localeCompare(b.time_period ?? ''))
    .map((r) => ({ date: r.time_period!, value: r.metric_value }))
}

function latestFredMetric(rows: DataRow[], name: string): number | null {
  const matches = rows.filter((r) => r.metric_name === name && r.data_source === 'FRED' && r.time_period)
  if (!matches.length) return null
  const sorted = [...matches].sort((a, b) => (a.time_period ?? '').localeCompare(b.time_period ?? ''))
  const v = sorted.at(-1)?.metric_value
  return v != null && Number.isFinite(v) ? v : null
}

function permitsByYear(rows: DataRow[]): { year: string; units: number }[] {
  const units = rows.filter(
    (r) => r.metric_name === 'Permit_Units' && r.data_source === 'Census BPS' && r.time_period
  )
  return [...units]
    .sort((a, b) => (a.time_period ?? '').localeCompare(b.time_period ?? ''))
    .map((r) => ({
      year: (r.time_period ?? '').slice(0, 4),
      units: Math.round(r.metric_value),
    }))
}

function totalPermitUnits(byYear: { year: string; units: number }[]): number | null {
  if (!byYear.length) return null
  const t = byYear.reduce((s, y) => s + y.units, 0)
  return t > 0 ? t : null
}

function acs(rows: DataRow[], name: string): number | null {
  const r = rows.find((x) => x.metric_name === name && x.data_source === 'Census ACS')
  return r?.metric_value != null ? r.metric_value : null
}

export interface ZipMarketShape {
  zip: string
  geo?: { lat: number; lng: number; city: string; state: string }
  data: DataRow[]
  zillow: {
    zori_latest: number | null
    zori_growth_12m: number | null
    zhvi_latest: number | null
    zhvi_growth_12m: number | null
    metro_name: string | null
    city: string | null
  } | null
}

export interface AggregateShape {
  label: string
  zip_count: number
  total_population: number | null
  zillow: {
    avg_zori: number | null
    avg_zhvi: number | null
    zori_growth_12m: number | null
    zhvi_growth_12m: number | null
  }
  housing: {
    total_units: number | null
    vacancy_rate: number | null
    median_income: number | null
    median_rent: number | null
  }
  permits: { total_units: number | null; total_value: number | null }
  fred: Array<{ metric_name: string; metric_value: number; time_period: string | null }>
}

export interface CityZipShape {
  zip: string
  lat: number | null
  lng: number | null
  city: string
  state: string | null
}

export interface TrendsShape {
  series: Array<{ date: string; value: number }>
  keyword_scope: string
}

export function buildClientReportPayloadFromZip(args: {
  result: ZipMarketShape
  trends: TrendsShape | null
  layers: MapLayersSnapshot
  pins: ClientReportPin[]
}): ClientReportPayload {
  const { result, trends, layers, pins } = args
  const rows = result.data
  const byYear = permitsByYear(rows)

  return {
    marketLabel: result.zillow?.city ?? result.zip,
    primaryZip: result.zip,
    metroName: result.zillow?.metro_name ?? null,
    generatedAt: new Date().toISOString(),
    layers,
    geo: result.geo ? { lat: result.geo.lat, lng: result.geo.lng, city: result.geo.city, state: result.geo.state } : null,
    zillow: {
      zori: result.zillow?.zori_latest ?? null,
      zori_growth_yoy: result.zillow?.zori_growth_12m ?? null,
      zhvi: result.zillow?.zhvi_latest ?? null,
      zhvi_growth_yoy: result.zillow?.zhvi_growth_12m ?? null,
    },
    census: {
      vacancy_rate: acs(rows, 'Vacancy_Rate'),
      median_income: acs(rows, 'Median_Household_Income'),
      total_population: acs(rows, 'Total_Population'),
      median_gross_rent_acs: acs(rows, 'Median_Gross_Rent'),
      migration_movers: acs(rows, 'Moved_From_Different_State'),
      population_growth_3yr: acs(rows, 'Population_Growth_3yr'),
    },
    permits: {
      total_units_2021_2023: totalPermitUnits(byYear),
      by_year: byYear,
    },
    employment: {
      unemployment_rate: latestFredMetric(rows, 'Unemployment_Rate'),
      employment_rate: latestFredMetric(rows, 'Employment_Rate'),
    },
    fred: {
      unemployment_monthly: fredUnemploymentSeries(rows),
    },
    trends: {
      series: trends?.series ?? [],
      keyword_scope: trends?.keyword_scope ?? '',
    },
    pins,
    zori_peer_zips: null,
  }
}

export function buildClientReportPayloadFromAggregate(args: {
  aggregate: AggregateShape
  cityZips: CityZipShape[] | null
  layers: MapLayersSnapshot
  pins: ClientReportPin[]
  trends: TrendsShape | null
}): ClientReportPayload {
  const { aggregate, cityZips, layers, pins, trends } = args
  const fredRows: DataRow[] = aggregate.fred.map((r) => ({
    metric_name: r.metric_name,
    metric_value: r.metric_value,
    data_source: 'FRED',
    time_period: r.time_period,
  }))

  const first = cityZips?.find((z) => z.lat && z.lng)
  const primaryZip = cityZips?.[0]?.zip ?? null

  const byYear: { year: string; units: number }[] =
    aggregate.permits.total_units != null && aggregate.permits.total_units > 0
      ? [{ year: '2021–23 Σ', units: Math.round(aggregate.permits.total_units) }]
      : []

  return {
    marketLabel: aggregate.label,
    primaryZip,
    metroName: null,
    generatedAt: new Date().toISOString(),
    layers,
    geo: first?.lat && first?.lng ? { lat: first.lat, lng: first.lng, city: first.city, state: first.state ?? undefined } : null,
    zillow: {
      zori: aggregate.zillow.avg_zori,
      zori_growth_yoy: aggregate.zillow.zori_growth_12m,
      zhvi: aggregate.zillow.avg_zhvi,
      zhvi_growth_yoy: aggregate.zillow.zhvi_growth_12m,
    },
    census: {
      vacancy_rate: aggregate.housing.vacancy_rate,
      median_income: aggregate.housing.median_income,
      total_population: aggregate.total_population,
      median_gross_rent_acs: aggregate.housing.median_rent,
      migration_movers: null,
      population_growth_3yr: null,
    },
    permits: {
      total_units_2021_2023: aggregate.permits.total_units,
      by_year: byYear.length ? byYear : [],
    },
    employment: {
      unemployment_rate: latestFredMetric(fredRows, 'Unemployment_Rate'),
      employment_rate: latestFredMetric(fredRows, 'Employment_Rate'),
    },
    fred: {
      unemployment_monthly: fredUnemploymentSeries(fredRows),
    },
    trends: {
      series: trends?.series ?? [],
      keyword_scope: trends?.keyword_scope ?? '',
    },
    pins,
    zori_peer_zips: (cityZips ?? [])
      .map((z) => z.zip)
      .filter((z): z is string => typeof z === 'string' && /^\d{5}$/.test(z)),
  }
}
