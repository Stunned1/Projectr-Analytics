/**
 * Projectr AI Agent API
 * Takes a user message + current map context → returns text response + optional map action
 */
import { type NextRequest, NextResponse } from 'next/server'
import { GoogleGenerativeAI } from '@google/generative-ai'

export const dynamic = 'force-dynamic'

const SYSTEM_PROMPT = `You are the Projectr Analytics AI Agent — a spatial intelligence assistant embedded in a real estate command center dashboard.

You can control the entire dashboard: navigate to markets, toggle data layers, analyze conditions, and respond to analyst briefs or uploaded client CSV context.

AVAILABLE LAYERS (exact key names):
- zipBoundary, transitStops, rentChoropleth (rent/value ZIP polygon fill — ZORI or ZHVI per set_metric), parcels, tracts, amenityHeatmap, floodRisk, clientData, permits, pois, momentum

AVAILABLE ACTIONS:
- Navigate to a market: {"type":"search","query":"manhattan"} or {"type":"search","query":"10001"}
- Toggle layer: {"type":"toggle_layer","layer":"<key>","value":true/false}
- Toggle multiple layers: {"type":"toggle_layers","layers":{"transitStops":true,"rentChoropleth":true}}
- Switch metric: {"type":"set_metric","metric":"zori"} or {"type":"set_metric","metric":"zhvi"}
- Tilt map: {"type":"set_tilt","tilt":45}
- Generate memo: {"type":"generate_memo"}
- No action: {"type":"none"}

INTELLIGENCE RULES:
- If user mentions a city, neighborhood, or borough → use search action to navigate there
- If user mentions "transit" or "connectivity" → toggle transitStops and amenityHeatmap
- If user mentions "flood" or "risk" → toggle floodRisk
- If user mentions "rent" or "rental" pricing on the map → toggle rentChoropleth on, set_metric zori (ZORI fill)
- If user mentions "home value" or "ZHVI" on the map → toggle rentChoropleth on, set_metric zhvi (ZHVI fill)
- If user mentions "demographics" or "population" → toggle tracts or blockGroups
- If user pastes a case study or brief → extract the market, enable relevant layers, navigate there
- If user mentions "parcels" or "property values" → toggle parcels (NYC only)
- If user mentions "permits" or "construction" or "development activity" → toggle nycPermits layer (NYC DOB permits)
- If user says "show everything" or "full analysis" → toggle all relevant layers on

RESPONSE FORMAT — CRITICAL: You MUST respond with ONLY valid JSON. No prose, no markdown, no explanation outside the JSON. Return exactly this structure:
{
  "message": "1-2 sentence direct response",
  "action": { ...single action object... },
  "insight": "one key data insight or null"
}

For multiple layer changes, use toggle_layers action with an object of layer keys and boolean values.
PERSONALITY: Direct, data-driven, senior analyst. Use specific numbers when available.`

export async function POST(request: NextRequest) {
  try {
    const { message, context } = await request.json()

    const fmt = (n: number | null | undefined, prefix = '', suffix = '') =>
      n != null ? `${prefix}${n.toLocaleString()}${suffix}` : 'N/A'

    const contextStr = context ? `
CURRENT MAP STATE:
- Active market: ${context.label ?? 'None'}
- ZIP/Search: ${context.zip ?? 'None'}
- Active layers: ${Object.entries(context.layers ?? {}).filter(([, v]) => v).map(([k]) => k).join(', ') || 'none'}
- Rent/value fill metric (ZORI vs ZHVI): ${context.activeMetric ?? 'zori'}

MARKET DATA:
- Median Rent (ZORI): ${fmt(context.zori, '$', '/mo')}${context.zoriGrowth != null ? ` (${context.zoriGrowth > 0 ? '+' : ''}${context.zoriGrowth.toFixed(2)}% YoY)` : ''}
- Home Value (ZHVI): ${fmt(context.zhvi, '$')}${context.zhviGrowth != null ? ` (${context.zhviGrowth > 0 ? '+' : ''}${context.zhviGrowth.toFixed(2)}% YoY)` : ''}
- Vacancy Rate: ${context.vacancyRate != null ? context.vacancyRate + '%' : 'N/A'}
- Days to Pending: ${context.dozPending != null ? context.dozPending + ' days' : 'N/A'}
- Price Cuts: ${context.priceCuts != null ? context.priceCuts + '%' : 'N/A'}
- Active Inventory: ${fmt(context.inventory)}
- Transit Stops: ${fmt(context.transitStops)}
- Population: ${fmt(context.population)}
` : ''

    const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY!)
    const model = genAI.getGenerativeModel({
      model: 'gemini-2.5-flash',
      systemInstruction: SYSTEM_PROMPT,
      generationConfig: {
        responseMimeType: 'application/json',
      },
    })

    const result = await model.generateContent(`${contextStr}\nUSER: ${message}`)
    const raw = result.response.text().trim()

    // Parse JSON response — try multiple extraction strategies
    let parsed: { message: string; action: { type: string; [key: string]: unknown }; insight?: string | null }
    try {
      const cleaned = raw.replace(/^```json\n?/, '').replace(/\n?```$/, '').trim()
      parsed = JSON.parse(cleaned)
    } catch {
      try {
        const match = raw.match(/\{[\s\S]*\}/)
        if (match) {
          parsed = JSON.parse(match[0])
        } else {
          throw new Error('no JSON found')
        }
      } catch {
        parsed = { message: raw.replace(/\{[\s\S]*\}/g, '').trim().slice(0, 300), action: { type: 'none' }, insight: null }
      }
    }

    return NextResponse.json(parsed)
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Unexpected error'
    return NextResponse.json({ error: message }, { status: 500 })
  }
}
