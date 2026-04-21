import type { AnalyticalMetric, AnalyticalSubject, AnalyticalTimeWindow } from './market-data-router'

export type AnalyticalSourceKind = 'runtime' | 'eda_analytical' | 'cache' | 'external'
export type AnalyticalSourceSystem = 'supabase' | 'bigquery' | 'api'
export type AnalyticalTopic = 'shared_metrics' | 'permits' | 'housing_activity' | 'geography'

export interface AnalyticalSourceRegistryEntry {
  id: string
  kind: AnalyticalSourceKind
  system: AnalyticalSourceSystem
  tableOrEndpoint: string
  topics: readonly AnalyticalTopic[]
  geographyKinds: ReadonlyArray<AnalyticalSubject['kind']>
  notes: string
  enabled: boolean
}

export const ANALYTICAL_SOURCE_REGISTRY: readonly AnalyticalSourceRegistryEntry[] = [
  {
    id: 'texas_permits',
    kind: 'eda_analytical',
    system: 'bigquery',
    tableOrEndpoint: 'texas_permits',
    topics: ['permits'],
    geographyKinds: ['county', 'metro'],
    notes: 'Preferred Texas warehouse history for county and metro permit-unit EDA.',
    enabled: true,
  },
  {
    id: 'trerc',
    kind: 'eda_analytical',
    system: 'bigquery',
    tableOrEndpoint: 'trerc',
    topics: ['housing_activity'],
    geographyKinds: ['county', 'metro'],
    notes: 'Reserved for Texas housing activity EDA routing.',
    enabled: true,
  },
  {
    id: 'master_data',
    kind: 'eda_analytical',
    system: 'bigquery',
    tableOrEndpoint: 'master_data',
    topics: ['shared_metrics', 'permits'],
    geographyKinds: ['zip', 'county', 'metro'],
    notes: 'Normalized warehouse fallback for historical analytical reads.',
    enabled: true,
  },
  {
    id: 'projectr_master_data',
    kind: 'runtime',
    system: 'supabase',
    tableOrEndpoint: 'projectr_master_data',
    topics: ['shared_metrics', 'permits'],
    geographyKinds: ['zip', 'county', 'metro'],
    notes: 'Operational warm-store fallback for shared metrics.',
    enabled: true,
  },
  {
    id: 'zip_metro_lookup',
    kind: 'cache',
    system: 'supabase',
    tableOrEndpoint: 'zip_metro_lookup',
    topics: ['geography'],
    geographyKinds: ['zip', 'county', 'metro'],
    notes: 'ZIP lookup helper only, not analytical truth.',
    enabled: true,
  },
  {
    id: 'austin_raw_permits_api',
    kind: 'external',
    system: 'api',
    tableOrEndpoint: '/api/permits/texas/raw',
    topics: ['permits'],
    geographyKinds: ['metro'],
    notes: 'Austin row-level raw permits stay as a live API adapter for now.',
    enabled: true,
  },
] as const

function isTexasSubject(subject: AnalyticalSubject): boolean {
  return subject.id.includes(':TX:') || /,\s*TX$/i.test(subject.label)
}

export function selectSpecializedHistorySource(
  metric: AnalyticalMetric,
  subject: AnalyticalSubject,
  _timeWindow: AnalyticalTimeWindow
): AnalyticalSourceRegistryEntry | null {
  if (!isTexasSubject(subject)) return null

  if (metric === 'permit_units' && (subject.kind === 'county' || subject.kind === 'metro')) {
    return ANALYTICAL_SOURCE_REGISTRY.find((entry) => entry.id === 'texas_permits') ?? null
  }

  return null
}
