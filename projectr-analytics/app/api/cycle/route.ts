import { type NextRequest, NextResponse } from 'next/server'
import { analyzeCycleForZip, cycleHeadline } from '@/lib/cycle/run-analysis'

export const dynamic = 'force-dynamic'

const ZIP_REGEX = /^\d{5}$/

export async function GET(request: NextRequest) {
  const zip = request.nextUrl.searchParams.get('zip')?.trim() ?? ''
  const marketLabel = request.nextUrl.searchParams.get('label')?.trim() || ''

  if (!ZIP_REGEX.test(zip)) {
    return NextResponse.json({ error: 'Invalid or missing zip (use five digits)' }, { status: 400 })
  }

  try {
    const label = marketLabel || `ZIP ${zip}`
    const analysis = await analyzeCycleForZip(zip, label)
    const headline = cycleHeadline(label, analysis)
    return NextResponse.json({ ...analysis, headline })
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Unexpected error'
    return NextResponse.json({ error: message }, { status: 500 })
  }
}
