import type { UploadCellValue } from './types'

/** Normalize header for fuzzy matching (Site Address, site_address, ADDRESS → comparable token). */
export function normalizeHeaderKey(raw: string): string {
  return String(raw ?? '')
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '')
}

const LAT_PATTERNS = [
  /^lat(itude)?$/,
  /^y$/,
  /^coord_?lat$/,
  /^latitude$/,
]

const LNG_PATTERNS = [
  /^lon(g(itude)?)?$/,
  /^lng$/,
  /^x$/,
  /^coord_?lon(g)?$/,
  /^longitude$/,
]

function matchesPattern(norm: string, patterns: RegExp[]): boolean {
  return patterns.some((p) => p.test(norm))
}

export function detectLatLngColumns(columns: string[]): { latColumn: string | null; lngColumn: string | null } {
  let latColumn: string | null = null
  let lngColumn: string | null = null

  for (const col of columns) {
    const norm = normalizeHeaderKey(col)
    if (!latColumn && matchesPattern(norm, LAT_PATTERNS)) latColumn = col
    if (!lngColumn && matchesPattern(norm, LNG_PATTERNS)) lngColumn = col
  }

  return { latColumn, lngColumn }
}

export function parseCoordinate(value: UploadCellValue): number | null {
  if (value === null || value === undefined) return null
  const n = typeof value === 'number' ? value : parseFloat(String(value).trim().replace(/,/g, ''))
  return Number.isFinite(n) ? n : null
}

export function isValidLatLng(lat: number, lng: number): boolean {
  return lat >= -90 && lat <= 90 && lng >= -180 && lng <= 180
}
