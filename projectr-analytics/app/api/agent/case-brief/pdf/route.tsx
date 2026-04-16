import React from 'react'
import { type NextRequest, NextResponse } from 'next/server'
import { renderToBuffer } from '@react-pdf/renderer'
import { generateCaseBriefJson, type CaseBriefSitePayload } from '@/lib/report/case-brief-shared'
import { CaseBriefPdfDocument, type CaseBriefPdfBriefShape } from '@/lib/report/case-brief-pdf-document'
import { loadScoutLogoDataUri } from '@/lib/report/load-scout-logo'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

function slugify(s: string): string {
  return s
    .replace(/[^a-z0-9]+/gi, '-')
    .replace(/^-|-$/g, '')
    .slice(0, 48) || 'case-brief'
}

async function renderCaseBriefPdf(args: {
  brief: CaseBriefPdfBriefShape
  generatedAt: string
  mapLabel: string | null
  logoDataUri: string | null
  sites: CaseBriefSitePayload[]
  mapContext: Record<string, unknown>
}) {
  return renderToBuffer(
    <CaseBriefPdfDocument
      brief={args.brief}
      generatedAt={args.generatedAt}
      mapLabel={args.mapLabel}
      logoDataUri={args.logoDataUri}
      sitesRaw={args.sites}
      mapContext={args.mapContext}
    />
  )
}

export async function POST(request: NextRequest) {
  try {
    const body = await request.json()
    const caseStudy = typeof body.caseStudy === 'string' ? body.caseStudy : ''
    const agentSummary = typeof body.agentSummary === 'string' ? body.agentSummary : ''
    const insight = typeof body.insight === 'string' ? body.insight : ''
    const sites = Array.isArray(body.sites) ? (body.sites as CaseBriefSitePayload[]) : []
    const ctx = body.mapContext && typeof body.mapContext === 'object' ? (body.mapContext as Record<string, unknown>) : {}

    const { brief, generatedAt } = await generateCaseBriefJson({
      caseStudy,
      agentSummary,
      insight,
      sites,
      mapContext: ctx,
    })

    const mapLabel = typeof ctx.label === 'string' ? ctx.label : null
    const logoDataUri = loadScoutLogoDataUri()
    const buffer = await renderCaseBriefPdf({
      brief: brief as CaseBriefPdfBriefShape,
      generatedAt,
      mapLabel,
      logoDataUri,
      sites,
      mapContext: ctx,
    })

    const filename = `Scout-Case-Brief-${mapLabel ? slugify(mapLabel) : 'report'}.pdf`

    return new NextResponse(new Uint8Array(buffer), {
      status: 200,
      headers: {
        'Content-Type': 'application/pdf',
        'Content-Disposition': `attachment; filename="${filename}"`,
        'Cache-Control': 'no-store',
      },
    })
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Unexpected error'
    const status = message === 'Missing case study or sites' ? 400 : 500
    return NextResponse.json({ error: message }, { status })
  }
}
