import { type NextRequest, NextResponse } from 'next/server'
import { getTexasRawPermits } from '@/lib/texas-raw-permits'
import { normalizeUsStateToAbbr } from '@/lib/us-state-abbr'

export const dynamic = 'force-dynamic'

export async function GET(request: NextRequest) {
  const city = request.nextUrl.searchParams.get('city')?.trim()
  const stateRaw = request.nextUrl.searchParams.get('state')?.trim() ?? 'TX'
  const state = normalizeUsStateToAbbr(stateRaw)

  if (!city) {
    return NextResponse.json({ error: 'Missing city' }, { status: 400 })
  }
  if (!state) {
    return NextResponse.json({ error: `Unrecognized state "${stateRaw}"` }, { status: 400 })
  }

  try {
    const result = await getTexasRawPermits({ city, state })
    if (!result || result.permits.length === 0) {
      return NextResponse.json(
        {
          error: `No supported Texas raw permit source is configured for ${city}, ${state}`,
        },
        { status: 404 }
      )
    }
    return NextResponse.json(result)
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unexpected error'
    return NextResponse.json({ error: message }, { status: 500 })
  }
}
