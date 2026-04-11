/**
 * Projectr AI Agent API
 * Takes a user message + current map context → returns text response + optional map action
 *
 * Action schema:
 * { type: "toggle_layer", layer: string, value: boolean }
 * { type: "set_metric", metric: "zori" | "zhvi" }
 * { type: "search", query: string }
 * { type: "generate_memo" }
 * { type: "set_tilt", tilt: number }
 * { type: "none" }
 */
import { type NextRequest, NextResponse } from 'next/server'
import { GoogleGenerativeAI } from '@google/generative-ai'

export const dynamic = 'force-dynamic'

const SYSTEM_PROMPT = `You are the Projectr Analytics AI Agent — a spatial intelligence assistant embedded in a real estate command center dashboard.

You can control the entire dashboard: navigate to markets, toggle data layers, analyze conditions, and respond to case studies or briefs.

AVAILABLE LAYERS (exact key names):
- zipBoundary, transitStops, rentChoropleth, blockGroups, parcels, tracts, amenityHeatmap, floodRisk, clientData

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
- If user mentions "rent" or "pricing" → toggle rentChoropleth, set metric to zori
- If user mentions "value" or "home value" → set metric to zhvi
- If user mentions "demographics" or "population" → toggle tracts or blockGroups
- If user pastes a case study or brief → extract the market, enable relevant layers, navigate there
- If user mentions "parcels" or "property values" → toggle parcels (NYC only)
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

    const contextStr = context ? `
CURRENT MAP STATE:
- Active market: ${context.label ?? 'None'}
- ZIP/Search: ${context.zip ?? 'None'}
- Active layers: ${Object.entries(context.layers ?? {}).filter(([, v]) => v).map(([k]) => k).join(', ') || 'none'}
- Choropleth metric: ${context.activeMetric ?? 'zori'}

MARKET DATA:
- Median Rent (ZORI): ${context.zori ? '$' + context.zori.toLocaleString() + '/mo' : 'N/A'}${context.zoriGrowth != null ? ` (${context.zoriGrowth > 0 ? '+' : ''}${context.zoriGrowth.toFixed(2)}% YoY)` : ''}
- Home Value (ZHVI): ${context.zhvi ? '$' + context.zhvi.toLocaleString() : 'N/A'}${context.zhviGrowth != null ? ` (${context.zhviGrowth > 0 ? '+' : ''}${context.zhviGrowth.toFixed(2)}% YoY)` : ''}
- Vacancy Rate: ${context.vacancyRate != null ? context.vacancyRate + '%' : 'N/A'}
- Days to Pending: ${context.dozPending != null ? context.dozPending + ' days' : 'N/A'}
- Price Cuts: ${context.priceCuts != null ? context.priceCuts + '%' : 'N/A'}
- Active Inventory: ${context.inventory != null ? context.inventory.toLocaleString() : 'N/A'}
- Transit Stops: ${context.transitStops != null ? context.transitStops.toLocaleString() : 'N/A'}
- Population: ${context.population != null ? context.population.toLocaleString() : 'N/A'}
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
      // Strategy 1: direct parse
      const cleaned = raw.replace(/^```json\n?/, '').replace(/\n?```$/, '').trim()
      parsed = JSON.parse(cleaned)
    } catch {
      try {
        // Strategy 2: extract JSON object from text
        const match = raw.match(/\{[\s\S]*\}/)
        if (match) {
          parsed = JSON.parse(match[0])
        } else {
          throw new Error('no JSON found')
        }
      } catch {
        // Strategy 3: treat as plain text, extract action if mentioned
        parsed = { message: raw.replace(/\{[\s\S]*\}/g, '').trim().slice(0, 300), action: { type: 'none' }, insight: null }
      }
    }

    return NextResponse.json(parsed)
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Unexpected error'
    return NextResponse.json({ error: message }, { status: 500 })
  }
}
