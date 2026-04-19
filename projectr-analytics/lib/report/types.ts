/** Client -> POST /api/report/pdf */

import type { CycleAnalysis } from '@/lib/cycle/types'
import type { ReportConfig } from '@/lib/report/config'

export type ChoroplethMetric = 'zori' | 'zhvi'

export interface MapLayersSnapshot {
  zipBoundary: boolean
  transitStops: boolean
  rentChoropleth: boolean
  blockGroups: boolean
  parcels: boolean
  tracts: boolean
  amenityHeatmap: boolean
  floodRisk: boolean
  nycPermits: boolean
  clientData: boolean
  choroplethMetric: ChoroplethMetric
}

export interface ClientReportPin {
  lat: number
  lng: number
  label: string
  value?: number | null
}

export interface ClientReportPayload {
  marketLabel: string
  primaryZip: string | null
  metroName: string | null
  generatedAt: string
  reportConfig: ReportConfig
  layers: MapLayersSnapshot
  geo: { lat: number; lng: number; city?: string; state?: string } | null
  zillow: {
    zori: number | null
    zori_growth_yoy: number | null
    zhvi: number | null
    zhvi_growth_yoy: number | null
  }
  census: {
    vacancy_rate: number | null
    median_income: number | null
    total_population: number | null
    median_gross_rent_acs: number | null
    migration_movers: number | null
    population_growth_3yr: number | null
  }
  permits: {
    total_units_2021_2023: number | null
    by_year: { year: string; units: number }[]
  }
  employment: {
    unemployment_rate: number | null
    employment_rate: number | null
  }
  fred: {
    unemployment_monthly: { date: string; value: number }[]
  }
  trends: {
    series: { date: string; value: number }[]
    keyword_scope: string
  }
  pins: ClientReportPin[]
  /** Multi-ZIP area mode: ZIPs used to average monthly ZORI for the PDF chart. */
  zori_peer_zips?: string[] | null
  /** Deterministic cycle classifier + narrative (from GET /api/cycle); PDF uses when present. */
  cycleAnalysis?: CycleAnalysis | null
}

export interface MetroBenchmark {
  avg_zori: number | null
  avg_zhvi: number | null
  zip_count: number
  /** Simple mean of ACS vacancy % across metro peer ZIPs that have cached rows */
  avg_vacancy_rate: number | null
  /** Latest FRED unemployment % per peer ZIP, then simple mean */
  avg_unemployment_rate: number | null
  /** Simple mean of ACS movers (different state) per peer ZIP */
  avg_migration_movers: number | null
}

export interface SignalIndicator {
  id: 'rent' | 'vacancy' | 'permits' | 'employment'
  label: string
  arrow: 'up' | 'down' | 'flat'
  line: string
  positiveForInvestor: boolean
}

export interface GeminiBriefResult {
  cycleHeadline: string
  narrative: string
  confidenceLine: string
}
