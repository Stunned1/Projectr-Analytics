'use client'

import { useState } from 'react'
import { GoogleGenerativeAI } from '@google/generative-ai'
import type { CycleAnalysis } from '@/lib/cycle/types'
import { GEMINI_NO_EM_DASH_RULE } from '@/lib/gemini-text-rules'
import { stripGeminiStringWrappers } from '@/lib/sanitize-gemini-string'

interface MemoProps {
  marketLabel: string
  /** When set, the memo is anchored to the deterministic cycle classifier output. */
  cycle?: CycleAnalysis | null
  data: {
    avg_zori?: number | null
    avg_zhvi?: number | null
    zori_growth?: number | null
    zhvi_growth?: number | null
    vacancy_rate?: number | null
    median_income?: number | null
    doz_pending?: number | null
    price_cut_pct?: number | null
    inventory?: number | null
    permit_units?: number | null
    population?: number | null
    transit_stops?: number | null
    search_interest?: number | null
  }
}

function cycleBlock(cycle: CycleAnalysis): string {
  return `
Analytical cycle (classifier - do not contradict this phase in your narrative):
- Phase: ${cycle.cycleStage} ${cycle.cyclePosition}
- Confidence: ${cycle.confidence}/100. ${cycle.confidenceLine}
- Data quality: ${cycle.dataQuality}
- Rent: ${cycle.signals.rent.direction} - ${cycle.signals.rent.value} (${cycle.signals.rent.source})
- Vacancy: ${cycle.signals.vacancy.direction} - ${cycle.signals.vacancy.value} (${cycle.signals.vacancy.source})
- Permits: ${cycle.signals.permits.direction} - ${cycle.signals.permits.value} (${cycle.signals.permits.source})
- Employment: ${cycle.signals.employment.direction} - ${cycle.signals.employment.value} (${cycle.signals.employment.source})
`
}

