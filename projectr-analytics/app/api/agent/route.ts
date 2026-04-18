/**
 * Scout EDA Assistant API
 * Returns a concise analyst-facing response grounded in the current market or imported dataset context.
 */
import { type NextRequest, NextResponse } from 'next/server'
import { GoogleGenerativeAI } from '@google/generative-ai'
import { normalizeAgentTrace } from '@/lib/agent-trace'
import type {
  AgentAction,
  AgentHistoryMetric,
  AgentHistorySubject,
  AgentHistoryTimeWindow,
  AgentStep,
  AgentTrace,
  MapContext,
} from '@/lib/agent-types'
import { classifyAgentRequestIntent, looksAnalyticalPrompt } from '@/lib/agent-intent'
import {
  humanizeLayerKey,
  inferDirectMapControl,
  MAP_CONTROL_LAYER_KEYS,
  normalizeMapSearchQuery,
} from '@/lib/agent-map-control'
import { buildEdaContextString, buildFallbackEdaResponse, inferEdaTaskType } from '@/lib/eda-assistant'
import { evaluateAgentRequestPolicy } from '@/lib/agent-request-policy'
import { GEMINI_NO_EM_DASH_RULE } from '@/lib/gemini-text-rules'
import { buildCountyAreaKey, buildMetroAreaKey, normalizeCountyDisplayName, normalizeMetroDisplayName } from '@/lib/area-keys'
import { normalizeScoutChartOutput, type ScoutChartOutput } from '@/lib/scout-chart-output'
import type { AnalyticalComparisonRequest, AnalyticalComparisonResult } from '@/lib/data/market-data-router'
import type { MasterDataRow } from '@/lib/data/types'
import { normalizeUsStateToAbbr, splitTrailingUsState } from '@/lib/us-state-abbr'

export const dynamic = 'force-dynamic'
export const maxDuration = 60

const SYSTEM_PROMPT = `You are Scout's EDA Assistant.

PRODUCT BOUNDARY:
- Your job is exploratory data analysis for the currently loaded market context and imported datasets.
- You may summarize datasets, describe distributions, detect outliers, compare visible segments, compare loaded geographies when context supports it, explain trend changes, explain metrics, and flag data-quality issues.
- Every claim must be grounded in the provided workspace evidence.
- Keep responses short, high-signal, and analyst-friendly.

STRICT NON-GOALS:
- No investment advice, development strategy, site recommendations, or open-ended market theses.
- No autonomous workflow planning.
- No map control instructions, layer orchestration, parcel screening, or run_analysis behavior.
- If evidence is weak or context is missing, say so plainly.

OUTPUT CONTRACT:
Return valid JSON only:
{
  "message": "2-4 sentences, concise and evidence-backed",
  "trace": {
    "summary": "one-line description of the EDA task",
    "taskType": "summarize_dataset|describe_distribution|detect_outliers|compare_segments|compare_geographies|compare_periods|spot_trends|check_data_quality|explain_metric",
    "methodology": "plain-language explanation of what evidence was used",
    "keyFindings": ["finding 1", "finding 2"],
    "evidence": ["metric or row evidence", "metric or row evidence"],
    "caveats": ["constraint or weak-evidence note"],
    "nextQuestions": ["good next EDA question"]
  }
}

STYLE RULES:
- Plain language only.
- No markdown.
- No prose outside JSON.
- Do not invent rows, metrics, benchmarks, or causal claims.

${GEMINI_NO_EM_DASH_RULE}`

const MAP_CONTROL_SYSTEM_PROMPT = `You are Scout's direct map-control interpreter for natural-language Scout terminal prompts.

Your job is to extract the intended UI control plan from a prompt that Scout already classified as direct map control.

SUPPORTED ACTIONS:
- search
- toggle_layers
- set_tilt
- focus_data_panel
- generate_memo
- none

SUPPORTED LAYER KEYS:
- ${MAP_CONTROL_LAYER_KEYS.join('\n- ')}

RULES:
- Interpret natural-language phrasing semantically. Ignore filler such as "please", "can you", or "let's".
- You may return either one direct action or an ordered "steps" array with up to 3 actions.
- Prefer "search" when the user is clearly asking to navigate to a geography or market.
- If the prompt combines navigation with another direct map action, return both steps in order. Search should come first.
- If the prompt combines map control and analysis, extract only the direct map-control action(s) and ignore the analysis clause.
- Do not invent geography names, layers, or parameters.
- Use "none" if confidence is below 0.6 or the prompt is too ambiguous.
- For toggle_layers, return a JSON object whose keys are layer keys and whose values are booleans.
- For set_tilt, return a tilt from 0 to 60.
- Keep step messages short and user-facing.

OUTPUT CONTRACT:
Return valid JSON only:
{
  "message": "short user-facing summary",
  "actionType": "search|toggle_layers|set_tilt|focus_data_panel|generate_memo|none",
  "searchQuery": "string or null",
  "layers": { "transitStops": true },
  "tilt": 45,
  "steps": [
    {
      "message": "Navigating to Dallas, TX.",
      "actionType": "search",
      "searchQuery": "Dallas, TX"
    },
    {
      "message": "Turning on permits.",
      "actionType": "toggle_layers",
      "layers": { "permits": true }
    }
  ],
  "confidence": 0.0,
  "reason": "short explanation"
}

${GEMINI_NO_EM_DASH_RULE}`

type AgentJsonResponse = {
  message: string
  trace?: unknown
  chart?: unknown
}

type MapControlActionJson = {
  actionType?: unknown
  searchQuery?: unknown
  layers?: unknown
  tilt?: unknown
  message?: unknown
}

type MapControlPlanJson = MapControlActionJson & {
  steps?: unknown
  confidence?: unknown
  reason?: unknown
}

