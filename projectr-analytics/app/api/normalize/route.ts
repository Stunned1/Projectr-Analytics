import { type NextRequest, NextResponse } from 'next/server'
import { GoogleGenerativeAI } from '@google/generative-ai'
import { supabase } from '@/lib/supabase'
import type { VisualBucket } from '@/lib/supabase'

const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY!)

const TRIAGE_PROMPT = `You are a Data Triage Cop for a real estate analytics platform.
Analyze the CSV headers and first 5 rows provided and return ONLY valid JSON (no markdown).

Classify the data into one of three buckets:
- GEOSPATIAL: Contains zip codes, lat/lng, or geographic identifiers → renders as map layer
- TEMPORAL: Contains dates + numeric values but no geography → renders as line chart  
- TABULAR: Everything else → renders as data grid

Return this exact JSON shape:
{
  "bucket": "GEOSPATIAL" | "TEMPORAL" | "TABULAR",
  "visual_bucket": "HEATMAP" | "MARKER" | "POLYGON" | "TIME_SERIES" | "TABULAR",
  "metric_name": "string (best guess at what this data represents)",
  "geo_column": "column name containing geography, or null",
  "value_column": "column name containing the primary numeric value, or null",
  "date_column": "column name containing dates, or null",
  "reasoning": "one sentence explanation"
}`

export async function POST(request: NextRequest) {
  try {
    const formData = await request.formData()
    const file = formData.get('file') as File | null
    const zip = formData.get('zip') as string | null

    if (!file) {
      return NextResponse.json({ error: 'No file provided' }, { status: 400 })
    }

    const text = await file.text()
    const lines = text.split('\n').filter(Boolean)
    const preview = lines.slice(0, 6).join('\n') // headers + 5 rows

    // Ask Gemini to triage the data
    const model = genAI.getGenerativeModel({ model: 'gemini-1.5-pro' })
    const result = await model.generateContent(`${TRIAGE_PROMPT}\n\nCSV Preview:\n${preview}`)
    const raw = result.response.text().trim()

    let triage: {
      bucket: string
      visual_bucket: VisualBucket
      metric_name: string
      geo_column: string | null
      value_column: string | null
      date_column: string | null
      reasoning: string
    }

    try {
      triage = JSON.parse(raw)
    } catch {
      return NextResponse.json({ error: 'Gemini returned invalid JSON', raw }, { status: 500 })
    }

    // Parse and ingest all rows into Supabase
    const headers = lines[0].split(',').map((h) => h.trim().replace(/"/g, ''))
    const rows = lines.slice(1)

    const geoIdx = triage.geo_column ? headers.indexOf(triage.geo_column) : -1
    const valIdx = triage.value_column ? headers.indexOf(triage.value_column) : -1
    const dateIdx = triage.date_column ? headers.indexOf(triage.date_column) : -1

    const insertRows = rows
      .map((row) => {
        const cols = row.split(',').map((c) => c.trim().replace(/"/g, ''))
        const submarket = geoIdx >= 0 ? cols[geoIdx] : (zip ?? null)
        const value = valIdx >= 0 ? parseFloat(cols[valIdx]) : null
        const date = dateIdx >= 0 ? cols[dateIdx] : null

        return {
          submarket_id: submarket,
          geometry: null,
          metric_name: triage.metric_name,
          metric_value: isNaN(value as number) ? null : value,
          time_period: date ? new Date(date).toISOString().split('T')[0] : null,
          data_source: 'Client Upload',
          visual_bucket: triage.visual_bucket,
        }
      })
      .filter((r) => r.metric_value !== null || r.submarket_id !== null)

    if (insertRows.length > 0) {
      const { error } = await supabase.from('projectr_master_data').insert(insertRows)
      if (error) throw new Error(error.message)
    }

    return NextResponse.json({
      triage,
      rows_ingested: insertRows.length,
      preview_rows: insertRows.slice(0, 5),
    })
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Unexpected error'
    return NextResponse.json({ error: message }, { status: 500 })
  }
}
