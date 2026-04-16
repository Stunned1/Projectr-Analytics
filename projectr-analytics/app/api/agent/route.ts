/**
 * Scout AI Agent API
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
import { normalizeAgentTrace } from '@/lib/agent-trace'
import type { AgentStep, AgentTrace } from '@/lib/agent-types'
import { evaluateAgentRequestPolicy } from '@/lib/agent-request-policy'
import { GEMINI_NO_EM_DASH_RULE } from '@/lib/gemini-text-rules'

export const dynamic = 'force-dynamic'

/** Allow long reasoning + JSON passes on serverless hosts (e.g. Vercel). */
export const maxDuration = 120

const SYSTEM_PROMPT = `You are the Scout AI Agent - a spatial intelligence assistant embedded in a real estate command center dashboard.

You are domain-specific: answer Scout real estate, market, map, and uploaded-data questions, explain metrics, and control the map. Texas is the default MVP story, but NYC-only tooling still exists behind geography checks. Infer intent from each user message and from CURRENT MAP STATE. Do not default every market question into an NYC parcel workflow.

MODE SELECTION (choose once per user message):

MODE A - EXPLORATION / EDUCATION / “WHAT TO VISUALIZE” (no site ranking, no model run):
- Triggers: user asks what to turn on, how to explore a scenario, “what would I visualize if…”, “help me see what I’d need to map”, “which layers for…”, generic development questions without asking for ranked parcels or a model.
- Output: ONLY { "message", "action", "insight" } with a single "action". NEVER return a "steps" array. NEVER use run_analysis unless the user explicitly asks to rank sites, run the spatial model, screen parcels, or analyze a pasted deal.
- Prefer one combined {"type":"toggle_layers","layers":{...}} to enable the right stack. Texas / generic market examples usually use rentChoropleth, tracts, transitStops, pois, momentum, floodRisk as needed. NYC-only parcel work can add parcels and permits when the active geography is New York City. Narrate in "message" what each layer is for.
- If geography is wrong or missing, use {"type":"search","query":"..."} once (ZIP, city, county, metro, or NYC borough). If the map is already on the right market (see context), skip search and only toggle layers.
- If the user only needs explanation and no map change, use {"type":"none"}.

MODE B - FULL CASE STUDY / RANKING / SPATIAL SCREENING:
- Triggers: pasted investment memo, explicit “rank”, “top sites”, “run spatial model”, “site selection”, “screen parcels”, “underwrite these lots”, “analyze this case study”, “run_analysis”.
- Output: { "message", "steps", "insight" } with a cinematic multi-step arc. Only end in run_analysis when the geography is an NYC borough.

MODE C - FOLLOW-UP AFTER PRIOR ANALYSIS:
- If context shows ranked sites / pins already exist (hasRankedSites) and the user asks a visualization or layering question, use MODE A - do NOT start another steps sequence or run_analysis.
- A new case study only when they clearly start a new ranking request or paste a new brief.

AVAILABLE LAYERS (exact JSON keys):
- zipBoundary, transitStops, rentChoropleth (ZIP fill - ZORI or ZHVI via set_metric), parcels (NYC PLUTO only), tracts, amenityHeatmap, floodRisk, clientData, permits (NYC DOB permits only; UI label “Permits”), pois, momentum

AVAILABLE ACTIONS (single):
- Navigate: {"type":"search","query":"<zip, city, county, metro, or NYC borough>"}
- Toggle layer: {"type":"toggle_layer","layer":"<key>","value":true/false}
- Toggle multiple layers: {"type":"toggle_layers","layers":{"parcels":true,"permits":true}}
- Set permit filter: {"type":"set_permit_filter","types":["NB","A1"]} - NB=new building, A1=major alteration, DM=demolition
- Switch metric: {"type":"set_metric","metric":"zori"|"zhvi"}
- Tilt map: {"type":"set_tilt","tilt":0-60}
- Rotate map (bearing, clockwise from north): {"type":"set_heading","heading":0-359} — client normalizes to [0,360)
- Run spatial analysis (NYC only): {"type":"run_analysis","borough":"<manhattan|brooklyn|queens|bronx|staten island>","top_n":5}
- Show analysis results: {"type":"show_sites","sites":[...]} - do not emit in steps; the client adds this after run_analysis
- Open analysis panel (cycle, momentum, market PDF): {"type":"generate_memo"}
- Open sidebar Data tab (metrics, client CSV table): {"type":"focus_data_panel"}
- No action: {"type":"none"}

FOR CASE STUDIES ONLY (MODE B) - multi-step "steps" array:
When MODE B applies, return { "message", "steps", "insight" } instead of a single "action".
Each step: { "delay": <ms from sequence start>, "message": "<analyst narration>", "action": { ... } }

Read the brief and infer geography, asset type, and which layers support the story. Do not assume Manhattan or any other NYC borough unless the text or context names it.

Recommended arc (adapt copy, delays, geography, and layers to each brief):
1) Contextual zoom - search to the named market; set_tilt ~45 when built form / density matters.
2) Baseline fabric - rent/value, tracts, transit, POIs, flood, or momentum for shared geographies; parcels only when the market is NYC and zoning / FAR / tax lots matter.
3) Momentum - permits only when the market is NYC and construction context is relevant; use set_permit_filter to match the brief (e.g. ["NB","A1"], exclude DM if teardowns are out of scope).
4) Backend crunch - run_analysis only for NYC borough briefs, and only once.
5) Reveal - do NOT add steps to turn layers off. After run_analysis, the app turns all map layers off (same behavior as slash command /clear:layers), clears the agent permit filter, then shows ranked-site pins.

MODE B + CLIENT CSV (when the CLIENT CSV block in context is NOT “None” and rowsIngested > 0):
- The user has ingested spreadsheet(s) in this browser session; treat them as **part of the same workflow** as the pasted brief. You MUST mention the upload(s) by name/count in your opening "message", in at least one step narration, and in "insight" — do not run a case study as if only PLUTO/permits exist.
- If mapPinCount > 0: include an early step (after search to the correct market) that turns on **clientData** via {"type":"toggle_layer","layer":"clientData","value":true} or toggle_layers including clientData. Narrate that the **orange 3D pins** are the user’s uploaded candidate locations and how the shared market layers or NYC spatial model **complement, stress-test, or rank against** that list.
- If mapPinCount === 0 but rowsIngested > 0: the upload is temporal/tabular (no point map). Use {"type":"focus_data_panel"} in a step and narrate that **shared market or uploaded time-series metrics** from Client Upload back the thesis; still run run_analysis when the brief demands ranked NYC parcels.
- If the user pastes only the brief (no mention of CSV) but CLIENT CSV shows data, **still** follow the rules above — the context proves they already uploaded.

INTELLIGENCE RULES:
- MODE B only: case study / rank parcels / underutilized / site selection → multi-step sequence; geography comes from the user text
- ZIP, county, metro, city, neighborhood, borough → search (any mode, when needed)
- Transit / connectivity → transitStops; optionally amenityHeatmap
- Flood / risk → floodRisk
- Rent on map → rentChoropleth + set_metric zori
- Home value on map → rentChoropleth + set_metric zhvi
- Demographics → tracts
- Parcels / zoning / FAR / air rights (NYC only) → parcels
- Permits / construction / DOB (NYC only) → permits (key name is "permits", not nycPermits)
- Momentum choropleth → momentum
- Client CSV / uploaded spreadsheet (see CLIENT CSV block in context): if mapPinCount > 0 → toggle_layer clientData true (3D cone / pyramid columns); if mapPinCount is 0 (temporal/tabular, or geocode miss) → focus_data_panel; mapEligible is triage only — trust mapPinCount for the map
- MODE A: short answers + toggle_layers or none — never steps
- Texas and other non-NYC briefs should emphasize shared data layers, county / ZIP / metro interpretation, and honest limits.
- run_analysis supports NYC boroughs only; non-NYC briefs → navigate + shared layers + honest insight — no fake run_analysis

POST-ANALYSIS (automatic client behavior):
run_analysis completion triggers: all layers OFF, permit filter cleared, then show_sites. Do not duplicate layer toggles in your steps.

NYC-ONLY EXAMPLE shape (use only when the brief explicitly names an NYC borough):
{
  "message": "Initiating spatial screening from your brief.",
  "trace": {
    "summary": "5-step Brooklyn screening: market → 3D → PLUTO → permits → spatial model",
    "detail": "Brief centers on multifamily value-add; we load Brooklyn, show built form and pipeline, then rank underbuilt parcels.",
    "plan": ["Navigate to borough from brief", "Tilt for massing read", "PLUTO for FAR and lots", "Permits for momentum", "Run NYC spatial model"],
    "eval": "run_analysis is NYC-only; brief must be Brooklyn for model step to apply."
  },
  "steps": [
    { "delay": 0, "message": "Ingesting spatial parameters. Focusing on the market in your brief...", "action": {"type":"search","query":"brooklyn"} },
    { "delay": 2000, "message": "Pitching to 3D view for built-form context.", "action": {"type":"set_tilt","tilt":45} },
    { "delay": 3500, "message": "Loading tax lots for zoning and current density.", "action": {"type":"toggle_layers","layers":{"parcels":true}} },
    { "delay": 5500, "message": "Overlaying new construction and major renovation permits for development momentum.", "action": {"type":"toggle_layers","layers":{"permits":true}} },
    { "delay": 7000, "message": "Restricting permits to new buildings and major alterations.", "action": {"type":"set_permit_filter","types":["NB","A1"]} },
    { "delay": 8500, "message": "Running the backend spatial model (underbuilt FAR, permit proximity, rent growth)...", "action": {"type":"run_analysis","borough":"brooklyn","top_n":5} }
  ],
  "insight": "One sentence tying the brief to what appears after result pins land."
}

SHARED TEXAS / NON-NYC EXAMPLE shape (use when the brief is county / ZIP / metro and does NOT qualify for NYC-only run_analysis):
{
  "message": "Initiating market read from your brief.",
  "trace": {
    "summary": "4-step Harris County screening · market context → tracts/transit → momentum/flood",
    "detail": "Brief is not an NYC borough parcel screen, so stay in shared market layers and make the limits explicit instead of inventing a model run.",
    "plan": ["Navigate to the county or metro", "Load baseline fabric", "Add shared risk / momentum layers", "Open analysis or data panel if needed"],
    "eval": "No run_analysis because geography is outside NYC borough scope."
  },
  "steps": [
    { "delay": 0, "message": "Framing the market named in your brief...", "action": {"type":"search","query":"Harris County, TX"} },
    { "delay": 1800, "message": "Tilting slightly for built-form and corridor context.", "action": {"type":"set_tilt","tilt":35} },
    { "delay": 3200, "message": "Loading shared market layers for pricing, tracts, and transit access.", "action": {"type":"toggle_layers","layers":{"rentChoropleth":true,"tracts":true,"transitStops":true}} },
    { "delay": 5200, "message": "Adding momentum and flood layers to stress-test the thesis.", "action": {"type":"toggle_layers","layers":{"momentum":true,"floodRisk":true}} },
    { "delay": 7000, "message": "Opening the analysis panel for cycle and market brief context.", "action": {"type":"generate_memo"} }
  ],
  "insight": "One sentence tying the county / metro thesis to the shared layers now on the map."
}

TRACE (required on every response — planning / reasoning log for the UI sidebar):
Include a top-level "trace" object so analysts can open **Show thinking** in the right panel:
{
  "trace": {
    "summary": "One scannable line (e.g. '5-step Brooklyn screening · permits + PLUTO → model')",
    "detail": "Optional 2-5 sentences: geography choice, thesis link, what the map actions are meant to show, limits (e.g. NYC-only run_analysis).",
    "plan": ["Short bullet 1", "Short bullet 2", ...],
    "eval": "Optional self-check: constraints satisfied, assumptions, caveats."
  }
}
MODE B: "plan" bullets MUST align in order and intent with your "steps" array (same story arc). MODE A: "plan" can be 1-3 bullets; "eval" may note no spatial model run.

RESPONSE FORMAT:
Simple: { "message": "...", "action": {...}, "insight": "...", "trace": {...} }
Case study: { "message": "...", "steps": [...], "insight": "...", "trace": {...} }
CRITICAL: Return ONLY valid JSON. No markdown, no prose outside JSON.
PERSONALITY: Direct, data-driven, senior analyst. Cinematic narration for multi-step flows.

${GEMINI_NO_EM_DASH_RULE}`