function parseGeminiAgentJson(raw: string): AgentJsonResponse {
  try {
    const cleaned = raw.replace(/^```json\s*/i, '').replace(/\s*```$/i, '').trim()
    return JSON.parse(cleaned) as AgentJsonResponse
  } catch {
    try {
      const match = raw.match(/\{[\s\S]*\}/)
      if (match) return JSON.parse(match[0]) as AgentJsonResponse
    } catch {
      /* ignore */
    }
  }

  return { message: raw.trim() || 'Unable to interpret the current workspace context.' }
}

function parseMapControlPlanJson(raw: string): MapControlPlanJson {
  try {
    const cleaned = raw.replace(/^```json\s*/i, '').replace(/\s*```$/i, '').trim()
    return JSON.parse(cleaned) as MapControlPlanJson
  } catch {
    try {
      const match = raw.match(/\{[\s\S]*\}/)
      if (match) return JSON.parse(match[0]) as MapControlPlanJson
    } catch {
      /* ignore */
    }
  }

  return {}
}

function getGeminiJsonModel(systemInstruction: string) {
  return new GoogleGenerativeAI(process.env.GEMINI_API_KEY!).getGenerativeModel({
    model: 'gemini-2.5-flash',
    systemInstruction,
    generationConfig: { responseMimeType: 'application/json' },
  })
}

function mergeTrace(primary: AgentTrace, fallback: AgentTrace): AgentTrace {
  return {
    summary: primary.summary || fallback.summary,
    taskType: primary.taskType ?? fallback.taskType,
    methodology: primary.methodology ?? fallback.methodology,
    keyFindings: primary.keyFindings?.length ? primary.keyFindings : fallback.keyFindings,
    evidence: primary.evidence?.length ? primary.evidence : fallback.evidence,
    caveats: primary.caveats?.length ? primary.caveats : fallback.caveats,
    nextQuestions: primary.nextQuestions?.length ? primary.nextQuestions : fallback.nextQuestions,
    thinking: primary.thinking ?? fallback.thinking,
    detail: primary.detail ?? fallback.detail,
    plan: primary.plan?.length ? primary.plan : fallback.plan,
    eval: primary.eval ?? fallback.eval,
    executionSteps: primary.executionSteps?.length ? primary.executionSteps : fallback.executionSteps,
    toolCalls: primary.toolCalls?.length ? primary.toolCalls : fallback.toolCalls,
  }
}

function buildHybridMapAnalysisTrace(summary: string, findings: string[], caveats: string[], nextQuestions: string[]): AgentTrace {
  return {
    summary,
    taskType: 'summarize_dataset',
    methodology: 'Matched the prompt as a hybrid of explicit map control and workspace-grounded analysis, then sequenced the response without using open-ended planning.',
    keyFindings: findings,
    evidence: ['The prompt included an explicit navigation or map-control command plus an analytical follow-up request.'],
    caveats,
    nextQuestions,
  }
}

function normalizeLayerRecord(value: unknown): Record<string, boolean> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return {}

  return Object.fromEntries(
    Object.entries(value)
      .filter(([key, enabled]) => MAP_CONTROL_LAYER_KEYS.includes(key) && typeof enabled === 'boolean')
  )
}

type NormalizedMapControlStep = {
  message: string
  action: AgentAction
  summary: string
}

type AgentPipelineResult = {
  message: string
  action?: AgentAction
  steps?: AgentStep[]
  trace: AgentTrace
  chart?: ScoutChartOutput | null
}

type MetricSeriesFetcher = (args: {
  submarketId: string
  metricName: string
  startDate: string
  dataSource?: string | readonly string[]
  limit?: number
}) => Promise<MasterDataRow[]>

type ZoriMonthlyFetcher = (zip: string, maxMonths?: number) => Promise<Array<{ date: string; value: number }>>

type RouterChartIntent = {
  metricName: string
  dataSource: string | readonly string[]
  titleMetric: string
  yAxisLabel: string
}

function inferRouterChartIntent(userMessage: string): RouterChartIntent | null {
  const prompt = userMessage.toLowerCase()
  const wantsTrend = /\b(trend|over time|history|timeline)\b/.test(prompt)
  if (!wantsTrend) return null

  if (/\bunemployment|employment|labor\b/.test(prompt)) {
    return {
      metricName: 'Unemployment_Rate',
      dataSource: 'FRED',
      titleMetric: 'unemployment',
      yAxisLabel: 'Unemployment rate',
    }
  }

  if (/\bpermit|permits|construction\b/.test(prompt)) {
    return {
      metricName: 'Permit_Units',
      dataSource: 'Census BPS',
      titleMetric: 'permits',
      yAxisLabel: 'Permit units',
    }
  }

  return null
}

function wantsRentTrend(userMessage: string): boolean {
  const prompt = userMessage.toLowerCase()
  return /\b(trend|over time|history|timeline)\b/.test(prompt) && /\b(rent|rents|zori)\b/.test(prompt)
}

async function defaultMetricSeriesFetcher(args: {
  submarketId: string
  metricName: string
  startDate: string
  dataSource?: string | readonly string[]
  limit?: number
}) {
  const { getMetricSeries } = await import('@/lib/data/market-data-router')
  return getMetricSeries(args)
}

async function defaultZoriMonthlyFetcher(zip: string, maxMonths = 24) {
  const { fetchZoriMonthlyForZip } = await import('@/lib/report/fetch-zori-series')
  return fetchZoriMonthlyForZip(zip, maxMonths)
}

