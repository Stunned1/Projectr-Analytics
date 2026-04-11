/**
 * Structured market intelligence for the Market Report PDF (ZIP / city / borough).
 * Separate from the short cycle headline JSON in `gemini-brief.ts`.
 */
import { GoogleGenerativeAI } from '@google/generative-ai'
import { GEMINI_NO_EM_DASH_RULE } from '@/lib/gemini-text-rules'
import { stripGeminiStringWrappers } from '@/lib/sanitize-gemini-string'
import type { ClientReportPayload, GeminiBriefResult, MetroBenchmark, SignalIndicator } from './types'
import type { CycleAnalysis } from '@/lib/cycle/types'

export interface MarketDossierThematicBlock {
  title: string
  body: string
}

export interface MarketDossierGemini {
  geographyContext: string
  executiveSummary: string
  demandAndDemographics: MarketDossierThematicBlock
  supplyAndConstruction: MarketDossierThematicBlock
  pricingAndCapitalMarkets: MarketDossierThematicBlock
  laborAndMacro: MarketDossierThematicBlock
  peerAndBenchmarkRead: string
  risks: string[]
  opportunities: string[]
  scenarios: string[]
  monitoringChecklist: string[]
  limitations: string
}

function safeStr(v: unknown, fallback: string): string {
  if (v == null) return fallback
  const s = stripGeminiStringWrappers(String(v).trim())
  return s.length > 8000 ? `${s.slice(0, 8000)}…` : s
}

function safeBlock(raw: unknown, fallbackTitle: string, fallbackBody: string): MarketDossierThematicBlock {
  if (!raw || typeof raw !== 'object') return { title: fallbackTitle, body: fallbackBody }
  const o = raw as Record<string, unknown>
  return {
    title: safeStr(o.title, fallbackTitle).slice(0, 120) || fallbackTitle,
    body: safeStr(o.body, fallbackBody),
  }
}

function safeStringArray(raw: unknown, min: number, max: number, filler: string[]): string[] {
  if (!Array.isArray(raw)) return filler.slice(0, max)
  const out = raw
    .map((x) => safeStr(x, ''))
    .filter(Boolean)
    .slice(0, max)
  return out.length >= min ? out : filler.slice(0, max)
}

function buildDossierContext(input: {
  payload: ClientReportPayload
  brief: GeminiBriefResult
  signals: SignalIndicator[]
  cycleAnalysis: CycleAnalysis | null
  metro: MetroBenchmark | null
  zoriSeriesPointCount: number
  zoriLatest: number | null
  trendsPointCount: number
  trendsLatest: number | null
}): string {
  const { payload, brief, signals, cycleAnalysis, metro } = input
  const fredTail = [...(payload.fred.unemployment_monthly ?? [])].slice(-8)
  const signalLines = signals.map((s) => `${s.label} (${s.arrow}): ${s.line}`).join('\n')

  return JSON.stringify(
    {
      marketLabel: payload.marketLabel,
      primaryZip: payload.primaryZip,
      metroName: payload.metroName,
      geo: payload.geo,
      zori_peer_zip_count: payload.zori_peer_zips?.length ?? null,
      executive_headline: brief.cycleHeadline,
      executive_narrative: brief.narrative,
      confidence: brief.confidenceLine,
      zillow: payload.zillow,
      census: payload.census,
      permits: payload.permits,
      employment: payload.employment,
      fred_unemployment_recent: fredTail,
      trends_keyword: payload.trends.keyword_scope,
      trends_series_points: input.trendsPointCount,
      trends_latest_0_100: input.trendsLatest,
      zori_chart_points: input.zoriSeriesPointCount,
      zori_level_latest: input.zoriLatest,
      computed_signals: signalLines,
      cycle_classifier: cycleAnalysis
        ? {
            stage: cycleAnalysis.cycleStage,
            position: cycleAnalysis.cyclePosition,
            confidence: cycleAnalysis.confidence,
            dataQuality: cycleAnalysis.dataQuality,
            agreement: cycleAnalysis.signalsAgreement,
            signal_sources: Object.fromEntries(
              (['rent', 'vacancy', 'permits', 'employment'] as const).map((k) => [
                k,
                cycleAnalysis.signals[k].source,
              ])
            ),
          }
        : null,
      metro_peer_benchmark: metro
        ? {
            zip_count: metro.zip_count,
            avg_zori: metro.avg_zori,
            avg_zhvi: metro.avg_zhvi,
            avg_vacancy_rate: metro.avg_vacancy_rate,
            avg_unemployment_rate: metro.avg_unemployment_rate,
            avg_migration_movers: metro.avg_migration_movers,
          }
        : null,
      client_pin_count: payload.pins.length,
    },
    null,
    2
  )
}

