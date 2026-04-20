import { createElement } from 'react'
import { type NextRequest, NextResponse } from 'next/server'
import { renderToBuffer } from '@react-pdf/renderer'

import { loadScoutLogoDataUri } from '@/lib/report/load-scout-logo'
import { SavedChartsPdfDocument } from '@/lib/report/saved-charts-pdf-document'
import { normalizeSavedChartsPdfPayload, type SavedChartsPdfPayload } from '@/lib/report/saved-charts-export'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

function slugify(value: string): string {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '')
    .slice(0, 60) || 'saved-charts'
}

async function renderSavedChartsPdf(payload: SavedChartsPdfPayload) {
  const logoDataUri = loadScoutLogoDataUri()
  return renderToBuffer(createElement(SavedChartsPdfDocument, { payload, logoDataUri }))
}

export async function POST(request: NextRequest) {
  try {
    const body = await request.json()
    const payload = normalizeSavedChartsPdfPayload(body)
    if (!payload) {
      return NextResponse.json({ error: 'Invalid saved-chart export payload' }, { status: 400 })
    }

    const buffer = await renderSavedChartsPdf(payload)
    const filename = `Scout-${slugify(payload.title)}.pdf`

    return new NextResponse(new Uint8Array(buffer), {
      status: 200,
      headers: {
        'Content-Type': 'application/pdf',
        'Content-Disposition': `attachment; filename="${filename}"`,
        'Cache-Control': 'no-store',
      },
    })
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unexpected error'
    return NextResponse.json({ error: message }, { status: 500 })
  }
}
