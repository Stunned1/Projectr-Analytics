import type { TexasZctaDimRow } from './texas-zcta-dim'
import {
  shouldMergeTexasCityCoverage,
  type CityZipCoverageRow,
} from './texas-city-coverage'

export interface CountyZipCoverageRow extends CityZipCoverageRow {
  county_name?: string | null
}

function normalizeZip(zip: string): string | null {
  const normalized = zip.trim()
  return /^\d{5}$/.test(normalized) ? normalized : null
}

function normalizeStateAbbr(state: string | null | undefined): string | null {
  const normalized = state?.trim().toUpperCase() ?? ''
  return normalized.length > 0 ? normalized : null
}

function mergeCoverageRow(
  existingRow: CountyZipCoverageRow | undefined,
  coverageRow: TexasZctaDimRow
): CountyZipCoverageRow {
  const merged: CountyZipCoverageRow = {
    zip: existingRow?.zip ?? coverageRow.zcta5,
    city: existingRow?.city ?? coverageRow.city ?? `ZIP ${coverageRow.zcta5}`,
    state: normalizeStateAbbr(existingRow?.state) ?? coverageRow.state_abbr,
    metro_name: existingRow?.metro_name ?? coverageRow.metro_name,
    lat: existingRow?.lat ?? coverageRow.lat,
    lng: existingRow?.lng ?? coverageRow.lng,
    zori_latest: existingRow?.zori_latest ?? coverageRow.zori_latest,
    zhvi_latest: existingRow?.zhvi_latest ?? coverageRow.zhvi_latest,
    zori_growth_12m: existingRow?.zori_growth_12m ?? coverageRow.zori_growth_12m,
    zhvi_growth_12m: existingRow?.zhvi_growth_12m ?? coverageRow.zhvi_growth_12m,
  }

  const countyName = existingRow?.county_name ?? coverageRow.county_name ?? null
  if (countyName) {
    merged.county_name = countyName
  }

  return merged
}

export function shouldMergeTexasCountyCoverage(
  stateAbbr: string | undefined,
  lookupRows: readonly CountyZipCoverageRow[]
): boolean {
  return shouldMergeTexasCityCoverage(stateAbbr, lookupRows)
}

export function mergeTexasCountyCoverageRows(
  lookupRows: readonly CountyZipCoverageRow[],
  coverageRows: readonly TexasZctaDimRow[]
): CountyZipCoverageRow[] {
  const rowsByZip = new Map<string, CountyZipCoverageRow>()

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

    rowsByZip.set(normalizedZip, mergeCoverageRow(rowsByZip.get(normalizedZip), row))
  }

  return Array.from(rowsByZip.values())
}