const DOSSIER_JSON_INSTRUCTION = `Return ONLY valid JSON (no markdown). All strings plain text, no leading/trailing double-quotes inside values.

{
  "geographyContext": "1-2 sentences: clarify whether this is a single ZIP, a city aggregate, or borough-style geography and what that implies for interpreting metrics.",
  "executiveSummary": "4-6 dense sentences: mandate-style overview for an IC - tie rent, vacancy, permits, labor, and (if present) cycle position; cite specific numbers from context only.",
  "demandAndDemographics": { "title": "Demand & demographics", "body": "3-5 sentences on population, income, rent burden proxies, migration if present, and demand read." },
  "supplyAndConstruction": { "title": "Supply & construction", "body": "3-5 sentences on permit pipeline / BPS units, supply risk, construction cycle vs. demand." },
  "pricingAndCapitalMarkets": { "title": "Pricing & capital", "body": "3-5 sentences on ZORI/ZHVI levels and growth, spread vs metro peers if benchmarks exist, investor takeaway." },
  "laborAndMacro": { "title": "Labor & macro", "body": "3-5 sentences on unemployment / employment trend tail, FRED context, macro sensitivity." },
  "peerAndBenchmarkRead": "3-5 sentences comparing submarket to metro_peer_benchmark when present; if benchmarks null, say what is missing and how to interpret.",
  "risks": [ "4-6 short risk bullets with specifics" ],
  "opportunities": [ "4-6 short opportunity bullets" ],
  "scenarios": [ "3-4 one-line underwriting scenarios (base / upside / downside style)" ],
  "monitoringChecklist": [ "5-8 very short KPIs to watch next quarter" ],
  "limitations": "2-4 sentences: data vintage, county-level BPS, Google Trends geo limits, missing peer rows, etc."
}

Rules:
- Use ONLY numbers and facts present in CONTEXT JSON; if a field is null or missing, say unavailable - do not invent.
- Tone: institutional real estate memo, U.S. English.
- This is the Market Report dossier (whole submarket), not a parcel case study.
- ${GEMINI_NO_EM_DASH_RULE}`

