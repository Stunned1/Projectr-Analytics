import { NextRequest, NextResponse } from 'next/server'
import { geocodeZip } from '@/lib/geocoder'
import { isValidLatLng } from '@/lib/upload/lat-lng-detect'
import type { UploadGeocodeRequestRow, UploadGeocodeResultRow } from '@/lib/upload'

interface GeocodeBody {
  rows?: UploadGeocodeRequestRow[]
  maxConcurrency?: number
}

function toSafeConcurrency(value: number | undefined): number {
  if (!value || !Number.isFinite(value)) return 12
  return Math.min(20, Math.max(1, Math.floor(value)))
}

function isZipOnly(text: string): boolean {
  return /^\d{5}(?:-\d{4})?$/.test(text.trim())
}

async function geocodeViaGoogle(
  locationText: string,
  apiKey: string
): Promise<UploadGeocodeResultRow | null> {
  const url = `https://maps.googleapis.com/maps/api/geocode/json?address=${encodeURIComponent(locationText)}&key=${encodeURIComponent(apiKey)}`
  const response = await fetch(url, { cache: 'no-store', signal: AbortSignal.timeout(12000) })
  if (!response.ok) {
    return { rowId: '', status: 'failed', error: `Google Geocoding failed (${response.status})` }
  }
  const data = await response.json()
  const result = data?.results?.[0]
  const location = result?.geometry?.location
  const status = typeof data?.status === 'string' ? data.status : ''
  const googleDetail =
    typeof data?.error_message === 'string' && data.error_message.length > 0
      ? ` - ${data.error_message}`
      : ''

  if (!location || typeof location.lat !== 'number' || typeof location.lng !== 'number') {
    const base = status ? `Geocoding status: ${status}` : 'No geocode result found'
    return { rowId: '', status: 'failed', error: `${base}${googleDetail}` }
  }

  const formattedAddress =
    typeof result.formatted_address === 'string' ? result.formatted_address : locationText

  const zipComponent = Array.isArray(result.address_components)
    ? result.address_components.find((component: { types?: string[] }) =>
        Array.isArray(component.types) && component.types.includes('postal_code')
      )
    : null
  const postalCode = typeof zipComponent?.long_name === 'string' ? zipComponent.long_name : undefined

  return {
    rowId: '',
    status: 'ok',
    lat: location.lat,
    lng: location.lng,
    formattedAddress,
    normalized: { address: formattedAddress, zip: postalCode, lat: location.lat, lng: location.lng },
  }
}

async function geocodeOne(row: UploadGeocodeRequestRow, googleApiKey: string | null): Promise<UploadGeocodeResultRow> {
  const lat = typeof row.lat === 'number' && Number.isFinite(row.lat) ? row.lat : null
  const lng = typeof row.lng === 'number' && Number.isFinite(row.lng) ? row.lng : null
  if (lat != null && lng != null && isValidLatLng(lat, lng)) {
    return {
      rowId: row.rowId,
      status: 'ok',
      lat,
      lng,
      formattedAddress: `${lat.toFixed(5)}, ${lng.toFixed(5)}`,
      normalized: { lat, lng },
    }
  }

  const locationText = row.locationText?.trim() ?? ''
  if (!locationText) {
    return { rowId: row.rowId, status: 'failed', error: 'No location text provided' }
  }

  const zip = isZipOnly(locationText) ? locationText.slice(0, 5) : null
  if (zip) {
    const zipGeo = await geocodeZip(zip)
    if (zipGeo) {
      return {
        rowId: row.rowId,
        status: 'ok',
        lat: zipGeo.lat,
        lng: zipGeo.lng,
        formattedAddress: `${zipGeo.city}, ${zipGeo.state} ${zip}`,
        normalized: { zip, lat: zipGeo.lat, lng: zipGeo.lng },
      }
    }
  }

  if (!googleApiKey) {
    return { rowId: row.rowId, status: 'failed', error: 'Google Maps API key missing for address geocoding' }
  }

  const googleResult = await geocodeViaGoogle(locationText, googleApiKey)
  if (!googleResult) {
    return { rowId: row.rowId, status: 'failed', error: 'No geocode result found' }
  }
  return { ...googleResult, rowId: row.rowId }
}

export async function POST(request: NextRequest) {
  try {
    const body = (await request.json()) as GeocodeBody
    const rows = Array.isArray(body.rows) ? body.rows : []
    if (rows.length === 0) {
      return NextResponse.json({ error: 'No rows provided.' }, { status: 400 })
    }

    const maxConcurrency = toSafeConcurrency(body.maxConcurrency)
    const googleApiKey = process.env.GOOGLE_GEOCODING_API_KEY ?? process.env.NEXT_PUBLIC_GOOGLE_MAPS_API_KEY ?? null
    const results: UploadGeocodeResultRow[] = new Array(rows.length)
    let cursor = 0

    async function worker() {
      while (true) {
        const index = cursor
        cursor += 1
        if (index >= rows.length) return
        try {
          results[index] = await geocodeOne(rows[index], googleApiKey)
        } catch (err) {
          results[index] = {
            rowId: rows[index].rowId,
            status: 'failed',
            error: err instanceof Error ? err.message : 'Unexpected geocode error',
          }
        }
      }
    }

    await Promise.all(Array.from({ length: Math.min(maxConcurrency, rows.length) }, () => worker()))

    const okCount = results.filter((row) => row.status === 'ok').length
    return NextResponse.json({
      results,
      meta: {
        total: results.length,
        ok: okCount,
        failed: results.length - okCount,
        maxConcurrency: Math.min(maxConcurrency, rows.length),
      },
    })
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Unexpected error'
    return NextResponse.json({ error: message }, { status: 500 })
  }
}
