import { NextRequest, NextResponse } from 'next/server'
import { geocodeZip } from '@/lib/geocoder'
import { geocodeAddressForward, getGoogleForwardGeocodeKey } from '@/lib/google-forward-geocode'
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

async function geocodeOne(row: UploadGeocodeRequestRow): Promise<UploadGeocodeResultRow> {
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

  if (!getGoogleForwardGeocodeKey()) {
    return { rowId: row.rowId, status: 'failed', error: 'Google Maps API key missing for address geocoding' }
  }

  const hit = await geocodeAddressForward(locationText)
  if (!hit) {
    return { rowId: row.rowId, status: 'failed', error: 'No geocode result found' }
  }
  return {
    rowId: row.rowId,
    status: 'ok',
    lat: hit.lat,
    lng: hit.lng,
    formattedAddress: hit.formattedAddress,
    normalized: {
      address: hit.formattedAddress,
      zip: hit.postalCode,
      lat: hit.lat,
      lng: hit.lng,
    },
  }
}

export async function POST(request: NextRequest) {
  try {
    const body = (await request.json()) as GeocodeBody
    const rows = Array.isArray(body.rows) ? body.rows : []
    if (rows.length === 0) {
      return NextResponse.json({ error: 'No rows provided.' }, { status: 400 })
    }

    const maxConcurrency = toSafeConcurrency(body.maxConcurrency)
    const results: UploadGeocodeResultRow[] = new Array(rows.length)
    let cursor = 0

    async function worker() {
      while (true) {
        const index = cursor
        cursor += 1
        if (index >= rows.length) return
        try {
          results[index] = await geocodeOne(rows[index])
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
