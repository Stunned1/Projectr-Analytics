/**
 * Structured case-study brief after spatial analysis — Gemini JSON for optional in-app use.
 */
import { type NextRequest, NextResponse } from 'next/server'
import { generateCaseBriefJson, type CaseBriefSitePayload } from '@/lib/report/case-brief-shared'

export const dynamic = 'force-dynamic'

export type { CaseBriefSitePayload } from '@/lib/report/case-brief-shared'

export async function POST(request: NextRequest) {
  try {
    const body = await request.json()
    const caseStudy = typeof body.caseStudy === 'string' ? body.caseStudy : ''
    const agentSummary = typeof body.agentSummary === 'string' ? body.agentSummary : ''
    const insight = typeof body.insight === 'string' ? body.insight : ''
    const sites = Array.isArray(body.sites) ? (body.sites as CaseBriefSitePayload[]) : []
    const ctx = body.mapContext && typeof body.mapContext === 'object' ? (body.mapContext as Record<string, unknown>) : {}

    const out = await generateCaseBriefJson({
      caseStudy,
      agentSummary,
      insight,
      sites,
      mapContext: ctx,
    })

    return NextResponse.json(out)
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Unexpected error'
    const status = message === 'Missing case study or sites' ? 400 : 500
    return NextResponse.json({ error: message }, { status })
  }
}