async function buildRentTrendChart(
  userMessage: string,
  context: MapContext | null,
  fetchZoriMonthly: ZoriMonthlyFetcher = defaultZoriMonthlyFetcher
): Promise<ScoutChartOutput | null> {
  const zip = context?.zip?.trim()
  if (!zip || !wantsRentTrend(userMessage)) return null

  const series = await fetchZoriMonthly(zip, 24)
  if (series.length < 2) return null

  const label = context?.label ?? zip

  return normalizeScoutChartOutput({
    kind: 'line',
    title: `${label} rent trend`,
    subtitle: 'Monthly Zillow Research history',
    summary: 'Grounded rent history from the persisted Zillow monthly series.',
    placeholder: false,
    confidenceLabel: 'zillow monthly history',
    xAxis: { key: 'period', label: 'Period' },
    yAxis: { label: 'ZORI', valueFormat: 'currency' },
    series: [
      {
        key: 'zori',
        label: 'ZORI',
        color: '#D76B3D',
        points: series.map((point) => ({ x: point.date, y: point.value })),
      },
    ],
    citations: [
      {
        id: `zori-monthly-${zip}`,
        label: 'Zillow Research',
        sourceType: 'internal_dataset',
        scope: zip,
        note: 'Monthly ZORI series from zillow_zori_monthly.',
        periodLabel: `${series[0]!.date} to ${series[series.length - 1]!.date}`,
      },
    ],
  })
}

export async function buildRentTrendChartForTest(
  userMessage: string,
  context: MapContext | null,
  fetchZoriMonthly: ZoriMonthlyFetcher
) {
  return buildRentTrendChart(userMessage, context, fetchZoriMonthly)
}

async function buildRouterBackedChart(
  userMessage: string,
  context: MapContext | null,
  fetchMetricSeries: MetricSeriesFetcher = defaultMetricSeriesFetcher
): Promise<ScoutChartOutput | null> {
  const intent = inferRouterChartIntent(userMessage)
  const submarketId = context?.zip?.trim()
  if (!intent || !submarketId) return null

  const rows = await fetchMetricSeries({
    submarketId,
    metricName: intent.metricName,
    dataSource: intent.dataSource,
    startDate: '2024-01-01',
    limit: 60,
  })

  const points = rows
    .filter((row) => row.time_period && row.metric_value != null)
    .map((row) => ({
      x: row.time_period!.slice(0, 7),
      y: row.metric_value as number,
      source: row.data_source,
    }))

  if (points.length < 2) return null

  const sourceLabel = points[0]?.source ?? (Array.isArray(intent.dataSource) ? intent.dataSource[0] : intent.dataSource)
  const label = context?.label ?? submarketId

  return normalizeScoutChartOutput({
    kind: 'line',
    title: `${label} ${intent.titleMetric} trend`,
    subtitle: 'Historical series from the shared market-data router',
    summary: `Grounded ${intent.titleMetric} history for the active ZIP from the shared analytical read path.`,
    placeholder: false,
    confidenceLabel: 'router-backed series',
    xAxis: { key: 'period', label: 'Period' },
    yAxis: {
      label: intent.yAxisLabel,
      valueFormat: intent.metricName === 'Unemployment_Rate' ? 'percent' : 'number',
    },
    series: [
      {
        key: intent.metricName,
        label: intent.yAxisLabel,
        color: '#D76B3D',
        points: points.map(({ x, y }) => ({ x, y })),
      },
    ],
    citations: [
      {
        id: `${intent.metricName.toLowerCase()}-${submarketId}`,
        label: sourceLabel,
        sourceType: 'internal_dataset',
        scope: submarketId,
        note: `${intent.metricName} returned through market-data-router.`,
        periodLabel: `${points[0]!.x} to ${points[points.length - 1]!.x}`,
      },
    ],
  })
}

export async function buildRouterBackedChartForTest(
  userMessage: string,
  context: MapContext | null,
  fetchMetricSeries: MetricSeriesFetcher
) {
  return buildRouterBackedChart(userMessage, context, fetchMetricSeries)
}

type HistoryComparisonDependencies = {
  getAnalyticalComparison?: (request: AnalyticalComparisonRequest) => Promise<AnalyticalComparisonResult>
}

const HISTORY_METRIC_CONFIG: Record<
  AgentHistoryMetric,
  {
    aliases: RegExp[]
    defaultWindow: AgentHistoryTimeWindow
    chartKind: 'line' | 'bar'
    valueFormat: 'currency' | 'percent' | 'number'
  }
> = {
  rent: {
    aliases: [/\brent\b/i, /\bzori\b/i, /\brental\b/i],
    defaultWindow: { mode: 'relative', unit: 'months', value: 24 },
    chartKind: 'line',
    valueFormat: 'currency',
  },
  unemployment_rate: {
    aliases: [/\bunemployment\b/i, /\bjobless\b/i, /\blabor\b/i, /\bemployment rate\b/i],
    defaultWindow: { mode: 'relative', unit: 'months', value: 24 },
    chartKind: 'line',
    valueFormat: 'percent',
  },
  permit_units: {
    aliases: [/\bpermit\b/i, /\bpermits\b/i, /\bconstruction\b/i, /\bbuilding permits?\b/i],
    defaultWindow: { mode: 'relative', unit: 'years', value: 5 },
    chartKind: 'bar',
    valueFormat: 'number',
  },
}

function hasHistoryIntent(userMessage: string): boolean {
  return /\b(history|trend|trends|timeline|over time|time series|changed|change)\b/i.test(userMessage)
}

function detectHistoryMetric(userMessage: string): AgentHistoryMetric | null {
  const prompt = userMessage.toLowerCase()
  if (!hasHistoryIntent(prompt)) return null

  for (const [metric, config] of Object.entries(HISTORY_METRIC_CONFIG) as Array<
    [AgentHistoryMetric, (typeof HISTORY_METRIC_CONFIG)[AgentHistoryMetric]]
  >) {
    if (config.aliases.some((pattern) => pattern.test(prompt))) return metric
  }

  return null
}

function defaultHistoryWindow(metric: AgentHistoryMetric): AgentHistoryTimeWindow {
  return HISTORY_METRIC_CONFIG[metric].defaultWindow
}

function normalizeHistorySubjectName(value: string): string {
  return value.replace(/,/g, ' ').replace(/\s+/g, ' ').trim()
}

