import { type NextRequest, NextResponse } from 'next/server'
import { GoogleGenerativeAI } from '@google/generative-ai'
import { supabase } from '@/lib/supabase'
import { geocodeZip } from '@/lib/geocoder'
import { geocodeAddressForward, getGoogleForwardGeocodeKey } from '@/lib/google-forward-geocode'
import {
  finalizeImportGeminiTriage,
  IMPORT_TRIAGE_PROMPT,
  parseImportGeminiTriage,
  type ImportGeminiTriage,
} from '@/lib/upload/import-decision-model'
import { parseUploadFile, type UploadRawRow } from '@/lib/upload'

const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY!)

const triageCache = new Map<
  string,
  ImportGeminiTriage
>()

function hashPreview(preview: string): string {
  let h = 0
  for (let i = 0; i < preview.length; i++) {
    h = (Math.imul(31, h) + preview.charCodeAt(i)) | 0
  }
  return h.toString(36)
}

const ZIP_RE = /^\d{5}$/
const MAX_UNIQUE_ADDRESS_GEOCODE = 50
const MAX_RAW_TABLE_ROWS = 40
const MAX_MARKER_POINTS = 500

function resolveHeader(headers: string[], name: string | null): string | null {
  if (!name?.trim()) return null
  const want = name.trim().toLowerCase()
  const exact = headers.find((h) => h.trim().toLowerCase() === want)
  return exact ?? headers.find((h) => h.trim().toLowerCase().includes(want)) ?? null
}

function latLngIndices(
  headers: string[],
  triage?: ImportGeminiTriage
): { lat: string | null; lng: string | null } {
  const mappedLat = resolveHeader(headers, triage?.recommended_field_mappings.latitude ?? null)
  const mappedLng = resolveHeader(headers, triage?.recommended_field_mappings.longitude ?? null)
  if (mappedLat || mappedLng) {
    return { lat: mappedLat, lng: mappedLng }
  }

  const lat =
    headers.find((h) => {
      const x = h.toLowerCase()
      return x === 'lat' || x === 'latitude' || x.endsWith('_lat') || x.includes('latitude')
    }) ?? null
  const lng =
    headers.find((h) => {
      const x = h.toLowerCase()
      return x === 'lng' || x === 'lon' || x === 'long' || x === 'longitude' || x.endsWith('_lng') || x.includes('longitude')
    }) ?? null
  return { lat, lng }
}

function parseNum(raw: string): number | null {
  const n = parseFloat(String(raw).replace(/[$,]/g, '').trim())
  return Number.isFinite(n) ? n : null
}

