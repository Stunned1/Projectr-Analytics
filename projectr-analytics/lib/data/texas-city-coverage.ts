import type { TexasZctaDimRow } from './texas-zcta-dim'

export interface CityZipCoverageRow {
  zip: string
  city: string
  state: string | null
  metro_name: string | null
  lat: number | null
  lng: number | null
  zori_latest?: number | null
  zhvi_latest?: number | null
  zori_growth_12m?: number | null
  zhvi_growth_12m?: number | null
}

export const MAX_CITY_ZIP_RESULTS = 200

function normalizeStateAbbr(state: string | null | undefined): string | null {
  const normalized = state?.trim().toUpperCase() ?? ''
  return normalized.length > 0 ? normalized : null
}

function normalizeZip(zip: string): string | null {
  const normalized = zip.trim()
  return /^\d{5}$/.test(normalized) ? normalized : null
}

export function shouldMergeTexasCityCoverage(
  stateAbbr: string | undefined,
  lookupRows: readonly CityZipCoverageRow[]
): boolean {
  const normalizedState = normalizeStateAbbr(stateAbbr)
  if (normalizedState === 'TX') return true
  if (normalizedState) return false
  if (lookupRows.length === 0) return true

  return lookupRows.every((row) => normalizeStateAbbr(row.state) === 'TX')
}

function mergeCoverageRow(
  existingRow: CityZipCoverageRow | undefined,
  coverageRow: TexasZctaDimRow,
  fallbackCity: string
): CityZipCoverageRow {
  return {
    zip: existingRow?.zip ?? coverageRow.zcta5,
    city: existingRow?.city ?? coverageRow.city ?? fallbackCity,
    state: normalizeStateAbbr(existingRow?.state) ?? coverageRow.state_abbr,
    metro_name: existingRow?.metro_name ?? coverageRow.metro_name,
    lat: existingRow?.lat ?? coverageRow.lat,
    lng: existingRow?.lng ?? coverageRow.lng,
    zori_latest: existingRow?.zori_latest ?? coverageRow.zori_latest,
    zhvi_latest: existingRow?.zhvi_latest ?? coverageRow.zhvi_latest,
    zori_growth_12m: existingRow?.zori_growth_12m ?? coverageRow.zori_growth_12m,
    zhvi_growth_12m: existingRow?.zhvi_growth_12m ?? coverageRow.zhvi_growth_12m,
  }
}

export function mergeTexasCityCoverageRows(
  lookupRows: readonly CityZipCoverageRow[],
  coverageRows: readonly TexasZctaDimRow[],
  fallbackCity: string
): CityZipCoverageRow[] {
  const rowsByZip = new Map<string, CityZipCoverageRow>()

  for (const row of lookupRows) {
    const normalizedZip = normalizeZip(row.zip)
    if (!normalizedZip) continue

    rowsByZip.set(normalizedZip, {
      ...row,
      zip: normalizedZip,
      state: normalizeStateAbbr(row.state),
    })
  }

  for (const row of coverageRows) {
    const normalizedZip = normalizeZip(row.zcta5)
    if (!normalizedZip) continue

    rowsByZip.set(
      normalizedZip,
      mergeCoverageRow(rowsByZip.get(normalizedZip), row, fallbackCity)
    )
  }

  return Array.from(rowsByZip.values())
}
