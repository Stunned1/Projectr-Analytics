import { type NextRequest, NextResponse } from 'next/server'
import { GoogleGenerativeAI } from '@google/generative-ai'
import Papa from 'papaparse'
import { supabase } from '@/lib/supabase'
import type { VisualBucket } from '@/lib/supabase'
import { geocodeZip } from '@/lib/geocoder'
import { GEMINI_NO_EM_DASH_RULE } from '@/lib/gemini-text-rules'
import { geocodeAddressForward, getGoogleForwardGeocodeKey } from '@/lib/google-forward-geocode'

const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY!)

const triageCache = new Map<
  string,
  {
    bucket: string
    visual_bucket: VisualBucket
    metric_name: string
    geo_column: string | null
    value_column: string | null
    date_column: string | null
    reasoning: string
  }
>()

function hashPreview(preview: string): string {
  let h = 0
  for (let i = 0; i < preview.length; i++) {
    h = (Math.imul(31, h) + preview.charCodeAt(i)) | 0
  }
  return h.toString(36)
}

const TRIAGE_PROMPT = `You are a Data Triage Cop for a real estate analytics platform.
Analyze the CSV headers and first 5 data rows provided and return ONLY valid JSON (no markdown).

Classify into one of three buckets:
- GEOSPATIAL: Has ZIP codes (5-digit US), latitude/longitude pairs, street addresses, city+state, or other geographic keys → can be shown on the map (server geocodes ZIPs and forward-geocodes address-like strings when an API key is configured)
- TEMPORAL: Has dates (or periods) plus numeric values but NO usable geography → line chart in sidebar only
- TABULAR: Cross-sectional grids, IDs without coordinates, or non-mappable text → data panel / grid only

For GEOSPATIAL with point-level intent, set visual_bucket to "MARKER" (ZIP column, address column, or lat/lng — the server geocodes ZIPs and resolves street/place text via Google when configured).
Use "HEATMAP" only if the user clearly has many points for density; default ZIP lists to MARKER.

Return this exact JSON shape (single object, no markdown fences, no commentary):
{
  "bucket": "GEOSPATIAL" | "TEMPORAL" | "TABULAR",
  "visual_bucket": "HEATMAP" | "MARKER" | "POLYGON" | "TIME_SERIES" | "TABULAR",
  "metric_name": "string (best guess at what this data represents)",
  "geo_column": "exact header string for geography (ZIP, address, etc.), or null",
  "value_column": "exact header string for primary numeric value, or null",
  "date_column": "exact header string containing dates, or null",
  "reasoning": "one sentence explanation"
}

${GEMINI_NO_EM_DASH_RULE}`

/** Strip ```json fences and isolate the outermost `{ ... }` when the model adds prose. */
function extractJsonObject(raw: string): string {
  let s = raw.trim()
  s = s.replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/m, '').trim()

  const start = s.indexOf('{')
  if (start < 0) return s

  let depth = 0
  for (let i = start; i < s.length; i++) {
    const c = s[i]
    if (c === '{') depth++
    else if (c === '}') {
      depth--
      if (depth === 0) return s.slice(start, i + 1)
    }
  }
  return s.slice(start)
}

type TriageShape = {
  bucket: string
  visual_bucket: VisualBucket
  metric_name: string
  geo_column: string | null
  value_column: string | null
  date_column: string | null
  reasoning: string
}

function parseTriageJson(raw: string): TriageShape | null {
  const attempts = [raw.trim(), extractJsonObject(raw)]
  const seen = new Set<string>()
  for (const chunk of attempts) {
    const c = chunk.trim()
    if (!c || seen.has(c)) continue
    seen.add(c)
    try {
      const o = JSON.parse(c) as Record<string, unknown>
      if (typeof o.bucket !== 'string' || typeof o.reasoning !== 'string') continue

      const vb = o.visual_bucket
      const allowed: VisualBucket[] = ['HEATMAP', 'MARKER', 'POLYGON', 'TIME_SERIES', 'TABULAR']
      const visual_bucket: VisualBucket =
        typeof vb === 'string' && (allowed as string[]).includes(vb)
          ? (vb as VisualBucket)
          : o.bucket === 'TEMPORAL'
            ? 'TIME_SERIES'
            : 'TABULAR'

      return {
        bucket: o.bucket,
        visual_bucket,
        metric_name: typeof o.metric_name === 'string' ? o.metric_name : 'Imported metric',
        geo_column: o.geo_column == null ? null : String(o.geo_column),
        value_column: o.value_column == null ? null : String(o.value_column),
        date_column: o.date_column == null ? null : String(o.date_column),
        reasoning: o.reasoning,
      }
    } catch {
      /* next */
    }
  }
  return null
}

const ZIP_RE = /^\d{5}$/
const MAX_UNIQUE_ADDRESS_GEOCODE = 50

function resolveHeader(headers: string[], name: string | null): string | null {
  if (!name?.trim()) return null
  const want = name.trim().toLowerCase()
  const exact = headers.find((h) => h.trim().toLowerCase() === want)
  return exact ?? headers.find((h) => h.trim().toLowerCase().includes(want)) ?? null
}