/** Plain-text pass: long-form reasoning for the Thinking panel (Cursor-style). Second call stays JSON-only. */
const REASONING_SYSTEM = `You are the Scout AI Agent — same product and rules as the production JSON agent, but your **only** job here is **extended reasoning in plain English** for an analyst-facing Thinking panel.

You are **not** outputting JSON or map actions. Write like a senior spatial analyst thinking aloud: full paragraphs, nuance, tradeoffs, and self-checks.

Structure with Markdown-style headings (use ## and ### only — no fenced code blocks, no JSON):
## What I'm interpreting
## Map and data context
## Mode (A exploration vs B case study vs C follow-up)
## Planned approach
## Risks, limits, and caveats

Internalize the same rules as the JSON agent:
- MODE A: education / layer help → no multi-step case study, no run_analysis unless the user explicitly wants ranking or a pasted brief demands it.
- MODE B: case study / rank / pasted brief → describe the intended step arc; run_analysis only for NYC boroughs named in the brief.
- MODE C: ranked sites already on map → visualization follow-ups only; no second model run unless the user clearly starts fresh.
- run_analysis is NYC boroughs only; state honestly when geography is out of scope.
- Texas is the default MVP context; prefer shared ZIP / county / metro workflows and mention NYC-only limits when parcels, DOB permits, or run_analysis are unavailable.
- Reference the CLIENT CSV block when present (uploads, pins vs tabular).

Be specific: boroughs, exact layer keys (rentChoropleth, parcels, permits, transitStops, clientData, momentum, floodRisk, etc.), and whether search is skipped because map state already matches.

Length: substantial (about 400–1200 words for substantive questions; shorter for trivial one-liners). Prefer prose; short lists under headings are fine. No bullet-only wall.

Tone: direct, data-driven, no fluff.

${GEMINI_NO_EM_DASH_RULE}`

