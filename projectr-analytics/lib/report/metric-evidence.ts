export type ReportEvidenceStrength = 'direct' | 'aggregated' | 'derived' | 'proxy' | 'modeled'

export interface ReportMetricEvidence {
  key:
    | 'zori'
    | 'vacancy'
    | 'permits'
    | 'zhvi'
    | 'employment'
    | 'migration'
    | 'site_momentum'
    | 'site_zori'
    | 'site_cycle'
  clientLabel: string
  internalLabel: string
  explanation: string
  whyItMatters: string
  sourceLabel: string
  sourceDetail: string
  strength: ReportEvidenceStrength
  defaultScope?: string | null
  defaultPeriod?: string | null
}

export interface ResolvedReportMetricEvidence extends ReportMetricEvidence {
  activeLabel: string
  scope: string | null
  periodLabel: string | null
  strengthLabel: string
}

const METRIC_EVIDENCE: Record<ReportMetricEvidence['key'], ReportMetricEvidence> = {
  zori: {
    key: 'zori',
    clientLabel: 'Typical rent level',
    internalLabel: 'Median rent (ZORI index)',
    explanation: 'An index-based estimate of prevailing asking rent for the market.',
    whyItMatters: 'Helps explain current rent positioning and how quickly pricing is moving.',
    sourceLabel: 'Zillow Research',
    sourceDetail: 'Pulled from Scout Zillow snapshot tables and monthly history when available.',
    strength: 'direct',
    defaultScope: 'active market',
  },
  vacancy: {
    key: 'vacancy',
    clientLabel: 'Vacant housing share',
    internalLabel: 'Vacancy rate',
    explanation: 'The share of housing units reported vacant in Census ACS data.',
    whyItMatters: 'Lower vacancy can signal tighter demand; higher vacancy can point to softer absorption.',
    sourceLabel: 'Census ACS',
    sourceDetail: 'Latest cached ACS vacancy row for the selected geography.',
    strength: 'direct',
  },
  permits: {
    key: 'permits',
    clientLabel: 'Recent permitting activity',
    internalLabel: 'Permits (county BPS, 2021-23 units)',
    explanation: 'A county-level count of housing units permitted over the recent BPS window.',
    whyItMatters: 'Used as a supply proxy to show whether new housing construction is accelerating.',
    sourceLabel: 'Census BPS',
    sourceDetail: 'County-level permit series used as a supply proxy for the report area.',
    strength: 'proxy',
    defaultScope: 'county proxy',
  },
  zhvi: {
    key: 'zhvi',
    clientLabel: 'Typical home value',
    internalLabel: 'Median home value (ZHVI)',
    explanation: 'An index-based estimate of prevailing home values in the market.',
    whyItMatters: 'Provides context on price level, investor positioning, and cost pressure.',
    sourceLabel: 'Zillow Research',
    sourceDetail: 'Pulled from Scout Zillow snapshot tables for the selected market.',
    strength: 'direct',
  },
  employment: {
    key: 'employment',
    clientLabel: 'Employment health',
    internalLabel: 'Employment (local)',
    explanation: 'A local employment or unemployment read derived from FRED labor market series.',
    whyItMatters: 'Labor conditions often help explain renter demand and resilience.',
    sourceLabel: 'FRED',
    sourceDetail: 'Latest local labor series available in Scout cache; employment rate preferred when matched.',
    strength: 'aggregated',
  },
  migration: {
    key: 'migration',
    clientLabel: 'In-migration signal',
    internalLabel: 'Migration / mobility (ACS)',
    explanation: 'Estimated movers coming from a different state in ACS migration tables.',
    whyItMatters: 'Useful as a directional demand signal for household inflow.',
    sourceLabel: 'Census ACS',
    sourceDetail: 'Latest cached movers-from-different-state row for the selected geography.',
    strength: 'aggregated',
  },
  site_momentum: {
    key: 'site_momentum',
    clientLabel: 'Momentum score',
    internalLabel: 'Momentum score',
    explanation: 'A derived ranking score based on relative rent, labor, and permit strength.',
    whyItMatters: 'Used to rank compared sites on relative market strength, not absolute investment quality.',
    sourceLabel: 'Scout momentum model',
    sourceDetail: 'Calculated from the same bounded momentum endpoint used elsewhere in Scout.',
    strength: 'derived',
  },
  site_zori: {
    key: 'site_zori',
    clientLabel: 'Typical rent near site',
    internalLabel: 'Comparable site ZORI',
    explanation: 'ZIP-level Zillow rent context for the market that each site resolves into.',
    whyItMatters: 'Helps compare rent context across shortlisted sites.',
    sourceLabel: 'Zillow Research',
    sourceDetail: 'Uses zillow_zip_snapshot after resolving site coordinates to a ZIP.',
    strength: 'direct',
  },
  site_cycle: {
    key: 'site_cycle',
    clientLabel: 'Cycle phase',
    internalLabel: 'Cycle phase',
    explanation: 'A bounded cycle read based on rent, vacancy, permits, and labor signals.',
    whyItMatters: 'Adds directional context to the site ranking table.',
    sourceLabel: 'Scout cycle classifier',
    sourceDetail: 'Deterministic cycle analysis over the same cached market metrics used in the report.',
    strength: 'derived',
  },
}

export function listReportMetricEvidence(): ReportMetricEvidence[] {
  return Object.values(METRIC_EVIDENCE)
}

function strengthLabel(strength: ReportEvidenceStrength): string {
  switch (strength) {
    case 'direct':
      return 'Direct source'
    case 'aggregated':
      return 'Aggregated source'
    case 'derived':
      return 'Derived metric'
    case 'proxy':
      return 'Proxy metric'
    case 'modeled':
      return 'Modeled metric'
    default:
      return 'Source'
  }
}

export function resolveReportMetricEvidence(
  key: ReportMetricEvidence['key'],
  template: 'client' | 'internal',
  overrides?: {
    periodLabel?: string | null
    scope?: string | null
  }
): ResolvedReportMetricEvidence {
  const base = METRIC_EVIDENCE[key]
  return {
    ...base,
    activeLabel: template === 'internal' ? base.internalLabel : base.clientLabel,
    periodLabel: overrides?.periodLabel ?? base.defaultPeriod ?? null,
    scope: overrides?.scope ?? base.defaultScope ?? null,
    strengthLabel: strengthLabel(base.strength),
  }
}