function extractHistorySubjectPhrase(prompt: string, subjectToken: 'county' | 'metro'): string | null {
  const tokenPattern = subjectToken === 'metro' ? 'metro(?:\\s+area)?' : 'county'
  const prepositionPattern = new RegExp(`\\b(?:for|in|of|at|about|on|to)\\s+`, 'ig')
  const extractFromTail = (tail: string): string | null => {
    const match = tail.match(new RegExp(`^([A-Za-z][A-Za-z\\s.'-]*?\\s+${tokenPattern})\\b`, 'i'))
    const subject = match?.[1]?.trim() ?? null
    if (!subject) return null

    const remainder = tail.slice(match[0].length).replace(/^[,\s]+/, '').trim()
    if (!remainder) return subject

    const stateAbbr = normalizeUsStateToAbbr(remainder)
    if (!stateAbbr) return subject

    return `${subject}, ${stateAbbr}`
  }

  for (const preposition of prompt.matchAll(prepositionPattern)) {
    const tail = prompt.slice((preposition.index ?? 0) + preposition[0].length).trim()
    const subject = extractFromTail(tail)
    if (subject) return subject
  }

  return extractFromTail(prompt.trim())
}

function resolveHistorySubjectMarket(
  userMessage: string,
  context: MapContext | null | undefined
): AgentHistorySubject | null {
  const prompt = userMessage.trim()

  const countyPhrase = extractHistorySubjectPhrase(prompt, 'county')
  if (countyPhrase) {
    const parsed = splitTrailingUsState(countyPhrase)
    if (parsed.stateAbbr && parsed.stateAbbr !== 'TX') return null

    const countyBaseName = normalizeHistorySubjectName(parsed.name).replace(/\s+county$/i, '').trim()
    const countyName = normalizeCountyDisplayName(countyBaseName)
    if (!countyName) return null

    return {
      kind: 'county',
      id: buildCountyAreaKey(countyBaseName, 'TX'),
      label: `${countyName}, TX`,
    }
  }

  const metroPhrase = extractHistorySubjectPhrase(prompt, 'metro')
  if (metroPhrase) {
    const parsed = splitTrailingUsState(metroPhrase)
    if (parsed.stateAbbr && parsed.stateAbbr !== 'TX') return null

    const metroName = normalizeMetroDisplayName(normalizeHistorySubjectName(parsed.name))
    if (!metroName) return null

    return {
      kind: 'metro',
      id: buildMetroAreaKey(metroName, 'TX'),
      label: `${metroName}, TX`,
    }
  }

  const zip = prompt.match(/\b\d{5}\b/)?.[0] ?? context?.zip?.trim() ?? null
  if (zip) {
    const label = context?.label?.trim() || context?.eda?.geographyLabel?.trim() || zip
    return { kind: 'zip', id: zip, label }
  }

  return null
}

function buildHistoryComparisonRequest(
  metric: AgentHistoryMetric,
  subjectMarket: AgentHistorySubject
): AnalyticalComparisonRequest {
  return {
    comparisonMode: 'history',
    metric,
    subjectMarket,
    comparisonMarket: null,
    timeWindow: defaultHistoryWindow(metric),
  }
}

function buildHistoryChartFromComparison(comparison: AnalyticalComparisonResult): ScoutChartOutput {
  const series = comparison.series.map((entry) => ({
    key: entry.key,
    label: entry.label,
    color: '#D76B3D',
    points: entry.points.map((point) => ({ x: point.x, y: point.y })),
  }))

  return normalizeScoutChartOutput({
    kind: HISTORY_METRIC_CONFIG[comparison.metric].chartKind,
    title: `${comparison.series[0]?.label ?? 'Market'} ${comparison.metricLabel.toLowerCase()} history`,
    subtitle: 'Historical series from the shared market-data router',
    summary: `Grounded ${comparison.metricLabel.toLowerCase()} history for ${comparison.series[0]?.label ?? 'the selected market'}.`,
    placeholder: false,
    confidenceLabel: 'router-backed history',
    xAxis: { key: 'period', label: 'Period' },
    yAxis: { label: comparison.metricLabel, valueFormat: HISTORY_METRIC_CONFIG[comparison.metric].valueFormat },
    series,
    citations: comparison.citations,
  })
}

function buildHistoryTrace(comparison: AnalyticalComparisonResult): AgentTrace {
  const subjectLabel = comparison.series[0]?.label ?? 'the selected market'
  const firstPoint = comparison.series[0]?.points[0] ?? null
  const lastPoint = comparison.series[0]?.points[comparison.series[0]?.points.length - 1] ?? null

  return {
    summary: `${comparison.metricLabel} history for ${subjectLabel}`,
    taskType: 'spot_trends',
    methodology:
      'Scout normalized the history request, delegated the historical read to the comparison-ready market-data router, and rendered the returned series without inventing any intermediate values.',
    keyFindings: [
      `${comparison.series[0]?.points.length ?? 0} historical points were returned for ${subjectLabel}.`,
      firstPoint && lastPoint
        ? `${comparison.metricLabel} moved from ${firstPoint.y} to ${lastPoint.y} across ${comparison.timeWindow.label}.`
        : `${comparison.metricLabel} history was available from the router.`,
    ],
    evidence: [
      `Metric: ${comparison.metricLabel}.`,
      `Window: ${comparison.timeWindow.label}.`,
      comparison.citations[0]?.label ? `Source: ${comparison.citations[0].label}.` : 'Source: router-backed historical series.',
    ],
    caveats: ['Only rent, unemployment rate, and permit history are supported in this bounded path.'],
    nextQuestions: ['Ask for another ZIP, county, or metro if you want a comparison against a different market.'],
    citations: comparison.citations,
  }
}

