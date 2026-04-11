/**
 * Single source of truth for metric copy: UI tooltips, inline panels, and PDF methodology.
 */

export type MetricKey =
  | 'zori'
  | 'zhvi'
  | 'zhvf'
  | 'vacancy'
  | 'medianGrossRent'
  | 'fmr'
  | 'migration'
  | 'permits'
  | 'permitBuildings'
  | 'permitValue'
  | 'population'
  | 'income'
  | 'housingUnits'
  | 'vacantUnits'
  | 'popGrowth3yr'
  | 'employmentRate'
  | 'unemploymentRate'
  | 'gdp'
  | 'dozPending'
  | 'priceCuts'
  | 'inventory'
  | 'trends'
  | 'transit'
  | 'momentum'
  | 'cycleClassifier'
  | 'cycleRecovery'
  | 'cycleExpansion'
  | 'cycleHypersupply'
  | 'cycleRecession'

export interface MetricDefinition {
  label: string
  short: string
  long: string
  source: string
  calculation: string | null
}

export const METRIC_DEFINITIONS: Record<MetricKey, MetricDefinition> = {
  zori: {
    label: 'Median Rent (ZORI)',
    short: 'Zillow Observed Rent Index - asking rents on new leases, not in-place rents.',
    long: 'Zillow Observed Rent Index tracks asking rents for new leases, not in-place rents. It is more responsive to market conditions than many median-rent figures.',
    source: 'Zillow Research',
    calculation: null,
  },
  zhvi: {
    label: 'Home Value (ZHVI)',
    short: 'Zillow Home Value Index - smoothed typical home value, mid-tier market.',
    long: 'Zillow Home Value Index is a smoothed estimate of typical home value and reflects the middle tier of the market.',
    source: 'Zillow Research',
    calculation: null,
  },
  zhvf: {
    label: '1yr Forecast (ZHVF)',
    short: 'Zillow home value forecast - forward-looking modeled growth.',
    long: 'Zillow Home Value Forecast (ZHVF) is a modeled forward-looking growth rate for typical home values in this ZIP.',
    source: 'Zillow Research',
    calculation: null,
  },
  vacancy: {
    label: 'Vacancy rate',
    short: 'Share of housing units unoccupied and available (ACS 5-year; lags ~2 years).',
    long: 'Vacancy rate is the share of housing units that are unoccupied and available. It comes from Census ACS 5-year estimates and is lagged roughly two years versus current conditions.',
    source: 'Census ACS',
    calculation: null,
  },
  medianGrossRent: {
    label: 'Median Gross Rent',
    short: 'ACS median contract rent - in-place rents, not new-lease asking rents.',
    long: 'Census ACS median gross rent for renter-occupied units. It reflects in-place rents and moves more slowly than ZORI.',
    source: 'Census ACS',
    calculation: null,
  },
  fmr: {
    label: 'Fair Market Rent (FMR)',
    short: 'HUD benchmark rent for a modest unit by bedroom - affordability comparisons.',
    long: 'HUD Fair Market Rent is the federal benchmark for what a modest rental unit should cost by bedroom count. Useful for comparing market rents to affordability thresholds.',
    source: 'HUD / Census ACS fallback',
    calculation: null,
  },
  migration: {
    label: 'Migration (movers)',
    short: 'ACS estimate of people who moved from a different state in the past year.',
    long: 'American Community Survey estimate of people who moved from a different state into this ZIP in the past year - a structural demand signal.',
    source: 'Census ACS',
    calculation: null,
  },
  permits: {
    label: 'Building permits (units)',
    short: 'County residential units permitted (Census BPS) - leading supply ~18–24 months.',
    long: 'Residential units permitted at the county level from the Census Building Permits Survey. A leading indicator of future supply, typically 18–24 months before units reach the market.',
    source: 'Census BPS',
    calculation: null,
  },
  permitBuildings: {
    label: 'Permit buildings',
    short: 'Count of permitted structures in the county BPS extract.',
    long: 'Number of permitted structures from the same Census BPS county series used for unit counts.',
    source: 'Census BPS',
    calculation: null,
  },
  permitValue: {
    label: 'Permit construction value',
    short: 'Reported construction value for permitted work (county BPS).',
    long: 'Reported dollar value of construction associated with permits in the Census BPS county extract.',
    source: 'Census BPS',
    calculation: null,
  },
  population: {
    label: 'Population',
    short: 'Total population (ACS 5-year at ZIP).',
    long: 'Total population from Census ACS 5-year estimates at ZCTA level.',
    source: 'Census ACS',
    calculation: null,
  },
  income: {
    label: 'Median household income',
    short: 'ACS median household income.',
    long: 'Median household income from Census ACS 5-year estimates.',
    source: 'Census ACS',
    calculation: null,
  },
  housingUnits: {
    label: 'Total housing units',
    short: 'ACS count of housing units in the ZIP.',
    long: 'Total housing units from Census ACS (B25002), used with vacant units to derive vacancy when needed.',
    source: 'Census ACS',
    calculation: null,
  },
  vacantUnits: {
    label: 'Vacant units',
    short: 'ACS count of vacant housing units.',
    long: 'Vacant housing units from Census ACS - used with total units to contextualize vacancy.',
    source: 'Census ACS',
    calculation: null,
  },
  popGrowth3yr: {
    label: 'Population growth (3yr)',
    short: 'Approximate 2019→2022 ACS population change - can reflect enrollment/noise in college towns.',
    long: 'Three-year population change from comparing ACS vintages (2019 vs 2022 in the pipeline). Can be noisy in college towns or during COVID-era swings.',
    source: 'Census ACS',
    calculation: null,
  },
  employmentRate: {
    label: 'Employment rate',
    short: 'Employed ÷ civilian labor force (FRED county series when both match).',
    long: 'Computed employment rate from FRED county-level employed persons and civilian labor force when monthly dates align.',
    source: 'FRED',
    calculation: null,
  },
  unemploymentRate: {
    label: 'Unemployment rate',
    short: 'County unemployment rate from FRED (monthly).',
    long: 'Local unemployment rate from the FRED series matched to the ZIP’s county.',
    source: 'FRED',
    calculation: null,
  },
  gdp: {
    label: 'Real GDP',
    short: 'County real GDP (annual FRED series).',
    long: 'Real gross domestic product for the county from FRED, annual frequency.',
    source: 'FRED',
    calculation: null,
  },
  dozPending: {
    label: 'Days to pending',
    short: 'Metro mean days listings stay active before pending (Zillow).',
    long: 'Metro-level mean days on market until pending from Zillow Research - velocity indicator for for-sale housing in the broader metro.',
    source: 'Zillow Research (metro)',
    calculation: null,
  },
  priceCuts: {
    label: 'Price cuts',
    short: 'Share of metro listings with a price cut (Zillow).',
    long: 'Metro-level share of listings with a price cut from Zillow Research.',
    source: 'Zillow Research (metro)',
    calculation: null,
  },
  inventory: {
    label: 'Active inventory',
    short: 'Metro for-sale listing count (Zillow).',
    long: 'Metro-level count of active for-sale listings from Zillow Research.',
    source: 'Zillow Research (metro)',
    calculation: null,
  },
  trends: {
    label: 'Google Trends score',
    short: 'Relative search interest (0–100) for apartment-related queries - leads some rent moves.',
    long: 'Relative search interest (0–100) for apartment-related queries in this market from Google Trends. Often moves before rent data fully reflects demand shifts.',
    source: 'Google Trends',
    calculation: null,
  },
  transit: {
    label: 'Transit stops',
    short: 'OpenStreetMap transit stops within the fetch radius.',
    long: 'Count of transit stops from OpenStreetMap / GTFS context within the configured radius - connectivity proxy, not ridership.',
    source: 'OSM / GTFS',
    calculation: null,
  },
  momentum: {
    label: 'Momentum score',
    short: '0–100 peer-relative composite: labor (unemployment), rent level, permit volume.',
    long: 'Composite index from 0–100. The implementation weights three inputs: labor conditions from latest unemployment (inverted so lower unemployment scores higher), ACS median gross rent min–max normalized across the comparison ZIP set, and county permit volume min–max normalized across that same set. Default weights are approximately one-third each unless the API payload overrides them.',
    source: 'Projectr Analytics',
    calculation: 'Labor (unemployment-based) + rent level (vs peers) + permits (vs peers); default weights 33% / 33% / 34%.',
  },
  cycleClassifier: {
    label: 'Cycle position',
    short: 'Four-phase classification from rent, vacancy, permits, and employment signals.',
    long: 'Four-phase market classification (Recovery, Expansion, Hypersupply, Recession) from directional signals on rent trajectory, vacancy level, permit momentum, and local unemployment change versus ~6 months prior. Adapted from the institutional real estate cycle framing; stage (Early/Mid/Late) refines position within the quadrant.',
    source: 'Projectr Analytics',
    calculation: 'Rent + vacancy + permits + employment → quadrant; agreement count and data quality cap confidence.',
  },
  cycleRecovery: {
    label: 'Recovery',
    short: 'Elevated but stabilizing vacancy; rents flat to slightly up; permits low; employment improving.',
    long: 'Recovery: vacancy elevated but stabilizing, rents flat to slightly positive, permits low, employment improving.',
    source: 'Projectr methodology',
    calculation: null,
  },
  cycleExpansion: {
    label: 'Expansion',
    short: 'Falling vacancy, rising rents, permits picking up, strong employment.',
    long: 'Expansion: vacancy falling, rents rising, permits picking up, employment strong.',
    source: 'Projectr methodology',
    calculation: null,
  },
  cycleHypersupply: {
    label: 'Hypersupply',
    short: 'Rent growth slowing, permits surging, vacancy starting to rise.',
    long: 'Hypersupply: rents decelerating, permits surging, vacancy beginning to rise.',
    source: 'Projectr methodology',
    calculation: null,
  },
  cycleRecession: {
    label: 'Recession',
    short: 'Rising vacancy, falling rents, collapsing permits, weakening employment.',
    long: 'Recession: vacancy rising, rents falling, permits collapsing, employment weakening.',
    source: 'Projectr methodology',
    calculation: null,
  },
}

