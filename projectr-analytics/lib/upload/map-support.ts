import { isValidLatLng, parseCoordinate } from './lat-lng-detect'
import type { ImportGeminiTriage } from './import-decision-model'
import type { UploadRawRow } from './types'

export const UPLOAD_ZIP_RE = /^\d{5}$/

export function resolveUploadHeader(headers: string[], name: string | null): string | null {
  if (!name?.trim()) return null
  const want = name.trim().toLowerCase()
  const exact = headers.find((header) => header.trim().toLowerCase() === want)
  return exact ?? headers.find((header) => header.trim().toLowerCase().includes(want)) ?? null
}

export function resolveUploadLatLngHeaders(
  headers: string[],
  triage?: ImportGeminiTriage
): { lat: string | null; lng: string | null } {
  const mappedLat = resolveUploadHeader(headers, triage?.recommended_field_mappings.latitude ?? null)
  const mappedLng = resolveUploadHeader(headers, triage?.recommended_field_mappings.longitude ?? null)
  if (mappedLat || mappedLng) {
    return { lat: mappedLat, lng: mappedLng }
  }

  const lat =
    headers.find((header) => {
      const token = header.toLowerCase()
      return token === 'lat' || token === 'latitude' || token.endsWith('_lat') || token.includes('latitude')
    }) ?? null
  const lng =
    headers.find((header) => {
      const token = header.toLowerCase()
      return token === 'lng' || token === 'lon' || token === 'long' || token === 'longitude' || token.endsWith('_lng') || token.includes('longitude')
    }) ?? null
  return { lat, lng }
}

export function parseUploadNumericValue(raw: string): number | null {
  const parsed = parseFloat(String(raw).replace(/[$,]/g, '').trim())
  return Number.isFinite(parsed) ? parsed : null
}

export function readUploadRowString(row: UploadRawRow, header: string | null): string | null {
  if (!header) return null
  const value = row[header]
  if (value === null || value === undefined) return null
  const normalized = String(value).trim()
  return normalized.length > 0 ? normalized : null
}

function joinLocationParts(parts: Array<string | null>): string | null {
  const clean = parts.filter((part): part is string => Boolean(part?.trim()))
  if (clean.length === 0) return null
  return clean.join(', ')
}

export function buildRowGeographyCandidate(
  row: UploadRawRow,
  triage: ImportGeminiTriage,
  currentZip: string | null
): string | null {
  const mappings = triage.recommended_field_mappings
  const geoRaw = readUploadRowString(row, triage.geo_column)
  const address = readUploadRowString(row, mappings.address)
  const city = readUploadRowString(row, mappings.city)
  const state = readUploadRowString(row, mappings.state)
  const zip = readUploadRowString(row, mappings.zip)

  if (address) {
    return joinLocationParts([
      address,
      city,
      state,
      zip ?? (!city && !state ? currentZip : null),
    ])
  }

  if (zip && UPLOAD_ZIP_RE.test(zip)) return zip
  if (city && state) return `${city}, ${state}`
  if (city && zip) return `${city}, ${zip}`
  if (geoRaw && geoRaw !== address && geoRaw !== city && geoRaw !== zip) return geoRaw
  return geoRaw ?? zip ?? null
}

export function normalizeUploadTimePeriod(raw: string | null): string | null {
  if (!raw) return null
  const date = new Date(raw)
  return Number.isNaN(date.getTime()) ? raw : date.toISOString().split('T')[0]
}

export function compactUploadRowPreview(row: UploadRawRow, limit = 8): UploadRawRow {
  const preview: UploadRawRow = {}
  let count = 0
  for (const [key, value] of Object.entries(row)) {
    if (count >= limit) break
    if (value === null || value === undefined) continue
    if (typeof value === 'string') {
      const trimmed = value.trim()
      if (!trimmed) continue
      preview[key] = trimmed.length > 120 ? `${trimmed.slice(0, 117)}...` : trimmed
      count += 1
      continue
    }
    preview[key] = value
    count += 1
  }
  return preview
}

export interface UploadMarkerCandidateRow {
  rowIndex: number
  submarket_id: string | null
  metric_value: number | null
  time_period: string | null
  lat: number | null
  lng: number | null
  label: string
  row_preview: UploadRawRow
}

export function buildUploadMarkerCandidateRows(args: {
  rows: UploadRawRow[]
  headers: string[]
  triage: ImportGeminiTriage
  currentZip?: string | null
}): UploadMarkerCandidateRow[] {
  const { rows, headers, triage, currentZip = null } = args
  const geoKey = resolveUploadHeader(headers, triage.geo_column)
  const valueKey = resolveUploadHeader(headers, triage.value_column)
  const dateKey = resolveUploadHeader(headers, triage.date_column)
  const { lat: latKey, lng: lngKey } = resolveUploadLatLngHeaders(headers, triage)

  return rows.map((row, index) => {
    const geoRaw = geoKey ? String(row[geoKey] ?? '').trim() : ''
    const submarket = buildRowGeographyCandidate(row, triage, currentZip)
    const metricValue = valueKey ? parseUploadNumericValue(String(row[valueKey] ?? '')) : null
    const timePeriod = normalizeUploadTimePeriod(dateKey ? String(row[dateKey] ?? '').trim() : '')

    const lat = parseCoordinate(row[latKey ?? ''])
    const lng = parseCoordinate(row[lngKey ?? ''])
    const validLatLng = lat != null && lng != null && isValidLatLng(lat, lng)

    const siteName = readUploadRowString(row, triage.recommended_field_mappings.site_name)
    const labelParts = [siteName, geoRaw || submarket, triage.metric_name].filter(Boolean)

    return {
      rowIndex: index,
      submarket_id: submarket || null,
      metric_value: metricValue,
      time_period: timePeriod,
      lat: validLatLng ? lat : null,
      lng: validLatLng ? lng : null,
      label: labelParts.length > 0 ? labelParts.join(' · ') : triage.metric_name,
      row_preview: compactUploadRowPreview(row),
    }
  })
}
