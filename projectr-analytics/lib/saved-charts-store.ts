import { create } from 'zustand'
import { createJSONStorage, persist } from 'zustand/middleware'

import { isScoutChartOutput, normalizeScoutChartOutput, type ScoutChartOutput } from '@/lib/scout-chart-output'

export const SAVED_CHARTS_STORAGE_KEY = 'projectr-saved-charts-v1'

export interface SavedChartRecord {
  id: string
  chart: ScoutChartOutput
  prompt: string
  marketLabel?: string | null
  savedAt: string
}

interface SavedChartsStore {
  charts: SavedChartRecord[]
  saveChart: (input: { chart: ScoutChartOutput; prompt: string; marketLabel?: string | null }) => string
  hasSavedChart: (input: { chart: ScoutChartOutput; prompt: string; marketLabel?: string | null }) => boolean
  removeChart: (id: string) => void
  hasChart: (id: string) => boolean
  resetForTests: () => void
}

function generateSavedChartId(): string {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID()
  }

  return `saved-chart-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`
}

function normalizeSavedChartRecord(record: unknown): SavedChartRecord | null {
  if (!record || typeof record !== 'object' || Array.isArray(record)) {
    return null
  }

  const candidate = record as Partial<SavedChartRecord> & { chart?: unknown }

  if (
    typeof candidate.id !== 'string' ||
    typeof candidate.prompt !== 'string' ||
    typeof candidate.savedAt !== 'string' ||
    !isScoutChartOutput(candidate.chart)
  ) {
    return null
  }

  return {
    id: candidate.id,
    chart: normalizeScoutChartOutput(candidate.chart),
    prompt: candidate.prompt,
    marketLabel: typeof candidate.marketLabel === 'string' ? candidate.marketLabel : null,
    savedAt: candidate.savedAt,
  }
}

function normalizeSavedChartRecords(state: unknown): SavedChartRecord[] {
  if (!state || typeof state !== 'object' || Array.isArray(state)) {
    return []
  }

  const charts = (state as { charts?: unknown }).charts

  if (!Array.isArray(charts)) {
    return []
  }

  return charts.flatMap((chart) => {
    const normalized = normalizeSavedChartRecord(chart)
    return normalized ? [normalized] : []
  })
}

function buildSavedChartSignature(input: {
  chart: ScoutChartOutput
  prompt: string
  marketLabel?: string | null
}): string {
  return JSON.stringify({
    chart: normalizeScoutChartOutput(input.chart),
    prompt: input.prompt,
    marketLabel: input.marketLabel ?? null,
  })
}

export const useSavedChartsStore = create<SavedChartsStore>()(
  persist(
    (set, get) => ({
      charts: [],
      saveChart: (input) => {
        const signature = buildSavedChartSignature(input)
        const existing = get().charts.find((chart) =>
          buildSavedChartSignature({
            chart: chart.chart,
            prompt: chart.prompt,
            marketLabel: chart.marketLabel ?? null,
          }) === signature
        )
        if (existing) return existing.id

        const id = generateSavedChartId()
        const record: SavedChartRecord = {
          id,
          chart: normalizeScoutChartOutput(input.chart),
          prompt: input.prompt,
          marketLabel: input.marketLabel ?? null,
          savedAt: new Date().toISOString(),
        }

        set((state) => ({
          charts: [record, ...state.charts],
        }))

        return id
      },
      hasSavedChart: (input) => {
        const signature = buildSavedChartSignature(input)
        return get().charts.some((chart) =>
          buildSavedChartSignature({
            chart: chart.chart,
            prompt: chart.prompt,
            marketLabel: chart.marketLabel ?? null,
          }) === signature
        )
      },
      removeChart: (id) =>
        set((state) => ({
          charts: state.charts.filter((chart) => chart.id !== id),
        })),
      hasChart: (id) => get().charts.some((chart) => chart.id === id),
      resetForTests: () => set({ charts: [] }),
    }),
    {
      name: SAVED_CHARTS_STORAGE_KEY,
      storage: createJSONStorage(() => sessionStorage),
      merge: (persistedState, currentState) => ({
        ...currentState,
        charts: normalizeSavedChartRecords(persistedState),
      }),
      partialize: (state) => ({
        charts: state.charts.flatMap((chart) => {
          const normalized = normalizeSavedChartRecord(chart)
          return normalized ? [normalized] : []
        }),
      }),
    }
  )
)
