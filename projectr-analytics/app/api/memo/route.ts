import { type NextRequest, NextResponse } from 'next/server'
import { GoogleGenerativeAI } from '@google/generative-ai'
import { GEMINI_NO_EM_DASH_RULE } from '@/lib/gemini-text-rules'
import { stripGeminiStringWrappers } from '@/lib/sanitize-gemini-string'

export const dynamic = 'force-dynamic'

export async function POST(request: NextRequest) {
  try {
    const { marketLabel, data, cycle } = await request.json()

    const cycleCtx =
      cycle && typeof cycle === 'object' && typeof cycle.cycleStage === 'string' && typeof cycle.cyclePosition === 'string'
        ? `
Analytical cycle (authoritative phase - align narrative):
- ${cycle.cycleStage} ${cycle.cyclePosition} (confidence ${typeof cycle.confidence === 'number' ? cycle.confidence : 'N/A'}/100)
- ${typeof cycle.confidenceLine === 'string' ? cycle.confidenceLine : ''}
- Data quality: ${typeof cycle.dataQuality === 'string' ? cycle.dataQuality : 'N/A'}
`
        : ''

    const context = `
Market: ${marketLabel}
${cycleCtx}
- Median Rent (ZORI): ${data.avg_zori ? '$' + data.avg_zori.toLocaleString() + '/mo' : 'N/A'}${data.zori_growth != null ? ` (${data.zori_growth > 0 ? '+' : ''}${data.zori_growth.toFixed(2)}% YoY)` : ''}
- Home Value (ZHVI): ${data.avg_zhvi ? '$' + data.avg_zhvi.toLocaleString() : 'N/A'}${data.zhvi_growth != null ? ` (${data.zhvi_growth > 0 ? '+' : ''}${data.zhvi_growth.toFixed(2)}% YoY)` : ''}
- Vacancy Rate: ${data.vacancy_rate != null ? data.vacancy_rate + '%' : 'N/A'}
- Median Household Income: ${data.median_income ? '$' + data.median_income.toLocaleString() : 'N/A'}
- Days to Pending: ${data.doz_pending != null ? data.doz_pending + ' days' : 'N/A'}
- Price Cuts: ${data.price_cut_pct != null ? data.price_cut_pct + '% of listings' : 'N/A'}
- Active Inventory: ${data.inventory != null ? data.inventory.toLocaleString() + ' listings' : 'N/A'}
- Permitted Units (2021-2023): ${data.permit_units != null ? data.permit_units.toLocaleString() : 'N/A'}
- Population: ${data.population != null ? data.population.toLocaleString() : 'N/A'}
`

    const prompt = `You are a senior real estate investment analyst at Projectr Analytics.

Write a concise 3-paragraph executive investment memo for the following market.

Paragraph 1: Market Overview - summarize the current state using the data.${cycleCtx ? ' Lead with the classified cycle phase when the analytical cycle block is present.' : ''}
Paragraph 2: Opportunity & Risk - identify the key investment opportunity and primary risk signal.
Paragraph 3: Recommendation - provide a clear, actionable recommendation for a developer or investor.

Use specific numbers. Be direct and professional. No bullet points, no headers - three clean paragraphs.

${GEMINI_NO_EM_DASH_RULE}

${context}`

    const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY!)
    const model = genAI.getGenerativeModel({ model: 'gemini-2.5-flash' })
    const result = await model.generateContent(prompt)

    return NextResponse.json({ memo: stripGeminiStringWrappers(result.response.text()) })

  } catch (err) {
    const message = err instanceof Error ? err.message : 'Unexpected error'
    return NextResponse.json({ error: message }, { status: 500 })
  }
}