function buildUnsupportedHistoryPayload(message: string): AgentPipelineResult {
  return {
    message,
    action: { type: 'none' as const },
    trace: {
      summary: 'Unsupported history request',
      taskType: 'explain_metric',
      methodology:
        'Scout recognized a history-style prompt, but the bounded history lane only supports rent, unemployment rate, and permit units.',
      keyFindings: ['No history chart was generated.'],
      evidence: ['The requested metric is outside the supported history metric set.'],
      caveats: ['Try rent, unemployment rate, or permit history instead.'],
      nextQuestions: ['Ask for a supported history metric on the current ZIP, county, or metro.'],
    },
    chart: null,
  }
}

async function maybeBuildHistoryChartedResponse(
  userMessage: string,
  context: MapContext | null,
  dependencies: HistoryComparisonDependencies = {}
): Promise<AgentPipelineResult | null> {
  if (!hasHistoryIntent(userMessage)) return null

  const metric = detectHistoryMetric(userMessage)
  if (!metric) {
    return buildUnsupportedHistoryPayload(
      'That history metric is not supported yet. Scout only handles rent, unemployment rate, and permit units for now.'
    )
  }

  const subjectMarket = resolveHistorySubjectMarket(userMessage, context)
  if (!subjectMarket) {
    return {
      message: 'I could not identify which ZIP, county, or metro to use for that history request.',
      action: { type: 'none' as const },
      trace: {
        summary: 'History request missing a resolvable geography',
        taskType: 'explain_metric',
        methodology:
          'Scout found a supported history metric, but no grounded subject geography could be resolved from the prompt or current workspace.',
        keyFindings: ['No chart was generated.'],
        evidence: ['The route needs a ZIP, county, or metro to send the request to the history router.'],
        caveats: ['Try naming the geography directly or load the market first.'],
        nextQuestions: ['Ask for rent history on a ZIP like 78701.', 'Ask for permit history for a Texas county like Harris County, TX.'],
      },
      chart: null,
    }
  }

  if (metric === 'rent' && subjectMarket.kind !== 'zip') {
    return {
      message: 'Rent history is only supported for ZIP subjects right now. Try a ZIP like 78701.',
      action: { type: 'none' as const },
      trace: {
        summary: 'Rent history requires a ZIP subject',
        taskType: 'explain_metric',
        methodology:
          'Scout recognized a rent-history prompt but the bounded router path only supports rent at ZIP granularity.',
        keyFindings: ['No chart was generated.'],
        evidence: [`Resolved subject kind: ${subjectMarket.kind}.`],
        caveats: ['Rent history needs a ZIP subject in the current router contract.'],
        nextQuestions: ['Ask for rent history on a ZIP code.', 'Ask for permit or unemployment history on a county or metro.'],
      },
      chart: null,
    }
  }

  const fetchAnalyticalComparison =
    dependencies.getAnalyticalComparison ?? (async (request: AnalyticalComparisonRequest) => {
      const { getAnalyticalComparison } = await import('@/lib/data/market-data-router')
      return getAnalyticalComparison(request)
    })

  try {
    const comparison = await fetchAnalyticalComparison(buildHistoryComparisonRequest(metric, subjectMarket))
    const chart = buildHistoryChartFromComparison(comparison)
    return {
      message: `Here is the ${comparison.timeWindow.label.toLowerCase()} ${comparison.metricLabel.toLowerCase()} history for ${comparison.series[0]?.label ?? subjectMarket.label}.`,
      action: { type: 'none' as const },
      trace: buildHistoryTrace(comparison),
      chart,
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unable to build a grounded history response.'

    if (/unsupported analytical metric/i.test(message)) {
      return buildUnsupportedHistoryPayload(
        'That history metric is not supported yet. Scout only handles rent, unemployment rate, and permit units for now.'
      )
    }

    if (/insufficient historical data/i.test(message)) {
      return {
        message,
        action: { type: 'none' as const },
        trace: {
          summary: 'Insufficient historical data',
          taskType: 'spot_trends',
          methodology:
            'Scout delegated the request to the router, but the router did not return enough historical points to chart.',
          keyFindings: ['No chart was generated.'],
          evidence: [message],
          caveats: ['Try a broader time window or a subject with more persisted history.'],
          nextQuestions: ['Ask for a longer history window.', 'Try a ZIP, county, or metro with more persisted rows.'],
        },
        chart: null,
      }
    }

    return {
      message: 'I could not complete that history request from the current grounded data.',
      action: { type: 'none' as const },
      trace: {
        summary: 'History request could not be completed',
        taskType: 'spot_trends',
        methodology:
          'Scout normalized the history request, but the router call failed before a grounded series could be returned.',
        keyFindings: ['No chart was generated.'],
        evidence: [message],
        caveats: ['Try again with a clearer geography or a supported metric.'],
        nextQuestions: ['Ask for rent, unemployment rate, or permit history on the active market.'],
      },
      chart: null,
    }
  }
}

function maybeBuildFallbackChart(userMessage: string, context: MapContext | null): ScoutChartOutput | null {
  const prompt = userMessage.toLowerCase()
  const wantsTrend = /\b(trend|over time|history|timeline)\b/.test(prompt)
  if (!wantsTrend) return null

  const label = context?.label ?? context?.eda?.geographyLabel ?? 'Current market'

  return normalizeScoutChartOutput({
    kind: 'line',
    title: `${label} rent trend`,
    subtitle: 'Phase 1 chart contract demo',
    summary: 'Temporary chart payload used to validate the shared analytical rendering path.',
    placeholder: true,
    confidenceLabel: 'placeholder data',
    xAxis: { key: 'period', label: 'Period' },
    yAxis: { label: 'Indexed rent', valueFormat: 'index' },
    series: [
      {
        key: 'rent_index',
        label: 'Rent index',
        color: '#D76B3D',
        points: [
          { x: 'Start', y: 100 },
          { x: 'Mid', y: 104 },
          { x: 'Latest', y: 108 },
        ],
      },
    ],
    citations: [
      {
        id: 'phase1-placeholder-series',
        label: 'Phase 1 placeholder series',
        sourceType: 'placeholder',
        note: 'Replace with router-backed historical series during later convergence tasks.',
        placeholder: true,
      },
    ],
  })
}

function attachTraceCitations(trace: AgentTrace, chart: ScoutChartOutput | null): AgentTrace {
  if (!chart || chart.citations.length === 0) return trace

  return {
    ...trace,
    citations: chart.citations,
  }
}

export function buildFallbackChartedResponseForTest(userMessage: string, context: MapContext | null) {
  const fallback = buildFallbackEdaResponse(userMessage, context)
  const chart = maybeBuildFallbackChart(userMessage, context)

  return {
    message: fallback.message,
    trace: attachTraceCitations(fallback.trace, chart),
    chart,
  }
}

export async function buildHistoryChartedResponseForTest(
  userMessage: string,
  context: MapContext | null,
  dependencies: HistoryComparisonDependencies = {}
) {
  return maybeBuildHistoryChartedResponse(userMessage, context, dependencies)
}

function buildDefaultMapControlMessage(action: AgentAction): string {
  if (action.type === 'search') return `Navigating to ${action.query}.`
  if (action.type === 'toggle_layers') {
    const layerKeys = Object.keys(action.layers ?? {})
    const allOff = layerKeys.every((key) => action.layers?.[key] === false)
    const humanLayerNames = layerKeys.map((key) => humanizeLayerKey(key)).join(', ')
    return `${allOff ? 'Turning off' : 'Turning on'} ${humanLayerNames}.`
  }
  if (action.type === 'set_tilt') return action.tilt === 0 ? 'Flattening the map to 2D.' : `Setting map tilt to ${action.tilt}°.`
  if (action.type === 'focus_data_panel') return 'Opening the data panel.'
  if (action.type === 'generate_memo') return 'Opening the analysis panel.'
  return 'Updating the map.'
}

function normalizeMapControlAction(
  parsed: MapControlActionJson,
  context: MapContext | null | undefined
): NormalizedMapControlStep | null {
  const actionType = typeof parsed.actionType === 'string' ? parsed.actionType : 'none'
  const explicitMessage = typeof parsed.message === 'string' ? parsed.message.trim() : ''

  if (actionType === 'search') {
    const query = typeof parsed.searchQuery === 'string'
      ? normalizeMapSearchQuery(parsed.searchQuery.trim().replace(/[.,;:!?]+$/g, ''))
      : ''
    if (!query || looksAnalyticalPrompt(query)) return null

    const activeLabel = context?.label?.trim().toLowerCase() ?? ''
    if (activeLabel && activeLabel === query.toLowerCase()) {
      return {
        message: explicitMessage || `${query} is already the active market.`,
        action: { type: 'none' },
        summary: 'Active market already loaded',
      }
    }

    return {
      message: explicitMessage || `Navigating to ${query}.`,
      action: { type: 'search', query },
      summary: `Navigate to ${query}`,
    }
  }

  if (actionType === 'toggle_layers') {
    const layers = normalizeLayerRecord(parsed.layers)
    const layerKeys = Object.keys(layers)
    if (layerKeys.length === 0) return null

    const action: AgentAction = { type: 'toggle_layers', layers }
    const humanLayerNames = layerKeys.map((key) => humanizeLayerKey(key)).join(', ')
    const allOff = layerKeys.every((key) => layers[key] === false)
    return {
      message: explicitMessage || buildDefaultMapControlMessage(action),
      action,
      summary: `${allOff ? 'Hide' : 'Show'} ${humanLayerNames}`,
    }
  }

  if (actionType === 'set_tilt') {
    const tilt = typeof parsed.tilt === 'number' && Number.isFinite(parsed.tilt)
      ? Math.max(0, Math.min(60, Math.round(parsed.tilt)))
      : null
    if (tilt == null) return null

    const action: AgentAction = { type: 'set_tilt', tilt }
    return {
      message: explicitMessage || buildDefaultMapControlMessage(action),
      action,
      summary: tilt === 0 ? 'Switch to 2D view' : 'Set map tilt',
    }
  }

  if (actionType === 'focus_data_panel') {
    const action: AgentAction = { type: 'focus_data_panel' }
    return {
      message: explicitMessage || buildDefaultMapControlMessage(action),
      action,
      summary: 'Open data panel',
    }
  }

  if (actionType === 'generate_memo') {
    const action: AgentAction = { type: 'generate_memo' }
    return {
      message: explicitMessage || buildDefaultMapControlMessage(action),
      action,
      summary: 'Open analysis panel',
    }
  }

  return null
}

function normalizeMapControlSteps(
  value: unknown,
  context: MapContext | null | undefined
): NormalizedMapControlStep[] {
  if (!Array.isArray(value)) return []

  return value.flatMap((step) => {
    if (!step || typeof step !== 'object' || Array.isArray(step)) return []
    const normalized = normalizeMapControlAction(step as MapControlActionJson, context)
    return normalized ? [normalized] : []
  })
}

function buildGeminiMapControlTrace(
  summary: string,
  reason: string | null,
  confidence: number | null,
  steps: NormalizedMapControlStep[]
): AgentTrace {
  const normalizedReason = reason?.replace(/[.?!\s]+$/g, '') ?? null

  return {
    summary,
    methodology:
      'Scout used a bounded Gemini parser to interpret the natural-language map-control request into explicit UI actions, then normalized the result into canonical search, layer, and view commands.',
    keyFindings: [
      summary,
      steps.length > 1 ? `${steps.length} ordered map actions were extracted from one prompt.` : 'A direct map action was extracted from the prompt.',
    ],
    evidence: [
      confidence != null ? `Parser confidence: ${confidence.toFixed(2)}.` : 'The parser returned a structured action plan.',
      normalizedReason ? `Parser reason: ${normalizedReason}.` : 'The parser used the natural-language request plus current map state to derive the action plan.',
    ],
    caveats: ['Slash-prefixed terminal commands still stay on the local deterministic path; this NLP parser is only for natural-language agent prompts.'],
    nextQuestions: ['After the action runs, ask for EDA on the active market or imported dataset if you want interpretation.'],
    executionSteps: steps.map((step) => ({
      message: step.message,
      actionType: step.action.type,
    })),
  }
}

function buildAgentSteps(steps: NormalizedMapControlStep[]): AgentStep[] {
  return steps.map((step, index) => ({
    delay: index * 900,
    message: step.message,
    action: step.action,
  }))
}

function normalizeMapControlPlan(
  parsed: MapControlPlanJson,
  context: MapContext | null | undefined
): AgentPipelineResult | null {
  const confidence = typeof parsed.confidence === 'number' && Number.isFinite(parsed.confidence) ? parsed.confidence : null
  const reason = typeof parsed.reason === 'string' ? parsed.reason.trim() : null
  if (confidence != null && confidence < 0.6) return null

  const explicitMessage = typeof parsed.message === 'string' ? parsed.message.trim() : ''
  const normalizedSteps = normalizeMapControlSteps(parsed.steps, context)

  if (normalizedSteps.length > 0) {
    const summary = normalizedSteps.length > 1
      ? `Execute ${normalizedSteps.length}-step map-control sequence`
      : normalizedSteps[0]?.summary ?? 'Execute map-control action'

    return {
      message: explicitMessage || normalizedSteps.map((step) => step.message).join(' '),
      steps: buildAgentSteps(normalizedSteps),
      trace: buildGeminiMapControlTrace(summary, reason, confidence, normalizedSteps),
    }
  }

  const singleAction = normalizeMapControlAction(parsed, context)
  if (!singleAction) return null

  return {
    message: explicitMessage || singleAction.message,
    action: singleAction.action,
    trace: buildGeminiMapControlTrace(singleAction.summary, reason, confidence, [singleAction]),
  }
}

function getPrimarySearchTarget(plan: AgentPipelineResult): string | null {
  if (plan.action?.type === 'search') return plan.action.query ?? null
  return plan.steps?.find((step) => step.action.type === 'search')?.action.query ?? null
}

function normalizeDeterministicMapControl(
  deterministic: ReturnType<typeof inferDirectMapControl>
): AgentPipelineResult | null {
  if (!deterministic) return null
  return {
    message: deterministic.message,
    action: deterministic.action,
    trace: deterministic.trace,
  }
}

async function inferMapControlWithModel(
  prompt: string,
  context: MapContext | null | undefined
): Promise<AgentPipelineResult | null> {
  const deterministic = inferDirectMapControl(prompt, context)
  if (!process.env.GEMINI_API_KEY) return normalizeDeterministicMapControl(deterministic)

  try {
    const model = getGeminiJsonModel(MAP_CONTROL_SYSTEM_PROMPT)
    const result = await model.generateContent(
      [
        `USER REQUEST: ${prompt}`,
        `ACTIVE MARKET LABEL: ${context?.label ?? 'none'}`,
        `ACTIVE LAYERS: ${
          Object.entries(context?.layers ?? {})
            .filter(([, enabled]) => enabled)
            .map(([key]) => key)
            .join(', ') || 'none'
        }`,
      ].join('\n')
    )

    const parsed = normalizeMapControlPlan(parseMapControlPlanJson(result.response.text().trim()), context)
    return parsed ?? normalizeDeterministicMapControl(deterministic)
  } catch {
    return normalizeDeterministicMapControl(deterministic)
  }
}

function unresolvedMapControlPayload() {
  return {
    message:
      'I could not confidently parse that map-control request. Try a direct prompt like "take me to Harris County, TX" or "turn on transit," then ask the follow-up analysis.',
    action: { type: 'none' as const },
    trace: {
      summary: 'Map-control request could not be parsed',
      methodology:
        'Scout checked the bounded Gemini map-control parser and the deterministic backup parser, but neither produced a confident control action.',
      keyFindings: ['No map-control action was executed.'],
      evidence: ['The request was classified as direct map control, but no confident structured action could be extracted.'],
      caveats: ['Retry with a slightly more direct command if you want navigation or a UI control change first.'],
      nextQuestions: ['Try "take me to Harris County, TX."', 'Try "turn on transit."', 'After the action runs, ask the analysis question again.'],
    },
  }
}

async function runAgentPipeline(context: MapContext | null, userMessage: string): Promise<AgentPipelineResult> {
  const intent = classifyAgentRequestIntent(userMessage, context)
  if (intent.lane === 'direct_map_control') {
    const mapControl = await inferMapControlWithModel(userMessage, context)
    if (mapControl) {
      if (looksAnalyticalPrompt(userMessage)) {
        const fallback = buildFallbackEdaResponse(userMessage, context)
        const target = getPrimarySearchTarget(mapControl)

        if (target) {
          return {
            message: `Navigating to ${target}. Once that market loads, ask again and I’ll explain the requested snapshot using the active market data.`,
            action: mapControl.action,
            steps: mapControl.steps,
            trace: buildHybridMapAnalysisTrace(
              `Navigate to ${target} for follow-up analysis`,
              [
                `Matched an explicit navigation request for ${target}.`,
                mapControl.steps?.length
                  ? 'The direct prompt also included additional map actions, which will run after the navigation step.'
                  : 'The analytical part of the prompt refers to a market that is not yet the active workspace.',
              ],
              [
                `I did not answer the analysis part yet because that would have used the current workspace instead of ${target}.`,
              ],
              [`After ${target} loads, ask the same question again to get the market explanation.`]
            ),
          }
        }

        return {
          message: `${mapControl.message} ${fallback.message}`.trim(),
          action: mapControl.action,
          steps: mapControl.steps,
          trace: mergeTrace(
            {
              summary: `${mapControl.trace.summary} + ${fallback.trace.summary}`,
              methodology: 'Executed the explicit map-control request first, then answered the analytical part against the current workspace.',
              keyFindings: [
                ...(mapControl.trace.keyFindings ?? []),
                ...(fallback.trace.keyFindings ?? []),
              ].slice(0, 4),
              evidence: [
                ...(mapControl.trace.evidence ?? []),
                ...(fallback.trace.evidence ?? []),
              ].slice(0, 6),
              caveats: [
                ...(mapControl.trace.caveats ?? []),
                ...(fallback.trace.caveats ?? []),
              ].slice(0, 4),
              nextQuestions: fallback.trace.nextQuestions ?? mapControl.trace.nextQuestions,
            },
            fallback.trace
          ),
        }
      }

      return {
        message: mapControl.message,
        action: mapControl.action,
        steps: mapControl.steps,
        trace: mapControl.trace,
      }
    }

    return unresolvedMapControlPayload()
  }

  const history = await maybeBuildHistoryChartedResponse(userMessage, context)
  if (history) {
    return history
  }

  const fallback = buildFallbackEdaResponse(userMessage, context)
  const taskType = inferEdaTaskType(userMessage, context)

  if (!process.env.GEMINI_API_KEY) {
    const chart =
      (await buildRentTrendChart(userMessage, context)) ??
      (await buildRouterBackedChart(userMessage, context)) ??
      maybeBuildFallbackChart(userMessage, context)
    return {
      message: fallback.message,
      action: { type: 'none' as const },
      trace: attachTraceCitations(fallback.trace, chart),
      chart,
    }
  }

  const model = getGeminiJsonModel(SYSTEM_PROMPT)

  try {
    const contextStr = buildEdaContextString(userMessage, context)
    const chart =
      (await buildRentTrendChart(userMessage, context)) ??
      (await buildRouterBackedChart(userMessage, context)) ??
      maybeBuildFallbackChart(userMessage, context)
    const result = await model.generateContent(
      `${contextStr}\n\nDETERMINISTIC FALLBACK TRACE (use as the minimum evidence floor; you may rephrase but not contradict it):\n${JSON.stringify(
        {
          message: fallback.message,
          trace: fallback.trace,
        },
        null,
        2
      )}\n\nUSER REQUEST:\n${userMessage}`
    )

    const parsed = parseGeminiAgentJson(result.response.text().trim())
    const normalized = normalizeAgentTrace(
      {
        ...(parsed.trace && typeof parsed.trace === 'object' ? parsed.trace : {}),
        taskType,
      },
      null,
      null
    )

    return {
      message: parsed.message?.trim() || fallback.message,
      action: { type: 'none' as const },
      trace: attachTraceCitations(mergeTrace(normalized, fallback.trace), chart),
      chart,
    }
  } catch {
    const chart =
      (await buildRentTrendChart(userMessage, context)) ??
      (await buildRouterBackedChart(userMessage, context)) ??
      maybeBuildFallbackChart(userMessage, context)
    return {
      message: fallback.message,
      action: { type: 'none' as const },
      trace: attachTraceCitations(fallback.trace, chart),
      chart,
    }
  }
}

function blockedAgentTrace(reason: string): AgentTrace {
  return {
    summary: 'Prompt blocked before EDA analysis',
    taskType: 'summarize_dataset',
    methodology: 'The request policy rejected this prompt before any model call or deterministic EDA work ran.',
    keyFindings: ['This prompt falls outside the bounded Scout EDA assistant scope.'],
    evidence: ['The assistant now only handles dataset- and market-grounded exploratory analysis.'],
    caveats: [`Policy reason: ${reason}.`],
    nextQuestions: ['Ask about the loaded market, an imported dataset, outliers, distributions, trends, or data quality.'],
  }
}

function blockedAgentPayload(policy: Exclude<ReturnType<typeof evaluateAgentRequestPolicy>, { allowed: true }>) {
  return {
    message: policy.message,
    action: { type: 'none' as const },
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

function classifyAgentError(err: unknown): { message: string; status: number } {
  const message = err instanceof Error ? err.message : 'Unexpected error'
  const normalized = message.toLowerCase()

  if (normalized.includes('429') || normalized.includes('too many requests') || normalized.includes('resource exhausted')) {
    return {
      message: 'Gemini rate limit reached for this request. Retry in a moment.',
      status: 429,
    }
  }

  if (normalized.includes('503 service unavailable')) {
    return {
      message: 'Gemini is temporarily unavailable due to upstream load. Retry in a moment.',
      status: 503,
    }
  }

  return {
    message,
    status: 500,
  }
}

export async function POST(request: NextRequest) {
  try {
    const body = (await request.json()) as {
      message?: string
      context?: MapContext | null
      stream?: boolean
    }

    const userMessage = typeof body.message === 'string' ? body.message : ''
    const context = body.context ?? null
    const stream = body.stream === true

    const policy = evaluateAgentRequestPolicy(userMessage, context)
    if (!policy.allowed) {
      const payload = blockedAgentPayload(policy)
      if (stream) return blockedAgentStreamResponse(payload)
      return NextResponse.json(payload)
    }

    if (stream) {
      const encoder = new TextEncoder()
      const readable = new ReadableStream<Uint8Array>({
        async start(controller) {
          const push = (obj: Record<string, unknown>) => {
            controller.enqueue(encoder.encode(`${JSON.stringify(obj)}\n`))
          }

          try {
            push({ type: 'status', phase: 'json' })
            const out = await runAgentPipeline(context, userMessage)
            push({
              type: 'done',
              message: out.message,
              action: out.action,
              steps: out.steps,
              trace: out.trace,
              chart: out.chart,
            })
          } catch (err) {
            const failure = classifyAgentError(err)
            push({
              type: 'error',
              error: failure.message,
              status: failure.status,
              retryable: failure.status === 429 || failure.status === 503,
            })
          } finally {
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

    const out = await runAgentPipeline(context, userMessage)
    return NextResponse.json(out)
  } catch (err) {
    const failure = classifyAgentError(err)
    return NextResponse.json({ error: failure.message }, { status: failure.status })
  }
}
