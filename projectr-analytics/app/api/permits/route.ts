/**
 * NYC Permits API
 * Serves permit data from Supabase (pre-ingested from NYC DOB).
 * Supports filtering by borough, zip, job type, bounding box, and zoom level.
 *
 * zoom < 13  → heatmap points (lat/lng/weight only, NB+A1, up to 5000)
 * zoom 13-15 → scatter points (all types, top 2000 by cost)
 * zoom >= 16 → bbox-filtered scatter (top 500 in viewport)
 */
import { type NextRequest, NextResponse } from 'next/server'
import { supabase } from '@/lib/supabase'

export const dynamic = 'force-dynamic'

const JOB_TYPE_LABELS: Record<string, string> = {
  NB: 'New Building',
  A1: 'Major Alteration',
  A2: 'Minor Alteration',
  DM: 'Demolition',
}

const JOB_TYPE_WEIGHT: Record<string, number> = {
  NB: 3,
  A1: 2,
  DM: 1,
}

export async function GET(request: NextRequest) {
  const borough = request.nextUrl.searchParams.get('borough')?.toUpperCase()
  const zip = request.nextUrl.searchParams.get('zip')
  const jobTypes = request.nextUrl.searchParams.get('types')?.split(',') ?? ['NB', 'A1', 'DM']
  const zoom = parseFloat(request.nextUrl.searchParams.get('zoom') ?? '13')
  const minLat = parseFloat(request.nextUrl.searchParams.get('minLat') ?? 'NaN')
  const maxLat = parseFloat(request.nextUrl.searchParams.get('maxLat') ?? 'NaN')
  const minLng = parseFloat(request.nextUrl.searchParams.get('minLng') ?? 'NaN')
  const maxLng = parseFloat(request.nextUrl.searchParams.get('maxLng') ?? 'NaN')
  const hasBbox = !isNaN(minLat) && !isNaN(maxLat) && !isNaN(minLng) && !isNaN(maxLng)

  if (!borough && !zip && !hasBbox) {
    return NextResponse.json({ error: 'Provide borough, zip, or bbox' }, { status: 400 })
  }

  try {
    // Heatmap mode: low zoom, NB+A1 only, return lightweight points
    if (zoom < 13) {
      let query = supabase
        .from('nyc_permits')
        .select('lat, lng, job_type')
        .in('job_type', ['NB', 'A1'])
        .not('lat', 'is', null)
        .limit(5000)

      if (borough) query = query.eq('borough', borough)
      if (zip) query = query.eq('zip_code', zip)

      const { data, error } = await query
      if (error) throw new Error(error.message)

      const points = (data ?? []).map((p) => ({
        position: [p.lng, p.lat] as [number, number],
        weight: JOB_TYPE_WEIGHT[p.job_type ?? ''] ?? 1,
      }))

      return NextResponse.json({ mode: 'heatmap', count: points.length, points })
    }

    // Street zoom: bbox filter, tight cap
    const limit = zoom >= 16 ? 500 : 2000

    let query = supabase
      .from('nyc_permits')
      .select('id, borough, house_number, street_name, zip_code, job_type, job_status, job_description, owner_business, initial_cost, proposed_stories, proposed_units, filing_date, lat, lng, nta_name')
      .in('job_type', jobTypes)
      .not('lat', 'is', null)
      .order('initial_cost', { ascending: false })
      .limit(limit)

    if (borough) query = query.eq('borough', borough)
    if (zip) query = query.eq('zip_code', zip)
    if (hasBbox) {
      query = query
        .gte('lat', minLat).lte('lat', maxLat)
        .gte('lng', minLng).lte('lng', maxLng)
    }

    const { data, error } = await query
    if (error) throw new Error(error.message)

    const permits = (data ?? []).map((p) => ({
      ...p,
      job_type_label: JOB_TYPE_LABELS[p.job_type ?? ''] ?? p.job_type,
      address: `${p.house_number ?? ''} ${p.street_name ?? ''}`.trim(),
    }))

    const byType = permits.reduce((acc, p) => {
      acc[p.job_type ?? 'unknown'] = (acc[p.job_type ?? 'unknown'] ?? 0) + 1
      return acc
    }, {} as Record<string, number>)

    return NextResponse.json({
      mode: zoom >= 16 ? 'scatter-bbox' : 'scatter',
      count: permits.length,
      stats: { by_type: byType },
      permits,
    })
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Unexpected error'
    return NextResponse.json({ error: message }, { status: 500 })
  }
}
