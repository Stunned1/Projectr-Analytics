import { type NextRequest, NextResponse } from 'next/server'
import { GoogleGenerativeAI } from '@google/generative-ai'
import { upsertMarketDataRows } from '@/lib/data/market-data-router'
import type { VisualBucket } from '@/lib/data/types'
import { geocodeZip } from '@/lib/geocoder'
import { geocodeAddressForward, getGoogleForwardGeocodeKey } from '@/lib/google-forward-geocode'
import {
  finalizeImportGeminiTriage,
  IMPORT_TRIAGE_PROMPT,
  parseImportGeminiTriage,
  type ImportGeminiTriage,
} from '@/lib/upload/import-decision-model'
import { buildUploadMarkerCandidateRows, parseUploadFile, UPLOAD_ZIP_RE, type UploadRawRow } from '@/lib/upload'

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

const MAX_UNIQUE_ADDRESS_GEOCODE = 50
const MAX_RAW_TABLE_ROWS = 40
const MAX_MARKER_POINTS = 500

export async function POST(request: NextRequest) {
  try {
    const formData = await request.formData()
    const file = formData.get('file') as File | null
    const zip = (formData.get('zip') as string | null)?.trim() || null
    const reviewFingerprint = (formData.get('review_fingerprint') as string | null)?.trim() || null
    const reviewedTriageRaw = (formData.get('reviewed_triage') as string | null)?.trim() || null
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

    if (mode === 'import' && reviewedTriageRaw) {
      if (!reviewFingerprint || reviewFingerprint !== cacheKey) {
        return NextResponse.json(
          { error: 'Reviewed import fingerprint does not match the uploaded file.' },
          { status: 400 }
        )
      }

      const reviewedTriage = parseImportGeminiTriage(reviewedTriageRaw, headers)
      if (!reviewedTriage) {
        return NextResponse.json(
          { error: 'Reviewed import interpretation was invalid.' },
          { status: 400 }
        )
      }

      triageCandidate = finalizeImportGeminiTriage(reviewedTriage, {
        file: parsedFile.file,
        headers,
        sampleRows: parsedFile.sampleRows,
        hints: parsedFile.hints,
      })
    }

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
      visual_bucket: VisualBucket
      _lat: number | null
      _lng: number | null
      _label: string
      _rowPreview: UploadRawRow
    }

    const insertRows: RowAcc[] = buildUploadMarkerCandidateRows({
      rows: dataRows,
      headers,
      triage,
      currentZip: zip,
    }).map((candidate) => ({
      submarket_id: shouldAttemptMapResolution ? candidate.submarket_id : null,
      geometry:
        shouldAttemptMapResolution && candidate.lat != null && candidate.lng != null
          ? `POINT(${candidate.lng} ${candidate.lat})`
          : null,
      metric_name: triage.metric_name,
      metric_value: candidate.metric_value,
      time_period: candidate.time_period,
      data_source: 'Client Upload',
      visual_bucket: triage.visual_bucket,
      _lat: shouldAttemptMapResolution ? candidate.lat : null,
      _lng: shouldAttemptMapResolution ? candidate.lng : null,
      _label: candidate.label,
      _rowPreview: candidate.row_preview,
    }))

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
      if (UPLOAD_ZIP_RE.test(z)) zipSet.add(z)
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
      if (UPLOAD_ZIP_RE.test(z)) {
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
        if (!g || UPLOAD_ZIP_RE.test(g)) continue
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
        await upsertMarketDataRows(dbRows, { conflictMode: 'ignore' })
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
      review_fingerprint: cacheKey,
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
      map_eligible:
        triage.mapability_classification === 'map_ready' ||
        triage.mapability_classification === 'map_normalizable',
      committed,
      persistence_warning: persistenceWarning,
    })
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Unexpected error'
    return NextResponse.json({ error: message }, { status: 500 })
  }
}
