import { create } from 'zustand'
import { createJSONStorage, persist } from 'zustand/middleware'

import type { ScoutChartOutput } from '@/lib/scout-chart-output'

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

function normalizeSavedChartRecord(record: SavedChartRecord): SavedChartRecord {
  return {
    ...record,
    marketLabel: record.marketLabel ?? null,
  }
}

export const useSavedChartsStore = create<SavedChartsStore>()(
  persist(
    (set, get) => ({
      charts: [],
      saveChart: (input) => {
        const id = generateSavedChartId()
        const record: SavedChartRecord = {
          id,
          chart: input.chart,
          prompt: input.prompt,
          marketLabel: input.marketLabel ?? null,
          savedAt: new Date().toISOString(),
        }

        set((state) => ({
          charts: [record, ...state.charts],
        }))

        return id
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
      partialize: (state) => ({
        charts: state.charts.map((chart) => normalizeSavedChartRecord(chart)),
      }),
    }
  )
)
