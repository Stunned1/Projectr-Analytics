import { supabase } from '@/lib/supabase'
import type { TexasZctaDimRow } from './texas-zcta-dim'

export interface ZipAreaLookupRow {
  zip: string
  city: string | null
  state: string | null
  county_name: string | null
  metro_name: string | null
  metro_name_short: string | null
  lat: number | null
  lng: number | null
}

export interface ZipAreaContext extends ZipAreaLookupRow {
  isTexas: boolean
}

export interface ResolveZipAreaContextOptions {
  lookupRow?: ZipAreaLookupRow | null
  fetchCoverageRow?: (zip: string) => Promise<TexasZctaDimRow | null>
  fetchLookupRow?: (zip: string) => Promise<ZipAreaLookupRow | null>
}

function normalizeNullableString(value: string | null | undefined): string | null {
  const normalized = value?.trim() ?? ''
  return normalized.length > 0 ? normalized : null
}

function normalizeStateAbbr(value: string | null | undefined): string | null {
  const normalized = normalizeNullableString(value)
  return normalized ? normalized.toUpperCase() : null
}

function normalizeCoordinate(value: number | null | undefined): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null
}

export function normalizeZipAreaLookupRow(
  row: Partial<ZipAreaLookupRow> | null | undefined
): ZipAreaLookupRow | null {
  const zip = normalizeNullableString(row?.zip)
  if (!zip || !/^\d{5}$/.test(zip)) return null

  return {
    zip,
    city: normalizeNullableString(row?.city),
    state: normalizeStateAbbr(row?.state),
    county_name: normalizeNullableString(row?.county_name),
    metro_name: normalizeNullableString(row?.metro_name),
    metro_name_short: normalizeNullableString(row?.metro_name_short),
    lat: normalizeCoordinate(row?.lat),
    lng: normalizeCoordinate(row?.lng),
  }
}

export function shouldFetchTexasZipCoverage(row: ZipAreaLookupRow | null): boolean {
  if (!row) return true
  if (row.state === 'TX') return true

  return !row.city || !row.county_name || !row.metro_name_short || row.lat == null || row.lng == null
}

export function mergeZipAreaContext(
  lookupRow: ZipAreaLookupRow | null,
  coverageRow: TexasZctaDimRow | null
): ZipAreaContext | null {
  if (!lookupRow && !coverageRow) return null

  const zip = lookupRow?.zip ?? coverageRow?.zcta5 ?? null
  if (!zip) return null

  const state = coverageRow?.state_abbr ?? lookupRow?.state ?? null

  return {
    zip,
    city: coverageRow?.city ?? lookupRow?.city ?? null,
    state,
    county_name: coverageRow?.county_name ?? lookupRow?.county_name ?? null,
    metro_name: coverageRow?.metro_name ?? lookupRow?.metro_name ?? null,
    metro_name_short: coverageRow?.metro_name_short ?? lookupRow?.metro_name_short ?? null,
    lat: coverageRow?.lat ?? lookupRow?.lat ?? null,
    lng: coverageRow?.lng ?? lookupRow?.lng ?? null,
    isTexas: state === 'TX' || coverageRow != null,
  }
}

export async function fetchZipAreaLookupRow(zip: string): Promise<ZipAreaLookupRow | null> {
  const { data } = await supabase
    .from('zip_metro_lookup')
    .select('zip, city, state, county_name, metro_name, metro_name_short, lat, lng')
    .eq('zip', zip)
    .maybeSingle()

  return normalizeZipAreaLookupRow(data as Partial<ZipAreaLookupRow> | null)
}

export async function resolveZipAreaContext(
  zip: string,
  options: ResolveZipAreaContextOptions = {}
): Promise<ZipAreaContext | null> {
  const normalizedZip = zip.trim()
  if (!/^\d{5}$/.test(normalizedZip)) return null

  const lookupRow =
    options.lookupRow !== undefined
      ? normalizeZipAreaLookupRow(options.lookupRow)
      : await (options.fetchLookupRow ?? fetchZipAreaLookupRow)(normalizedZip)

  let coverageRow: TexasZctaDimRow | null = null
  if (shouldFetchTexasZipCoverage(lookupRow)) {
    const fetchCoverageRow =
      options.fetchCoverageRow ??
      (await import('./bigquery-texas-zcta')).fetchTexasZctaRowByZip
    coverageRow = await fetchCoverageRow(normalizedZip)
  }

  return mergeZipAreaContext(lookupRow, coverageRow)
}
