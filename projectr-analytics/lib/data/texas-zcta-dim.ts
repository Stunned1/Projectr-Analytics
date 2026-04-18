export type TexasZctaCoverageTier = 'zillow_enhanced' | 'public_baseline_only'

export interface TexasZctaDimRow {
  zcta5: string
  city: string | null
  state_abbr: string
  state_fips: string
  county_fips: string | null
  county_name: string | null
  metro_name: string | null
  metro_name_short: string | null
  lat: number | null
  lng: number | null
  land_area_sq_m: number | null
  water_area_sq_m: number | null
  zillow_covered: boolean
  coverage_tier: TexasZctaCoverageTier
  zori_latest: number | null
  zhvi_latest: number | null
  zori_growth_12m: number | null
  zhvi_growth_12m: number | null
  as_of_date: string | null
  source_year: number
  updated_at: string
}