const DATA_ROW_TO_KEY: Record<string, MetricKey> = {
  Total_Population: 'population',
  Median_Household_Income: 'income',
  Median_Gross_Rent: 'medianGrossRent',
  Vacancy_Rate: 'vacancy',
  Moved_From_Different_State: 'migration',
  Total_Housing_Units: 'housingUnits',
  Vacant_Units: 'vacantUnits',
  Population_Growth_3yr: 'popGrowth3yr',
  Permit_Units: 'permits',
  Permit_Buildings: 'permitBuildings',
  Permit_Value_USD: 'permitValue',
  Permit_Count: 'permits',
  Unemployment_Rate: 'unemploymentRate',
  Employment_Rate: 'employmentRate',
  Real_GDP: 'gdp',
}

export function metricKeyFromDataRow(metricName: string): MetricKey | null {
  if (metricName.startsWith('FMR_')) return 'fmr'
  return DATA_ROW_TO_KEY[metricName] ?? null
}

export function fredMetricKey(metricName: string): MetricKey | null {
  if (metricName === 'Unemployment_Rate') return 'unemploymentRate'
  if (metricName === 'Employment_Rate') return 'employmentRate'
  if (metricName === 'Real_GDP') return 'gdp'
  return null
}

/** FRED or Census BPS time series rows shown as sparklines in the panel. */
export function sparklineMetricKey(metricName: string): MetricKey | null {
  if (metricName === 'Permit_Units') return 'permits'
  if (metricName === 'Permit_Value_USD') return 'permitValue'
  if (metricName === 'Permit_Buildings') return 'permitBuildings'
  return fredMetricKey(metricName)
}