export default function ExecutiveMemo({ marketLabel, cycle, data }: MemoProps) {
  const [memo, setMemo] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function generateMemo() {
    setLoading(true)
    setError(null)
    setMemo(null)

    const context = `
Market: ${marketLabel}
${cycle ? cycleBlock(cycle) : ''}
Key Metrics:
- Median Rent (ZORI): ${data.avg_zori ? '$' + data.avg_zori.toLocaleString() + '/mo' : 'N/A'}${data.zori_growth != null ? ` (${data.zori_growth > 0 ? '+' : ''}${data.zori_growth.toFixed(2)}% YoY)` : ''}
- Home Value (ZHVI): ${data.avg_zhvi ? '$' + data.avg_zhvi.toLocaleString() : 'N/A'}${data.zhvi_growth != null ? ` (${data.zhvi_growth > 0 ? '+' : ''}${data.zhvi_growth.toFixed(2)}% YoY)` : ''}
- Vacancy Rate: ${data.vacancy_rate != null ? data.vacancy_rate + '%' : 'N/A'}
- Median Household Income: ${data.median_income ? '$' + data.median_income.toLocaleString() : 'N/A'}
- Days to Pending: ${data.doz_pending != null ? data.doz_pending + ' days' : 'N/A'}
- Price Cuts: ${data.price_cut_pct != null ? data.price_cut_pct + '% of listings' : 'N/A'}
- Active Inventory: ${data.inventory != null ? data.inventory.toLocaleString() + ' listings' : 'N/A'}
- Permitted Units (2021-2023): ${data.permit_units != null ? data.permit_units.toLocaleString() : 'N/A'}
- Population: ${data.population != null ? data.population.toLocaleString() : 'N/A'}
- Transit Stops: ${data.transit_stops != null ? data.transit_stops.toLocaleString() : 'N/A'}
- Search Interest: ${data.search_interest != null ? data.search_interest + '/100' : 'N/A'}
`

    try {
      const genAI = new GoogleGenerativeAI(process.env.NEXT_PUBLIC_GEMINI_API_KEY ?? '')
      const model = genAI.getGenerativeModel({ model: 'gemini-2.5-flash' })

      const prompt = `You are a senior real estate investment analyst at Scout, a data consulting firm.

Write a concise 3-paragraph executive investment memo for the following market. 

Paragraph 1: Market Overview - summarize the current state of the market using the data provided.${cycle ? ' Open with the classified cycle phase (stage + position) and interpret what it means for supply and demand.' : ''}
Paragraph 2: Opportunity & Risk - identify the key investment opportunity and the primary risk signal.
Paragraph 3: Recommendation - provide a clear, actionable recommendation for a real estate developer or investor.

Use specific numbers from the data. Be direct and professional. No bullet points, no headers - just three clean paragraphs.
${cycle ? 'The analytical cycle block is authoritative for phase naming - align your wording with it.' : ''}

${GEMINI_NO_EM_DASH_RULE}

${context}`

      const result = await model.generateContent(prompt)
      setMemo(stripGeminiStringWrappers(result.response.text()))
    } catch {
      // Fallback: call server-side to avoid exposing key
      try {
        const res = await fetch('/api/memo', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ marketLabel, data, cycle: cycle ?? undefined }),
        })
        const d = await res.json()
        if (d.memo) setMemo(stripGeminiStringWrappers(String(d.memo)))
        else setError(d.error ?? 'Failed to generate memo')
      } catch {
        setError('Failed to generate memo')
      }
    } finally {
      setLoading(false)
    }
  }

  function printMemo() {
    const win = window.open('', '_blank')
    if (!win) return
    win.document.write(`
      <html><head><title>Quick Summary - ${marketLabel}</title>
      <style>
        body { font-family: Georgia, serif; max-width: 700px; margin: 60px auto; color: #111; line-height: 1.7; }
        h1 { font-size: 18px; font-weight: bold; margin-bottom: 4px; }
        .meta { color: #666; font-size: 13px; margin-bottom: 32px; }
        p { margin-bottom: 20px; font-size: 14px; }
        .footer { margin-top: 48px; border-top: 1px solid #ddd; padding-top: 16px; color: #999; font-size: 11px; }
      </style></head>
      <body>
        <h1>Executive Investment Memo</h1>
        <div class="meta">Market: ${marketLabel} &nbsp;·&nbsp; Generated by Scout &nbsp;·&nbsp; ${new Date().toLocaleDateString()}</div>
        ${memo?.split('\n\n').map((p) => `<p>${p}</p>`).join('') ?? ''}
        <div class="footer">This memo was generated by Scout Command Center. Data sourced from FRED, Zillow Research, Census ACS, and HUD.</div>
      </body></html>
    `)
    win.document.close()
    win.print()
  }

  return (
    <div className="flex flex-col gap-3">
      {!memo && (
        <button
          onClick={generateMemo}
          disabled={loading}
          className="flex w-full items-center justify-center gap-2 rounded-xl border border-primary/35 bg-primary/12 py-2.5 text-xs font-semibold text-primary transition-colors hover:bg-primary/22 disabled:opacity-50"
        >
          {loading ? (
            <>
              <div className="h-3 w-3 animate-spin rounded-full border border-primary border-t-transparent" />
              Generating memo...
            </>
          ) : (
            <>
              <span>✦</span>
              Generate Quick Summary
            </>
          )}
        </button>
      )}

      {error && (
        <p className="text-red-400 text-[10px]">{error}</p>
      )}

      {memo && (
        <div className="rounded-xl border border-border/80 bg-muted/20 p-4">
          <div className="mb-3 flex items-center justify-between">
            <p className="text-[10px] font-semibold tracking-widest text-primary uppercase">Quick Summary</p>
            <div className="flex gap-2">
              <button
                onClick={() => setMemo(null)}
                className="text-[10px] text-muted-foreground transition-colors hover:text-foreground"
              >
                Regenerate
              </button>
              <button
                onClick={printMemo}
                className="text-[10px] font-medium text-primary transition-colors hover:text-primary/85"
              >
                Print / PDF →
              </button>
            </div>
          </div>
          <div className="space-y-3">
            {memo.split('\n\n').filter(Boolean).map((para, i) => (
              <p key={i} className="text-zinc-300 text-[11px] leading-relaxed">{para}</p>
            ))}
          </div>
        </div>
      )}
    </div>
  )
}