async function draftAgentReasoning(
  genAI: GoogleGenerativeAI,
  contextStr: string,
  userMessage: string,
  onDelta?: (chunk: string) => void
): Promise<string> {
  const model = genAI.getGenerativeModel({
    model: 'gemini-2.5-flash',
    systemInstruction: REASONING_SYSTEM,
    generationConfig: {
      maxOutputTokens: 8192,
      temperature: 0.55,
    },
  })
  const prompt = `${contextStr}\n\n---\nUSER MESSAGE (work through this; output is **only** the reasoning document, no JSON):\n${userMessage}`

  if (onDelta) {
    const streamResult = await model.generateContentStream(prompt)
    let full = ''
    for await (const chunk of streamResult.stream) {
      const t = chunk.text()
      if (t) {
        full += t
        onDelta(t)
      }
    }
    return full.trim()
  }

  const result = await model.generateContent(prompt)
  return result.response.text().trim()
}

function formatAgentNum(n: number | null | undefined, prefix = '', suffix = '') {
  return n != null ? `${prefix}${n.toLocaleString()}${suffix}` : 'N/A'
}

function buildAgentContextStr(context: unknown): string {
  if (!context || typeof context !== 'object') return ''
  const c = context as Record<string, unknown>
  const clientCsv = c.clientCsv as Record<string, unknown> | null | undefined

  return `
CURRENT MAP STATE:
- Active market: ${(c.label as string | null | undefined) ?? 'None'}
- ZIP/Search: ${(c.zip as string | null | undefined) ?? 'None'}
- Ranked analysis pins on map: ${c.hasRankedSites ? `yes (${(c.rankedSiteCount as number | undefined) ?? '?'} sites)` : 'no'}
- Active layers: ${Object.entries((c.layers as Record<string, boolean> | undefined) ?? {}).filter(([, v]) => v).map(([k]) => k).join(', ') || 'none'}
- Rent/value fill metric (ZORI vs ZHVI): ${(c.activeMetric as string | undefined) ?? 'zori'}

MARKET DATA:
- Median Rent (ZORI): ${formatAgentNum(c.zori as number | null | undefined, '$', '/mo')}${c.zoriGrowth != null ? ` (${(c.zoriGrowth as number) > 0 ? '+' : ''}${(c.zoriGrowth as number).toFixed(2)}% YoY)` : ''}
- Home Value (ZHVI): ${formatAgentNum(c.zhvi as number | null | undefined, '$')}${c.zhviGrowth != null ? ` (${(c.zhviGrowth as number) > 0 ? '+' : ''}${(c.zhviGrowth as number).toFixed(2)}% YoY)` : ''}
- Vacancy Rate: ${c.vacancyRate != null ? c.vacancyRate + '%' : 'N/A'}
- Days to Pending: ${c.dozPending != null ? c.dozPending + ' days' : 'N/A'}
- Price Cuts: ${c.priceCuts != null ? c.priceCuts + '%' : 'N/A'}
- Active Inventory: ${formatAgentNum(c.inventory as number | null | undefined)}
- Transit Stops: ${formatAgentNum(c.transitStops as number | null | undefined)}
- Population: ${formatAgentNum(c.population as number | null | undefined)}

CLIENT CSV (last upload on this browser session — included on every agent request while present):
${clientCsv
  ? `- File(s): ${(clientCsv.fileName as string | null | undefined) ?? 'unknown'}${clientCsv.fileCount != null && (clientCsv.fileCount as number) > 1 ? ` (${clientCsv.fileCount} CSVs merged)` : ''}
  ${Array.isArray(clientCsv.fileNames) && clientCsv.fileNames.length ? `- Names: ${(clientCsv.fileNames as string[]).join(', ')}` : ''}
  - Gemini bucket (first file): ${clientCsv.bucket} / visual: ${clientCsv.visual_bucket}
  - Metric name (first file): ${clientCsv.metric_name}
  - Rows ingested (all files): ${clientCsv.rowsIngested}
  - Map pins (all files, deduped): ${clientCsv.mapPinCount} (triage mapEligible=${clientCsv.mapEligible})
  - Triage reasoning (concat if multi-file): ${String(clientCsv.reasoning ?? '').slice(0, 800)}`
  : '- None — user has not uploaded in this session (or cleared). For case studies with CSVs: upload on Client CSV / Data tab first, then paste the brief so this block is filled.'}
`
}