function latLngIndices(headers: string[]): { lat: string | null; lng: string | null } {
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

export async function POST(request: NextRequest) {
  try {
    const formData = await request.formData()
    const file = formData.get('file') as File | null
    const zip = (formData.get('zip') as string | null)?.trim() || null

    if (!file) {
      return NextResponse.json({ error: 'No file provided' }, { status: 400 })
    }

    const text = await file.text()
    const parsed = Papa.parse<Record<string, string>>(text, {
      header: true,
      skipEmptyLines: 'greedy',
      transformHeader: (h) => String(h).trim().replace(/^\uFEFF/, ''),
    })

    const headers = (parsed.meta.fields ?? []).map((h) => h.trim()).filter(Boolean)
    const dataRows = parsed.data.filter((row) =>
      Object.values(row).some((v) => v != null && String(v).trim() !== '')
    )

    if (headers.length === 0 || dataRows.length === 0) {
      return NextResponse.json({ error: 'CSV has no headers or data rows' }, { status: 400 })
    }

    const previewLines = [headers.join(','), ...dataRows.slice(0, 5).map((r) => headers.map((h) => r[h] ?? '').join(','))]
    const preview = previewLines.join('\n')

    const cacheKey = hashPreview(preview)
    let triage = triageCache.get(cacheKey)

    if (!triage) {
      const model = genAI.getGenerativeModel({
        model: 'gemini-2.5-flash',
        generationConfig: { responseMimeType: 'application/json' },
      })
      const result = await model.generateContent(`${TRIAGE_PROMPT}\n\nCSV Preview:\n${preview}`)
      const raw = result.response.text().trim()
      const parsed = parseTriageJson(raw)
      if (!parsed) {
        return NextResponse.json(
          { error: 'Gemini returned invalid JSON', raw: raw.slice(0, 1200) },
          { status: 500 }
        )
      }
      triage = parsed
      triageCache.set(cacheKey, triage)
    }

    if (!triage) {
      return NextResponse.json({ error: 'Data triage unavailable' }, { status: 500 })
    }

    const geoKey = resolveHeader(headers, triage.geo_column)
    const valKey = resolveHeader(headers, triage.value_column)
    const dateKey = resolveHeader(headers, triage.date_column)
    const { lat: latKey, lng: lngKey } = latLngIndices(headers)

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
    }

    const insertRows: RowAcc[] = dataRows.map((row) => {
      const geoRaw = geoKey ? String(row[geoKey] ?? '').trim() : ''
      const submarket = geoRaw || zip
      const value = valKey ? parseNum(String(row[valKey] ?? '')) : null
      const dateRaw = dateKey ? String(row[dateKey] ?? '').trim() : ''
      let time_period: string | null = null
      if (dateRaw) {
        const d = new Date(dateRaw)
        time_period = Number.isNaN(d.getTime()) ? dateRaw : d.toISOString().split('T')[0]
      }

      const latStr = latKey ? String(row[latKey] ?? '').trim() : ''
      const lngStr = lngKey ? String(row[lngKey] ?? '').trim() : ''
      const lat = latStr ? parseFloat(latStr) : null
      const lng = lngStr ? parseFloat(lngStr) : null
      const latOk = lat != null && !Number.isNaN(lat) && Math.abs(lat) <= 90
      const lngOk = lng != null && !Number.isNaN(lng) && Math.abs(lng) <= 180

      const labelParts = [geoRaw, triage.metric_name].filter(Boolean)
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
      }
    })

    const kept = insertRows.filter((r) => r.metric_value !== null || r.submarket_id !== null)

    const zipSet = new Set<string>()
    for (const r of kept) {
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
    if (getGoogleForwardGeocodeKey()) {
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
      triage.bucket === 'GEOSPATIAL' && (triage.visual_bucket === 'MARKER' || triage.visual_bucket === 'HEATMAP')

    const markerPoints = mapVisual
      ? kept
          .filter((r) => r._lat != null && r._lng != null)
          .map((r) => ({
            lat: r._lat!,
            lng: r._lng!,
            value: r.metric_value,
            label: r._label,
          }))
      : []

    const dbRows = kept.map((r) => {
      const { _lat, _lng, _label, ...rest } = r
      void _label
      const geometry =
        rest.geometry ?? (_lat != null && _lng != null ? `POINT(${_lng} ${_lat})` : null)
      return { ...rest, geometry }
    })

    if (kept.length > 0) {
      const { error } = await supabase.from('projectr_master_data').upsert(dbRows as never[], {
        onConflict: 'submarket_id,metric_name,time_period,data_source',
        ignoreDuplicates: true,
      })
      if (error) throw new Error(error.message)
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
      marker_points: markerPoints,
      map_eligible: markerPoints.length > 0,
    })
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Unexpected error'
    return NextResponse.json({ error: message }, { status: 500 })
  }
}
