import { isValidLatLng, parseCoordinate } from './lat-lng-detect'
import type { UploadCellValue, UploadRawRow, UploadedLocationRow } from './types'

function toLocationText(value: UploadCellValue): string | null {
  if (value === null || value === undefined) return null
  const text = String(value).trim()
  return text.length > 0 ? text : null
}

export interface BuildUploadedRowsOptions {
  locationColumn: string | null
  latColumn?: string | null
  lngColumn?: string | null
}

export function createUploadedLocationRow(
  rowId: string,
  raw: UploadRawRow,
  options: BuildUploadedRowsOptions
): UploadedLocationRow {
  const { locationColumn, latColumn, lngColumn } = options

  const detectedLocationText =
    locationColumn && Object.prototype.hasOwnProperty.call(raw, locationColumn)
      ? toLocationText(raw[locationColumn])
      : null

  let lat: number | null = null
  let lng: number | null = null
  if (latColumn && lngColumn && Object.prototype.hasOwnProperty.call(raw, latColumn) && Object.prototype.hasOwnProperty.call(raw, lngColumn)) {
    lat = parseCoordinate(raw[latColumn])
    lng = parseCoordinate(raw[lngColumn])
  }

  if (lat != null && lng != null && isValidLatLng(lat, lng)) {
    return {
      rowId,
      raw,
      detectedLocationText,
      normalized: { lat, lng },
      geocode: {
        status: 'ok',
        lat,
        lng,
        formattedAddress: `${lat.toFixed(5)}, ${lng.toFixed(5)}`,
      },
      context: { status: 'pending' },
    }
  }

  return {
    rowId,
    raw,
    detectedLocationText,
    normalized: {},
    geocode: { status: 'pending' },
    context: { status: 'pending' },
  }
}

export function buildUploadedRows(rows: UploadRawRow[], options: BuildUploadedRowsOptions): UploadedLocationRow[] {
  return rows.map((row, idx) => createUploadedLocationRow(`row-${idx + 1}`, row, options))
}