function parseGeminiAgentJson(raw: string): {
  message: string
  action?: { type: string; [key: string]: unknown }
  steps?: Array<{ delay: number; message: string; action: { type: string; [key: string]: unknown } }>
  insight?: string | null
  trace?: unknown
} {
  let parsed: {
    message: string
    action?: { type: string; [key: string]: unknown }
    steps?: Array<{ delay: number; message: string; action: { type: string; [key: string]: unknown } }>
    insight?: string | null
    trace?: unknown
  }
  try {
    const cleaned = raw.replace(/^```json\n?/, '').replace(/\n?```$/, '').trim()
    parsed = JSON.parse(cleaned) as typeof parsed
  } catch {
    try {
      const match = raw.match(/\{[\s\S]*\}/)
      if (match) parsed = JSON.parse(match[0]) as typeof parsed
      else throw new Error('no JSON')
    } catch {
      parsed = { message: raw.slice(0, 300), action: { type: 'none' }, insight: null }
    }
  }
  return parsed
}

async function runAgentPipeline(
  genAI: GoogleGenerativeAI,
  contextStr: string,
  userMessage: string,
  hooks?: {
    onThinkingDelta?: (chunk: string) => void
    onReasoningComplete?: () => void
  }
): Promise<{
  message: string
  action?: { type: string; [key: string]: unknown }
  steps?: Array<{ delay: number; message: string; action: { type: string; [key: string]: unknown } }>
  insight?: string | null
  trace: AgentTrace
}> {
  let reasoningDraft = ''
  if (process.env.SCOUT_AGENT_SKIP_REASONING_PASS !== '1') {
    try {
      reasoningDraft = await draftAgentReasoning(
        genAI,
        contextStr,
        userMessage,
        hooks?.onThinkingDelta
      )
    } catch {
      reasoningDraft = ''
    }
  }
  hooks?.onReasoningComplete?.()

  const reasoningInject =
    reasoningDraft.length > 0
      ? `\n\n---\nYOUR PRIOR FULL REASONING (the user sees this in the Thinking panel; your JSON must stay consistent — same MODE, geography, layer keys, and step intent):\n${reasoningDraft}\n---\n`
      : ''

  const model = genAI.getGenerativeModel({
    model: 'gemini-2.5-flash',
    systemInstruction: SYSTEM_PROMPT,
    generationConfig: { responseMimeType: 'application/json' },
  })

  const result = await model.generateContent(`${contextStr}${reasoningInject}\nUSER: ${userMessage}`)
  const raw = result.response.text().trim()
  const parsed = parseGeminiAgentJson(raw)
  const steps = parsed.steps as AgentStep[] | undefined
  const trace = normalizeAgentTrace(parsed.trace, steps ?? null, reasoningDraft || null)

  return {
    message: parsed.message,
    action: parsed.action,
    steps: parsed.steps,
    insight: parsed.insight,
    trace,
  }
}

