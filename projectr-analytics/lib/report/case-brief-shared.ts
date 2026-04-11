/**
 * Shared Gemini JSON generation for case-study briefs (JSON API + PDF export).
 */
import { GoogleGenerativeAI } from '@google/generative-ai'
import { GEMINI_NO_EM_DASH_RULE } from '@/lib/gemini-text-rules'

export interface CaseBriefSitePayload {
  address: string
  zone: string
  score: number
  air_rights_sqft: number
  far_utilization: number
  zori_growth: number | null
  momentum: number | null
}

export const CASE_BRIEF_SYSTEM_PROMPT = `You are a senior real estate investment analyst at Projectr Analytics.
The user ran a geospatial case study in the dashboard; you receive their original brief, optional agent lead copy, ranked sites with metrics, and current map/market context.

Return ONLY valid JSON (no markdown) matching this shape:
{
  "title": "Case study brief - [short topic]",
  "headline": "One-line outcome (e.g. Top 5 sites ranked for …)",
  "marketLine": "Geography + submarket context in 1–2 sentences.",
  "executiveSummary": "4–6 sentences: restate the mandate, summarize how the spatial model ranked sites (FAR headroom, permit momentum, rent growth), what ties #1–#5 together, and how an IC should use the list.",
  "keyFindings": [
    {
      "title": "Punchy headline, ≤12 words (e.g. site name + hook)",
      "body": "2–3 sentences with explicit numbers from RANKED SITES (scores, air_rights_sqft, far_utilization_pct, nearby_permit_momentum, zori_growth_pct, zones).",
      "stats": [ { "label": "Short metric label", "value": "e.g. 8.4M sqft or 51%" } ]
    }
  ],
  "investmentThesis": "One dense paragraph: why these locations fit a development/acquisition thesis for this brief.",
  "signalTiles": [
    { "label": "Rent / demand", "body": "2–3 sentences with ZORI/ZHVI/vacancy from context if present." },
    { "label": "Development momentum", "body": "2–3 sentences on construction pipeline / permits narrative." },
    { "label": "Site quality / zoning", "body": "2–3 sentences on parcel quality, FAR, zoning hooks." },
    { "label": "Risks / macro", "body": "2–3 sentences on macro, regulatory, or execution risks." }
  ],
  "sites": [
    {
      "rank": 1,
      "address": "exact from input",
      "scoreRationale": "4–6 sentences: integrate model score, FAR utilization, air rights, zone, ZORI growth, permit momentum; compare briefly to peers in the list.",
      "watchItems": "Diligence flags: entitlements, infrastructure, comps, lease-up - or \"None flagged\"."
    }
  ],
  "risksAndMitigations": [
    { "risk": "Short risk title", "mitigation": "How to underwrite or hedge it." }
  ],
  "recommendedNextSteps": [ "4–6 actionable steps for acquisitions / design / community / capital." ],
  "assumptionsAndLimits": "2–4 sentences: data vintage, NYC-only PLUTO/DOB scope, model simplifications, what would change with better data.",
  "methodology": "2 short paragraphs: (1) scoring inputs and weights at a high level, (2) what the model does NOT optimize for.",
  "footer": "Projectr Analytics · Data: Zillow (ZORI/ZHVI), NYC PLUTO, NYC DOB permits where applicable."
}

Rules:
- signalTiles: exactly 4 items; keep the four themes above (adjust labels slightly if needed).
- sites: one object per ranked site in input order; ranks 1..n; watchItems required string (can be brief).
- risksAndMitigations: 3–5 pairs; recommendedNextSteps: 4–6 strings; keyFindings: 3–5 objects (title + body required); stats: 0–3 label/value pairs per finding drawn from site data (omit stats if none apply).
- Use only facts supported by the JSON context; if a metric is null, say unavailable rather than inventing.
- Tone: institutional IC memo - dense but readable; no fluff.
- ${GEMINI_NO_EM_DASH_RULE}`

export function buildCaseBriefUserPayload(input: {
  caseStudy: string
  agentSummary: string
  insight: string
  sites: CaseBriefSitePayload[]
  mapContext: Record<string, unknown>
}): string {
  const { caseStudy, agentSummary, insight, sites, mapContext: ctx } = input
  const sitesBlock = sites.map((s, i) => ({
    rank: i + 1,
    address: s.address,
    zone: s.zone,
    model_score: s.score,
    air_rights_sqft: s.air_rights_sqft,
    far_utilization_pct: Math.round(s.far_utilization * 1000) / 10,
    zori_growth_pct: s.zori_growth,
    nearby_permit_momentum: s.momentum,
  }))

  return `
ORIGINAL CASE STUDY (user):
${caseStudy || '(not captured - infer from sites and context only)'}

AGENT OPENING SUMMARY:
${agentSummary || '-'}

AGENT INSIGHT LINE:
${insight || '-'}

MAP / MARKET CONTEXT:
- Label: ${ctx.label ?? '-'}
- ZIP: ${ctx.zip ?? '-'}
- ZORI (display): ${ctx.zori != null ? '$' + Number(ctx.zori).toLocaleString() : '-'}
- ZHVI: ${ctx.zhvi != null ? '$' + Number(ctx.zhvi).toLocaleString() : '-'}
- ZORI YoY %: ${ctx.zoriGrowth ?? '-'}
- Vacancy %: ${ctx.vacancyRate ?? '-'}

RANKED SITES (authoritative - cite these addresses):
${JSON.stringify(sitesBlock, null, 2)}
`
}

export async function generateCaseBriefJson(input: {
  caseStudy: string
  agentSummary: string
  insight: string
  sites: CaseBriefSitePayload[]
  mapContext: Record<string, unknown>
}): Promise<{ brief: Record<string, unknown>; generatedAt: string }> {
  if (!input.caseStudy.trim() && input.sites.length === 0) {
    throw new Error('Missing case study or sites')
  }

  const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY!)
  const model = genAI.getGenerativeModel({
    model: 'gemini-2.5-flash',
    systemInstruction: CASE_BRIEF_SYSTEM_PROMPT,
    generationConfig: { responseMimeType: 'application/json' },
  })

  const userPayload = buildCaseBriefUserPayload(input)
  const result = await model.generateContent(userPayload)
  const raw = result.response.text().trim()
  const cleaned = raw.replace(/^```json\n?/, '').replace(/\n?```$/, '').trim()
  const parsed = JSON.parse(cleaned) as Record<string, unknown>

  return {
    brief: parsed,
    generatedAt: new Date().toISOString(),
  }
}
