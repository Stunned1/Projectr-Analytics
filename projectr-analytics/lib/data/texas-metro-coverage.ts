import type { TexasZctaDimRow } from './texas-zcta-dim'
import {
  shouldMergeTexasCityCoverage,
  type CityZipCoverageRow,
} from './texas-city-coverage'

export interface MetroZipCoverageRow extends CityZipCoverageRow {
  metro_name_short?: string | null
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
  existingRow: MetroZipCoverageRow | undefined,
  coverageRow: TexasZctaDimRow
): MetroZipCoverageRow {
  const merged: MetroZipCoverageRow = {
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

  const metroNameShort = existingRow?.metro_name_short ?? coverageRow.metro_name_short ?? null
  if (metroNameShort) {
    merged.metro_name_short = metroNameShort
  }

  return merged
}

export function shouldMergeTexasMetroCoverage(
  stateAbbr: string | undefined,
  lookupRows: readonly MetroZipCoverageRow[]
): boolean {
  return shouldMergeTexasCityCoverage(stateAbbr, lookupRows)
}

export function mergeTexasMetroCoverageRows(
  lookupRows: readonly MetroZipCoverageRow[],
  coverageRows: readonly TexasZctaDimRow[]
): MetroZipCoverageRow[] {
  const rowsByZip = new Map<string, MetroZipCoverageRow>()

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

export function mergeTexasPeerZipLists(
  lookupZips: readonly string[],
  coverageRows: readonly TexasZctaDimRow[],
  options: { excludeZip?: string | null } = {}
): string[] {
  const excludeZip = options.excludeZip?.trim() ?? null
  const merged: string[] = []
  const seen = new Set<string>()

  for (const zip of lookupZips) {
    const normalizedZip = normalizeZip(zip)
    if (!normalizedZip || normalizedZip === excludeZip || seen.has(normalizedZip)) continue
    seen.add(normalizedZip)
    merged.push(normalizedZip)
  }

  for (const row of coverageRows) {
    const normalizedZip = normalizeZip(row.zcta5)
    if (!normalizedZip || normalizedZip === excludeZip || seen.has(normalizedZip)) continue
    seen.add(normalizedZip)
    merged.push(normalizedZip)
  }

  return merged
}