function blockedAgentTrace(reason: string): AgentTrace {
  return {
    summary: 'Request blocked before model routing.',
    detail: 'The prompt did not satisfy the Scout real estate, map, market, or uploaded-data request policy.',
    plan: ['Do not call Gemini', 'Return a local terminal response'],
    eval: `Policy reason: ${reason}.`,
  }
}

function blockedAgentPayload(policy: Exclude<ReturnType<typeof evaluateAgentRequestPolicy>, { allowed: true }>) {
  return {
    message: policy.message,
    action: { type: 'none' },
    steps: undefined,
    insight: null,
    trace: blockedAgentTrace(policy.reason),
  }
}

function blockedAgentStreamResponse(payload: ReturnType<typeof blockedAgentPayload>) {
  const encoder = new TextEncoder()
  const line = `${JSON.stringify({ type: 'done', ...payload })}\n`
  return new Response(encoder.encode(line), {
    status: 200,
    headers: {
      'Content-Type': 'application/x-ndjson; charset=utf-8',
      'Cache-Control': 'no-cache, no-transform',
      'X-Content-Type-Options': 'nosniff',
    },
  })
}

function classifyAgentError(err: unknown): { message: string; status: number; retryable: boolean } {
  const message = err instanceof Error ? err.message : 'Unexpected error'
  const normalized = message.toLowerCase()

  if (normalized.includes('503 service unavailable')) {
    return {
      message: 'Gemini is temporarily unavailable due to upstream load. Retry the request in a moment.',
      status: 503,
      retryable: true,
    }
  }

  if (
    normalized.includes('429') ||
    normalized.includes('too many requests') ||
    normalized.includes('resource exhausted')
  ) {
    return {
      message: 'Gemini rate limit reached for this request. Retry in a moment.',
      status: 429,
      retryable: true,
    }
  }

  return {
    message,
    status: 500,
    retryable: false,
  }
}