export async function generateMarketDossierWithGemini(input: {
  payload: ClientReportPayload
  brief: GeminiBriefResult
  signals: SignalIndicator[]
  cycleAnalysis: CycleAnalysis | null
  metro: MetroBenchmark | null
  zoriSeries: { date: string; value: number }[]
  trendsSeries: { date: string; value: number }[]
}): Promise<MarketDossierGemini> {
  const key = process.env.GEMINI_API_KEY
  const zoriLatest = input.zoriSeries.length ? input.zoriSeries[input.zoriSeries.length - 1]!.value : null
  const trendsSorted = [...input.trendsSeries].sort((a, b) => a.date.localeCompare(b.date))
  const trendsLatest = trendsSorted.length ? trendsSorted[trendsSorted.length - 1]!.value : null

  const ctx = buildDossierContext({
    payload: input.payload,
    brief: input.brief,
    signals: input.signals,
    cycleAnalysis: input.cycleAnalysis,
    metro: input.metro,
    zoriSeriesPointCount: input.zoriSeries.length,
    zoriLatest,
    trendsPointCount: input.trendsSeries.length,
    trendsLatest,
  })

  const fallback: MarketDossierGemini = {
    geographyContext: `This report covers ${input.payload.marketLabel}${input.payload.primaryZip ? ` (anchor ZIP ${input.payload.primaryZip})` : ''}. Metrics may reflect a single ZIP or an aggregate across multiple ZIPs when in city or borough mode.`,
    executiveSummary: input.brief.narrative,
    demandAndDemographics: {
      title: 'Demand & demographics',
      body: `Population ${input.payload.census.total_population != null ? input.payload.census.total_population.toLocaleString() : 'n/a'}; median income ${input.payload.census.median_income != null ? '$' + Math.round(input.payload.census.median_income).toLocaleString() : 'n/a'}. Migration movers (different state): ${input.payload.census.migration_movers != null ? input.payload.census.migration_movers.toLocaleString() : 'n/a'}.`,
    },
    supplyAndConstruction: {
      title: 'Supply & construction',
      body: `County BPS permitted units (2021–23 sum): ${input.payload.permits.total_units_2021_2023 != null ? Math.round(input.payload.permits.total_units_2021_2023).toLocaleString() : 'n/a'}. Yearly breakdown is shown on the data page of this PDF.`,
    },
    pricingAndCapitalMarkets: {
      title: 'Pricing & capital',
      body: `ZORI ${input.payload.zillow.zori != null ? '$' + Math.round(input.payload.zillow.zori).toLocaleString() : 'n/a'} (${input.payload.zillow.zori_growth_yoy != null ? input.payload.zillow.zori_growth_yoy.toFixed(1) + '% YoY' : 'YoY n/a'}); ZHVI ${input.payload.zillow.zhvi != null ? '$' + Math.round(input.payload.zillow.zhvi).toLocaleString() : 'n/a'}.`,
    },
    laborAndMacro: {
      title: 'Labor & macro',
      body: `Unemployment ${input.payload.employment.unemployment_rate != null ? input.payload.employment.unemployment_rate.toFixed(1) + '%' : 'n/a'}; employment rate ${input.payload.employment.employment_rate != null ? input.payload.employment.employment_rate.toFixed(1) + '%' : 'n/a'} (see FRED county series in data pipeline).`,
    },
    peerAndBenchmarkRead:
      input.metro && input.metro.zip_count > 0
        ? `Metro peer sample covers ${input.metro.zip_count} Zillow-tracked ZIPs in the same metro. Average ZORI ${input.metro.avg_zori != null ? '$' + Math.round(input.metro.avg_zori).toLocaleString() : 'n/a'} vs. submarket above.`
        : 'Metro peer averages were unavailable - cold-load peer ZIPs or check metro linkage in zip_metro_lookup.',
    risks: [
      'Data sparsity in peer ZIPs can skew benchmark columns.',
      'County-level BPS permits apply uniformly to all ZIPs in the county.',
      'Google Trends reflects search interest, not transaction volume.',
    ],
    opportunities: [
      'Cross-check rent trajectory chart vs. YoY headline for inflection.',
      'Compare vacancy to metro average when benchmark row is populated.',
    ],
    scenarios: [
      'Base: current rent growth and vacancy persist; permits stable.',
      'Upside: accelerating rent + tightening vacancy.',
      'Downside: rising vacancy + permit pullback.',
    ],
    monitoringChecklist: [
      'ZORI 3m slope',
      'ACS vacancy',
      'BPS units YoY',
      'FRED unemployment delta',
      'Google Trends vs. seasonal norm',
    ],
    limitations:
      'This PDF blends cached Supabase rows with Zillow and Census extracts; some peers may lack ACS or FRED until loaded. Trends are keyword- and geography-constrained per Google.',
  }

  if (!key) return fallback

  try {
    const genAI = new GoogleGenerativeAI(key)
    const model = genAI.getGenerativeModel({
      model: 'gemini-2.5-flash',
      generationConfig: { responseMimeType: 'application/json', maxOutputTokens: 8192 },
    })
    const result = await model.generateContent(`${DOSSIER_JSON_INSTRUCTION}\n\nCONTEXT:\n${ctx}`)
    const raw = result.response.text().trim().replace(/^```json\n?/, '').replace(/\n?```$/, '')
    const parsed = JSON.parse(raw) as Record<string, unknown>

    return {
      geographyContext: safeStr(parsed.geographyContext, fallback.geographyContext),
      executiveSummary: safeStr(parsed.executiveSummary, fallback.executiveSummary),
      demandAndDemographics: safeBlock(
        parsed.demandAndDemographics,
        fallback.demandAndDemographics.title,
        fallback.demandAndDemographics.body
      ),
      supplyAndConstruction: safeBlock(
        parsed.supplyAndConstruction,
        fallback.supplyAndConstruction.title,
        fallback.supplyAndConstruction.body
      ),
      pricingAndCapitalMarkets: safeBlock(
        parsed.pricingAndCapitalMarkets,
        fallback.pricingAndCapitalMarkets.title,
        fallback.pricingAndCapitalMarkets.body
      ),
      laborAndMacro: safeBlock(parsed.laborAndMacro, fallback.laborAndMacro.title, fallback.laborAndMacro.body),
      peerAndBenchmarkRead: safeStr(parsed.peerAndBenchmarkRead, fallback.peerAndBenchmarkRead),
      risks: safeStringArray(parsed.risks, 3, 8, fallback.risks),
      opportunities: safeStringArray(parsed.opportunities, 3, 8, fallback.opportunities),
      scenarios: safeStringArray(parsed.scenarios, 3, 6, fallback.scenarios),
      monitoringChecklist: safeStringArray(parsed.monitoringChecklist, 4, 10, fallback.monitoringChecklist),
      limitations: safeStr(parsed.limitations, fallback.limitations),
    }
  } catch {
    return fallback
  }
}
