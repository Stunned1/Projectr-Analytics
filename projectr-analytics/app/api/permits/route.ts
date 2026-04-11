/**
 * NYC Permits API
 * Serves permit data from Supabase (pre-ingested from NYC DOB).
 * Supports filtering by borough, zip, job type, and bounding box.
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

export async function GET(request: NextRequest) {
  const borough = request.nextUrl.searchParams.get('borough')?.toUpperCase()
  const zip = request.nextUrl.searchParams.get('zip')
  const jobTypes = request.nextUrl.searchParams.get('types')?.split(',') ?? ['NB', 'A1', 'DM']
  const limit = Math.min(parseInt(request.nextUrl.searchParams.get('limit') ?? '2000'), 5000)

  if (!borough && !zip) {
    return NextResponse.json({ error: 'Provide borough or zip' }, { status: 400 })
  }

  try {
    let query = supabase
      .from('nyc_permits')
      .select('id, borough, house_number, street_name, zip_code, job_type, job_status, job_description, owner_business, initial_cost, proposed_stories, proposed_units, filing_date, lat, lng, nta_name')
      .in('job_type', jobTypes)
      .not('lat', 'is', null)
      .order('initial_cost', { ascending: false })
      .limit(limit)

    if (borough) query = query.eq('borough', borough)
    if (zip) query = query.eq('zip_code', zip)

    const { data, error } = await query
    if (error) throw new Error(error.message)

    // Enrich with human-readable job type labels
    const permits = (data ?? []).map((p) => ({
      ...p,
      job_type_label: JOB_TYPE_LABELS[p.job_type ?? ''] ?? p.job_type,
      address: `${p.house_number ?? ''} ${p.street_name ?? ''}`.trim(),
    }))

    // Stats
    const byType = permits.reduce((acc, p) => {
      acc[p.job_type ?? 'unknown'] = (acc[p.job_type ?? 'unknown'] ?? 0) + 1
      return acc
    }, {} as Record<string, number>)

    const totalCost = permits.reduce((s, p) => s + (p.initial_cost ?? 0), 0)

    return NextResponse.json({
      count: permits.length,
      stats: { by_type: byType, total_cost: totalCost },
      permits,
    })
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Unexpected error'
    return NextResponse.json({ error: message }, { status: 500 })
  }
}