function readRowString(row: UploadRawRow, header: string | null): string | null {
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

function buildRowGeographyCandidate(
  row: UploadRawRow,
  triage: ImportGeminiTriage,
  currentZip: string | null
): string | null {
  const mappings = triage.recommended_field_mappings
  const geoRaw = readRowString(row, triage.geo_column)
  const address = readRowString(row, mappings.address)
  const city = readRowString(row, mappings.city)
  const state = readRowString(row, mappings.state)
  const zip = readRowString(row, mappings.zip)

  if (address) {
    return joinLocationParts([
      address,
      city,
      state,
      zip ?? (!city && !state ? currentZip : null),
    ])
  }

  if (zip && ZIP_RE.test(zip)) return zip
  if (city && state) return `${city}, ${state}`
  if (city && zip) return `${city}, ${zip}`
  if (geoRaw && geoRaw !== address && geoRaw !== city && geoRaw !== zip) return geoRaw
  return geoRaw ?? zip ?? null
}

function normalizeTimePeriod(raw: string | null): string | null {
  if (!raw) return null
  const date = new Date(raw)
  return Number.isNaN(date.getTime()) ? raw : date.toISOString().split('T')[0]
}

function compactRowPreview(row: UploadRawRow, limit = 8): UploadRawRow {
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

export async function POST(request: NextRequest) {
  try {
    const formData = await request.formData()
    const file = formData.get('file') as File | null
    const zip = (formData.get('zip') as string | null)?.trim() || null
    const mode = String(formData.get('mode') ?? 'import').trim().toLowerCase() === 'review'
      ? 'review'
      : 'import'

    if (!file) {
      return NextResponse.json({ error: 'No file provided' }, { status: 400 })
    }

    const parsedFile = await parseUploadFile(file)
    const headers = parsedFile.columns
    const dataRows = parsedFile.rows
    const analysisSample = {
      file: parsedFile.file,
      headers,
      sample_rows: parsedFile.sampleRows,
    }

    const analysisInput = JSON.stringify(analysisSample)
    const cacheKey = hashPreview(analysisInput)
    let triageCandidate = triageCache.get(cacheKey)
    let fallbackWarning: string | null = null

    if (!triageCandidate) {
      try {
        const model = genAI.getGenerativeModel({
          model: 'gemini-2.5-flash',
          generationConfig: { responseMimeType: 'application/json' },
        })
        const result = await model.generateContent(
          `${IMPORT_TRIAGE_PROMPT}\n\nImport sample JSON:\n${analysisInput}`
        )
        const raw = result.response.text().trim()
        const parsed = parseImportGeminiTriage(raw, headers)
        if (!parsed) {
          fallbackWarning = 'Gemini returned invalid import JSON, so Projectr fell back to structural import heuristics.'
        } else {
          triageCandidate = finalizeImportGeminiTriage(parsed, {
            file: parsedFile.file,
            headers,
            sampleRows: parsedFile.sampleRows,
            hints: parsedFile.hints,
          })
          triageCache.set(cacheKey, triageCandidate)
        }
      } catch {
        fallbackWarning = 'Gemini import triage was unavailable, so Projectr used structural import heuristics for this file.'
      }
    }

    let triage: ImportGeminiTriage =
      triageCandidate ??
      finalizeImportGeminiTriage(null, {
        file: parsedFile.file,
        headers,
        sampleRows: parsedFile.sampleRows,
        hints: parsedFile.hints,
        fallbackWarning,
      })

    if (
      triage.mapability_classification === 'map_normalizable' &&
      !getGoogleForwardGeocodeKey() &&
      !triage.recommended_field_mappings.latitude &&
      !triage.recommended_field_mappings.longitude &&
      !triage.recommended_field_mappings.zip
    ) {
      triage = {
        ...triage,
        warnings: [
          ...triage.warnings,
          'Google forward geocoding is not configured, so address-based rows cannot be mapped automatically yet.',
        ],
      }
    }

    const geoKey = resolveHeader(headers, triage.geo_column)
    const valKey = resolveHeader(headers, triage.value_column)
    const dateKey = resolveHeader(headers, triage.date_column)
    const { lat: latKey, lng: lngKey } = latLngIndices(headers, triage)
    const shouldAttemptMapResolution =
      triage.mapability_classification === 'map_ready' ||
      triage.mapability_classification === 'map_normalizable'

    type RowAcc = {
      submarket_id: string | null
      geometry: string | null
      metric_name: string
      metric_value: number | null
      time_period: string | null
      data_source: string
      visual_bucket: string
      _lat: number | null
      _lng: number | null
      _label: string
      _rowPreview: UploadRawRow
    }

    const insertRows: RowAcc[] = dataRows.map((row: UploadRawRow) => {
      const geoRaw = geoKey ? String(row[geoKey] ?? '').trim() : ''
      const submarket = shouldAttemptMapResolution
        ? buildRowGeographyCandidate(row, triage, zip)
        : null
      const value = valKey ? parseNum(String(row[valKey] ?? '')) : null
      const time_period = normalizeTimePeriod(dateKey ? String(row[dateKey] ?? '').trim() : '')

      const latStr = latKey ? String(row[latKey] ?? '').trim() : ''
      const lngStr = lngKey ? String(row[lngKey] ?? '').trim() : ''
      const lat = latStr ? parseFloat(latStr) : null
      const lng = lngStr ? parseFloat(lngStr) : null
      const latOk = lat != null && !Number.isNaN(lat) && Math.abs(lat) <= 90
      const lngOk = lng != null && !Number.isNaN(lng) && Math.abs(lng) <= 180

      const siteName = readRowString(row, triage.recommended_field_mappings.site_name)
      const labelParts = [siteName, geoRaw || submarket, triage.metric_name].filter(Boolean)
      const _label = labelParts.length ? labelParts.join(' · ') : triage.metric_name

      return {
        submarket_id: submarket || null,
        geometry: latOk && lngOk ? `POINT(${lng!} ${lat!})` : null,
        metric_name: triage.metric_name,
        metric_value: value,
        time_period,
        data_source: 'Client Upload',
        visual_bucket: triage.visual_bucket,
        _lat: latOk ? lat : null,
        _lng: lngOk ? lng : null,
        _label,
        _rowPreview: compactRowPreview(row),
      }
    })

    const kept = insertRows.filter(
      (r) =>
        r.metric_value !== null ||
        r.submarket_id !== null ||
        r.time_period !== null
    )

    const zipSet = new Set<string>()
    for (const r of kept) {
      if (!shouldAttemptMapResolution) break
      if (r._lat != null && r._lng != null) continue
      const z = r.submarket_id?.trim() ?? ''
      if (ZIP_RE.test(z)) zipSet.add(z)
    }

    const maxZipGeocode = 60
    const zipList = [...zipSet].slice(0, maxZipGeocode)
    const zipToLatLng = new Map<string, { lat: number; lng: number }>()
    for (const z of zipList) {
      try {
        const g = await geocodeZip(z)
        if (g) zipToLatLng.set(z, { lat: g.lat, lng: g.lng })
      } catch {
        /* skip */
      }
    }

    for (const r of kept) {
      if (!shouldAttemptMapResolution) break
      if (r._lat != null && r._lng != null) continue
      const z = r.submarket_id?.trim() ?? ''
      if (ZIP_RE.test(z)) {
        const p = zipToLatLng.get(z)
        if (p) {
          r._lat = p.lat
          r._lng = p.lng
        }
      }
    }

    // Street addresses, "City, ST", etc. — Google Geocoding API (same keys as /api/upload/geocode)
    if (shouldAttemptMapResolution && getGoogleForwardGeocodeKey()) {
      const addressCandidates = new Set<string>()
      for (const r of kept) {
        if (r._lat != null && r._lng != null) continue
        const g = r.submarket_id?.trim() ?? ''
        if (!g || ZIP_RE.test(g)) continue
        if (g.length < 3) continue
        addressCandidates.add(g)
      }
      const addressList = [...addressCandidates].slice(0, MAX_UNIQUE_ADDRESS_GEOCODE)
      const textToLatLng = new Map<string, { lat: number; lng: number }>()
      const batchSize = 6
      for (let i = 0; i < addressList.length; i += batchSize) {
        const batch = addressList.slice(i, i + batchSize)
        const coords = await Promise.all(batch.map((addr) => geocodeAddressForward(addr)))
        batch.forEach((addr, j) => {
          const pt = coords[j]
          if (pt) textToLatLng.set(addr, pt)
        })
      }
      for (const r of kept) {
        if (r._lat != null && r._lng != null) continue
        const g = r.submarket_id?.trim() ?? ''
        if (!g) continue
        const p = textToLatLng.get(g)
        if (p) {
          r._lat = p.lat
          r._lng = p.lng
        }
      }
    }

    const mapVisual =
      shouldAttemptMapResolution &&
      triage.bucket === 'GEOSPATIAL' &&
      (triage.visual_bucket === 'MARKER' || triage.visual_bucket === 'HEATMAP')

    const markerCandidates = mapVisual
      ? kept
          .filter((r) => r._lat != null && r._lng != null)
          .map((r) => ({
            lat: r._lat!,
            lng: r._lng!,
            value: r.metric_value,
            label: r._label,
            file_name: file.name,
            metric_name: r.metric_name,
            submarket_id: r.submarket_id,
            time_period: r.time_period,
            row_preview: r._rowPreview,
          }))
      : []
    const markerPoints =
      markerCandidates.length > MAX_MARKER_POINTS
        ? markerCandidates.slice(0, MAX_MARKER_POINTS)
        : markerCandidates

    if (markerCandidates.length > MAX_MARKER_POINTS) {
      triage = {
        ...triage,
        warnings: [
          ...triage.warnings,
          `Map preview capped at ${MAX_MARKER_POINTS.toLocaleString()} markers to keep the client layer responsive.`,
        ],
      }
    }

    const dbRows = kept
      .filter((r) => r.metric_value !== null || r.submarket_id !== null)
      .map((r) => {
      const { _lat, _lng, _label, _rowPreview, ...rest } = r
      void _label
      void _rowPreview
      const geometry =
        rest.geometry ?? (_lat != null && _lng != null ? `POINT(${_lng} ${_lat})` : null)
      return { ...rest, geometry }
      })

    let committed = mode === 'import'
    let persistenceWarning: string | null = null
    if (mode === 'import' && dbRows.length > 0) {
      try {
        const { error } = await supabase.from('projectr_master_data').upsert(dbRows as never[], {
          onConflict: 'submarket_id,metric_name,time_period,data_source',
          ignoreDuplicates: true,
        })
        if (error) throw new Error(error.message)
      } catch (error) {
        committed = false
        persistenceWarning =
          error instanceof Error ? error.message : 'Projectr could not persist this import to Supabase.'
        triage = {
          ...triage,
          warnings: [
            ...triage.warnings,
            'Projectr imported this dataset locally, but server persistence failed. Map and sidebar workflows still work in this browser session.',
          ],
        }
      }
    }

    const preview_rows = kept.slice(0, 8).map((r) => ({
      submarket_id: r.submarket_id,
      metric_name: r.metric_name,
      metric_value: r.metric_value,
      time_period: r.time_period,
      visual_bucket: r.visual_bucket,
    }))

    return NextResponse.json({
      triage,
      rows_ingested: kept.length,
      preview_rows,
      parse_summary: analysisSample,
      raw_table: {
        headers,
        rows: dataRows.slice(0, MAX_RAW_TABLE_ROWS),
        total_rows: dataRows.length,
        truncated: dataRows.length > MAX_RAW_TABLE_ROWS,
      },
      marker_points: markerPoints,
      map_eligible: markerCandidates.length > 0,
      committed,
      persistence_warning: persistenceWarning,
    })
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Unexpected error'
    return NextResponse.json({ error: message }, { status: 500 })
  }
}