/** Rows for the PDF methodology table (compact Definition column). */
export const METHODOLOGY_PDF_ROWS: { metric: string; definition: string; source: string }[] = [
  { metric: 'ZORI', definition: METRIC_DEFINITIONS.zori.short, source: METRIC_DEFINITIONS.zori.source },
  { metric: 'ZHVI', definition: METRIC_DEFINITIONS.zhvi.short, source: METRIC_DEFINITIONS.zhvi.source },
  { metric: 'Vacancy', definition: METRIC_DEFINITIONS.vacancy.short, source: METRIC_DEFINITIONS.vacancy.source },
  { metric: 'Permits (BPS)', definition: METRIC_DEFINITIONS.permits.short, source: METRIC_DEFINITIONS.permits.source },
  { metric: 'Employment (FRED)', definition: METRIC_DEFINITIONS.unemploymentRate.short, source: 'FRED (county)' },
  { metric: 'Migration (ACS)', definition: METRIC_DEFINITIONS.migration.short, source: METRIC_DEFINITIONS.migration.source },
  { metric: 'Google Trends', definition: METRIC_DEFINITIONS.trends.short, source: METRIC_DEFINITIONS.trends.source },
  { metric: 'FMR', definition: METRIC_DEFINITIONS.fmr.short, source: METRIC_DEFINITIONS.fmr.source },
  { metric: 'Momentum score', definition: METRIC_DEFINITIONS.momentum.short, source: METRIC_DEFINITIONS.momentum.source },
  {
    metric: 'Cycle classifier',
    definition: METRIC_DEFINITIONS.cycleClassifier.short,
    source: METRIC_DEFINITIONS.cycleClassifier.source,
  },
  {
    metric: 'Phases (summary)',
    definition:
      'Recovery: elevated vacancy stabilizing, rents flat/up slightly, low permits. Expansion: tight occupancy, rising rents, permits up. Hypersupply: rent slows, permits surge, vacancy rises. Recession: vacancy up, rents down, permits down, jobs weak.',
    source: 'Projectr methodology',
  },
]
