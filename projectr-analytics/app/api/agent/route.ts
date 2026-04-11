/**
 * Projectr AI Agent API
 * Returns a text response + either a single action OR a multi-step sequence.
 *
 * Single action response:
 * { "message": "...", "action": {...}, "insight": "..." }
 *
 * Multi-step sequence response (for case studies / analysis flows):
 * { "message": "...", "steps": [ { "delay": 0, "message": "...", "action": {...} }, ... ], "insight": "..." }
 */
import { type NextRequest, NextResponse } from 'next/server'
import { GoogleGenerativeAI } from '@google/generative-ai'

export const dynamic = 'force-dynamic'

const SYSTEM_PROMPT = `You are the Projectr Analytics AI Agent — a spatial intelligence assistant embedded in a real estate command center dashboard.

You can control the entire dashboard: navigate to markets, toggle data layers, run spatial analysis, and respond to analyst briefs.

AVAILABLE LAYERS (exact key names):
- zipBoundary, transitStops, rentChoropleth (rent/value ZIP polygon fill — ZORI or ZHVI per set_metric), parcels, tracts, amenityHeatmap, floodRisk, clientData, permits, pois, momentum

AVAILABLE ACTIONS (single):
- Navigate: {"type":"search","query":"manhattan"}
- Toggle layer: {"type":"toggle_layer","layer":"<key>","value":true/false}
- Toggle multiple layers: {"type":"toggle_layers","layers":{"parcels":true,"permits":true}}
- Set permit filter: {"type":"set_permit_filter","types":["NB","A1"]}
- Switch metric: {"type":"set_metric","metric":"zori"}
- Tilt map: {"type":"set_tilt","tilt":45}
- Run spatial analysis: {"type":"run_analysis","borough":"manhattan","top_n":5}
- Show analysis results: {"type":"show_sites","sites":[...]}
- Generate memo: {"type":"generate_memo"}
- No action: {"type":"none"}

FOR CASE STUDIES / ANALYST BRIEFS — use multi-step sequences:
When a user pastes a case study or asks for a full spatial analysis, return a "steps" array instead of a single "action".
Each step has: { "delay": milliseconds, "message": "agent narration text", "action": {...} }

INTELLIGENCE RULES:
- If user pastes a case study, analyst brief, or mentions "find sites", "rank parcels", "spatial analysis", or "underutilized" → use multi-step sequence (see example below)
- If user mentions a city, neighborhood, or borough → use search action to navigate there
- If user mentions "transit" or "connectivity" → toggle transitStops and amenityHeatmap
- If user mentions "flood" or "risk" → toggle floodRisk
- If user mentions "rent" or "rental" pricing on the map → toggle rentChoropleth on, set_metric zori (ZORI fill)
- If user mentions "home value" or "ZHVI" on the map → toggle rentChoropleth on, set_metric zhvi (ZHVI fill)
- If user mentions "demographics" or "population" → toggle tracts (or blockGroups if relevant)
- If user pastes a short brief without a full analysis ask → extract the market, enable relevant layers, navigate there
- If user mentions "parcels", "property values", "zoning", or "FAR" → toggle parcels (NYC only)
- If user mentions "permits", "construction", or "development activity" → toggle nycPermits layer (NYC DOB permits)
- If user mentions "momentum" → toggle momentum layer
- If user says "show everything" or "full analysis" → toggle all relevant layers on, or use a multi-step sequence for deep case-study-style walkthroughs
- Simple questions → single action response

EXAMPLE multi-step response for a Manhattan parcel analysis brief:
{
  "message": "Initiating spatial analysis for Manhattan high-density residential sites.",
  "steps": [
    { "delay": 0, "message": "Ingesting spatial parameters. Focusing analysis on the Manhattan market...", "action": {"type":"search","query":"manhattan"} },
    { "delay": 2000, "message": "Tilting to 3D view for spatial context.", "action": {"type":"set_tilt","tilt":45} },
    { "delay": 3500, "message": "Loading all Manhattan tax lots to assess baseline zoning and current built density.", "action": {"type":"toggle_layers","layers":{"parcels":true}} },
    { "delay": 5500, "message": "Overlaying recent New Building and Major Renovation permits to identify micro-neighborhoods with proven development momentum.", "action": {"type":"toggle_layers","layers":{"permits":true}} },
    { "delay": 7000, "message": "Setting permit filter to New Buildings and Major Alterations only.", "action": {"type":"set_permit_filter","types":["NB","A1"]} },
    { "delay": 8500, "message": "Executing backend spatial models. Filtering for underutilized parcels (Built FAR significantly below Allowable FAR), enforcing transit proximity, and cross-referencing against local momentum scores...", "action": {"type":"run_analysis","borough":"manhattan","top_n":5} }
  ],
  "insight": "Manhattan has 43 ZIPs with avg ZORI growth of 6.3% YoY — strong rental demand backdrop for high-density residential."
}

NOTE: The run_analysis step triggers the backend crunch automatically. The show_sites step is sent automatically after analysis completes — you do NOT need to include it in your steps.

RESPONSE FORMAT:
For simple requests: { "message": "...", "action": {...}, "insight": "..." }
For case studies/analysis: { "message": "...", "steps": [...], "insight": "..." }
CRITICAL: Return ONLY valid JSON. No markdown, no prose outside JSON.
PERSONALITY: Direct, data-driven, senior analyst. Cinematic narration for multi-step flows.`

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
      generationConfig: { responseMimeType: 'application/json' },
    })

    const result = await model.generateContent(`${contextStr}\nUSER: ${message}`)
    const raw = result.response.text().trim()

    let parsed: {
      message: string
      action?: { type: string; [key: string]: unknown }
      steps?: Array<{ delay: number; message: string; action: { type: string; [key: string]: unknown } }>
      insight?: string | null
    }

    try {
      const cleaned = raw.replace(/^```json\n?/, '').replace(/\n?```$/, '').trim()
      parsed = JSON.parse(cleaned)
    } catch {
      try {
        const match = raw.match(/\{[\s\S]*\}/)
        if (match) parsed = JSON.parse(match[0])
        else throw new Error('no JSON')
      } catch {
        parsed = { message: raw.slice(0, 300), action: { type: 'none' }, insight: null }
      }
    }

    return NextResponse.json(parsed)
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Unexpected error'
    return NextResponse.json({ error: message }, { status: 500 })
  }
}
