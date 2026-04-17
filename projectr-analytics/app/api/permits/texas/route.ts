import { type NextRequest, NextResponse } from 'next/server'
import { getTexasPermitActivity } from '@/lib/texas-permit-activity'
import { normalizeUsStateToAbbr } from '@/lib/us-state-abbr'

export const dynamic = 'force-dynamic'

export async function GET(request: NextRequest) {
  const city = request.nextUrl.searchParams.get('city')?.trim()
  const county = request.nextUrl.searchParams.get('county')?.trim()
  const metro = request.nextUrl.searchParams.get('metro')?.trim()
  const stateRaw = request.nextUrl.searchParams.get('state')?.trim() ?? 'TX'
  const state = normalizeUsStateToAbbr(stateRaw)

  if (!state) {
    return NextResponse.json({ error: `Unrecognized state "${stateRaw}"` }, { status: 400 })
  }

  if (state !== 'TX') {
    return NextResponse.json({ error: 'Texas permit activity is currently only available for Texas scopes' }, { status: 400 })
  }

  const scopeCount = [city, county, metro].filter(Boolean).length
  if (scopeCount !== 1) {
    return NextResponse.json({ error: 'Provide exactly one of city, county, or metro' }, { status: 400 })
  }

  const scope = city
    ? { kind: 'city' as const, name: city, state }
    : county
      ? { kind: 'county' as const, name: county, state }
      : { kind: 'metro' as const, name: metro!, state }

  try {
    const result = await getTexasPermitActivity(scope)
    if (result.places.length === 0) {
      return NextResponse.json(
        {
          error: `No Texas permit activity rows were found for ${scope.kind} "${scope.name}"`,
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