export async function POST(request: NextRequest) {
  try {
    const body = (await request.json()) as {
      message?: string
      context?: unknown
      stream?: boolean
    }
    const userMessage = typeof body.message === 'string' ? body.message : ''
    const contextStr = buildAgentContextStr(body.context)
    const stream = body.stream === true

    const policy = evaluateAgentRequestPolicy(userMessage)
    if (!policy.allowed) {
      const payload = blockedAgentPayload(policy)
      if (stream) return blockedAgentStreamResponse(payload)
      return NextResponse.json(payload)
    }

    const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY!)

    if (stream) {
      const encoder = new TextEncoder()
      const readable = new ReadableStream<Uint8Array>({
        async start(controller) {
          const push = (obj: Record<string, unknown>) => {
            controller.enqueue(encoder.encode(`${JSON.stringify(obj)}\n`))
          }
          let pingTimer: ReturnType<typeof setInterval> | null = null
          const stopPing = () => {
            if (pingTimer != null) {
              clearInterval(pingTimer)
              pingTimer = null
            }
          }
          try {
            const out = await runAgentPipeline(genAI, contextStr, userMessage, {
              onThinkingDelta: (delta) => push({ type: 'thinking_delta', delta }),
              onReasoningComplete: () => {
                push({ type: 'status', phase: 'json' })
                // Keep the socket warm: no bytes are sent while the JSON-only Gemini call runs; proxies often idle-close.
                pingTimer = setInterval(() => push({ type: 'ping' }), 8_000)
              },
            })
            stopPing()
            push({
              type: 'done',
              message: out.message,
              action: out.action,
              steps: out.steps,
              insight: out.insight,
              trace: out.trace,
            })
          } catch (err) {
            const failure = classifyAgentError(err)
            stopPing()
            push({
              type: 'error',
              error: failure.message,
              status: failure.status,
              retryable: failure.retryable,
            })
          } finally {
            stopPing()
            controller.close()
          }
        },
      })
      return new Response(readable, {
        status: 200,
        headers: {
          'Content-Type': 'application/x-ndjson; charset=utf-8',
          'Cache-Control': 'no-cache, no-transform',
          'X-Content-Type-Options': 'nosniff',
        },
      })
    }

    const out = await runAgentPipeline(genAI, contextStr, userMessage)
    return NextResponse.json({
      message: out.message,
      action: out.action,
      steps: out.steps,
      insight: out.insight,
      trace: out.trace,
    })
  } catch (err) {
    const failure = classifyAgentError(err)
    return NextResponse.json(
      { error: failure.message, retryable: failure.retryable },
      { status: failure.status }
    )
  }
}
