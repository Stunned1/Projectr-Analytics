import { create } from 'zustand'
import { createJSONStorage, persist } from 'zustand/middleware'

import { isScoutChartOutput, normalizeScoutChartOutput, type ScoutChartOutput } from '@/lib/scout-chart-output'

export const SAVED_CHARTS_STORAGE_KEY = 'projectr-saved-charts-v1'

export type SavedOutputRecord =
  | {
      id: string
      kind: 'chart'
      savedAt: string
      prompt: string
      marketLabel?: string | null
      payload: ScoutChartOutput
    }
  | {
      id: string
      kind: 'stat_card'
      savedAt: string
      prompt: string
      marketLabel?: string | null
      payload: {
        title: string
        summary?: string | null
        stats: Array<{ label: string; value: string; sublabel?: string | null }>
      }
    }
  | {
      id: string
      kind: 'permit_detail'
      savedAt: string
      prompt?: string | null
      marketLabel?: string | null
      payload: {
        title: string
        permitLabel: string
        sourceKind: string
        sourceName: string
        addressOrPlace: string
        categoryLabel: string
        dateLabel?: string | null
        sourceUrl?: string | null
        coordinates?: { lat: number; lng: number } | null
        stats: Array<{ label: string; value: string; sublabel?: string | null }>
      }
    }
  | {
      id: string
      kind: 'places_context'
      savedAt: string
      prompt?: string | null
      marketLabel?: string | null
      payload: {
        siteLabel: string
        lat: number
        lng: number
        radiusMeters: number
        summary: string
        countsByCategory: Array<{ category: string; label: string; count: number }>
        topPlaces: Array<{ name: string; categoryLabel: string; distanceMeters?: number }>
      }
    }
  | {
      id: string
      kind: 'uploaded_pin'
      savedAt: string
      prompt?: string | null
      marketLabel?: string | null
      payload: {
        siteLabel: string
        lat: number
        lng: number
        sourceLabel?: string | null
        rowPreview: Record<string, unknown>
      }
    }

export interface SavedChartRecord {
  id: string
  chart: ScoutChartOutput
  prompt: string
  marketLabel?: string | null
  savedAt: string
}

export type SaveOutputInput =
  | {
      kind: 'chart'
      prompt: string
      marketLabel?: string | null
      payload: ScoutChartOutput
    }
  | {
      kind: 'stat_card'
      prompt: string
      marketLabel?: string | null
      payload: {
        title: string
        summary?: string | null
        stats: Array<{ label: string; value: string; sublabel?: string | null }>
      }
    }
  | {
      kind: 'permit_detail'
      prompt?: string | null
      marketLabel?: string | null
      payload: {
        title: string
        permitLabel: string
        sourceKind: string
        sourceName: string
        addressOrPlace: string
        categoryLabel: string
        dateLabel?: string | null
        sourceUrl?: string | null
        coordinates?: { lat: number; lng: number } | null
        stats: Array<{ label: string; value: string; sublabel?: string | null }>
      }
    }
  | {
      kind: 'places_context'
      prompt?: string | null
      marketLabel?: string | null
      payload: {
        siteLabel: string
        lat: number
        lng: number
        radiusMeters: number
        summary: string
        countsByCategory: Array<{ category: string; label: string; count: number }>
        topPlaces: Array<{ name: string; categoryLabel: string; distanceMeters?: number }>
      }
    }
  | {
      kind: 'uploaded_pin'
      prompt?: string | null
      marketLabel?: string | null
      payload: {
        siteLabel: string
        lat: number
        lng: number
        sourceLabel?: string | null
        rowPreview: Record<string, unknown>
      }
    }

interface SavedChartsStore {
  outputs: SavedOutputRecord[]
  charts: SavedChartRecord[]
  saveOutput: (input: SaveOutputInput) => string
  hasSavedOutput: (input: SaveOutputInput) => boolean
  removeOutput: (id: string) => void
  saveChart: (input: { chart: ScoutChartOutput; prompt: string; marketLabel?: string | null }) => string
  hasSavedChart: (input: { chart: ScoutChartOutput; prompt: string; marketLabel?: string | null }) => boolean
  removeChart: (id: string) => void
  hasChart: (id: string) => boolean
  resetForTests: () => void
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

function buildSavedChartCoreSignature(input: {
  chart: ScoutChartOutput
  prompt: string
}): string {
  return JSON.stringify({
    chart: normalizeScoutChartOutput(input.chart),
    prompt: input.prompt,
  })
}

function matchesSavedChart(
  input: { chart: ScoutChartOutput; prompt: string; marketLabel?: string | null },
  charts: SavedChartRecord[]
): SavedChartRecord | null {
  const inputSignature = buildSavedChartSignature(input)
  const exact = charts.find((existing) => {
    const existingSignature = buildSavedChartSignature({
      chart: existing.chart,
      prompt: existing.prompt,
      marketLabel: existing.marketLabel ?? null,
    })
    return inputSignature === existingSignature
  })
  if (exact) return exact

  const inputMarketLabel = input.marketLabel ?? null
  if (inputMarketLabel != null) return null

  const inputCoreSignature = buildSavedChartCoreSignature(input)
  const compatibleMatches = charts.filter((existing) => {
    const existingCoreSignature = buildSavedChartCoreSignature({
      chart: existing.chart,
      prompt: existing.prompt,
    })
    return existingCoreSignature === inputCoreSignature
  })

  return compatibleMatches.length === 1 ? compatibleMatches[0] : null
}

function generateSavedOutputId(): string {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID()
  }

  return `saved-output-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`
}

function isStringRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value)
}

function normalizeStatList(value: unknown): Array<{ label: string; value: string; sublabel?: string | null }> | null {
  if (!Array.isArray(value)) return null
  const stats = value.flatMap((entry) => {
    if (!isStringRecord(entry) || typeof entry.label !== 'string' || typeof entry.value !== 'string') return []
    return [
      {
        label: entry.label,
        value: entry.value,
        sublabel: typeof entry.sublabel === 'string' ? entry.sublabel : null,
      },
    ]
  })
  return stats.length === value.length ? stats : null
}

function normalizeCountsByCategory(value: unknown): Array<{ category: string; label: string; count: number }> | null {
  if (!Array.isArray(value)) return null
  const counts = value.flatMap((entry) => {
    if (
      !isStringRecord(entry) ||
      typeof entry.category !== 'string' ||
      typeof entry.label !== 'string' ||
      typeof entry.count !== 'number'
    ) {
      return []
    }
    return [{ category: entry.category, label: entry.label, count: entry.count }]
  })
  return counts.length === value.length ? counts : null
}

function normalizeTopPlaces(
  value: unknown
): Array<{ name: string; categoryLabel: string; distanceMeters?: number }> | null {
  if (!Array.isArray(value)) return null
  const places = value.flatMap((entry) => {
    if (!isStringRecord(entry) || typeof entry.name !== 'string' || typeof entry.categoryLabel !== 'string') return []
    return [
      {
        name: entry.name,
        categoryLabel: entry.categoryLabel,
        distanceMeters: typeof entry.distanceMeters === 'number' ? entry.distanceMeters : undefined,
      },
    ]
  })
  return places.length === value.length ? places : null
}

function normalizeSavedOutputRecord(record: unknown): SavedOutputRecord | null {
  if (!isStringRecord(record) || typeof record.id !== 'string' || typeof record.kind !== 'string' || typeof record.savedAt !== 'string') {
    return null
  }

  const marketLabel = typeof record.marketLabel === 'string' ? record.marketLabel : null
  const prompt = typeof record.prompt === 'string' ? record.prompt : null

  if (record.kind === 'chart') {
    if (!prompt || !isScoutChartOutput(record.payload)) return null
    return {
      id: record.id,
      kind: 'chart',
      savedAt: record.savedAt,
      prompt,
      marketLabel,
      payload: normalizeScoutChartOutput(record.payload),
    }
  }

  if (record.kind === 'stat_card') {
    if (!prompt || !isStringRecord(record.payload) || typeof record.payload.title !== 'string') return null
    const stats = normalizeStatList(record.payload.stats)
    if (!stats) return null
    return {
      id: record.id,
      kind: 'stat_card',
      savedAt: record.savedAt,
      prompt,
      marketLabel,
      payload: {
        title: record.payload.title,
        summary: typeof record.payload.summary === 'string' ? record.payload.summary : null,
        stats,
      },
    }
  }

  if (record.kind === 'permit_detail') {
    if (
      !isStringRecord(record.payload) ||
      typeof record.payload.title !== 'string' ||
      typeof record.payload.permitLabel !== 'string' ||
      typeof record.payload.sourceKind !== 'string' ||
      typeof record.payload.sourceName !== 'string' ||
      typeof record.payload.addressOrPlace !== 'string' ||
      typeof record.payload.categoryLabel !== 'string'
    ) {
      return null
    }
    const stats = normalizeStatList(record.payload.stats)
    if (!stats) return null
    const coordinates =
      isStringRecord(record.payload.coordinates) &&
      typeof record.payload.coordinates.lat === 'number' &&
      typeof record.payload.coordinates.lng === 'number'
        ? { lat: record.payload.coordinates.lat, lng: record.payload.coordinates.lng }
        : null
    return {
      id: record.id,
      kind: 'permit_detail',
      savedAt: record.savedAt,
      prompt,
      marketLabel,
      payload: {
        title: record.payload.title,
        permitLabel: record.payload.permitLabel,
        sourceKind: record.payload.sourceKind,
        sourceName: record.payload.sourceName,
        addressOrPlace: record.payload.addressOrPlace,
        categoryLabel: record.payload.categoryLabel,
        dateLabel: typeof record.payload.dateLabel === 'string' ? record.payload.dateLabel : null,
        sourceUrl: typeof record.payload.sourceUrl === 'string' ? record.payload.sourceUrl : null,
        coordinates,
        stats,
      },
    }
  }

  if (record.kind === 'places_context') {
    if (
      !isStringRecord(record.payload) ||
      typeof record.payload.siteLabel !== 'string' ||
      typeof record.payload.lat !== 'number' ||
      typeof record.payload.lng !== 'number' ||
      typeof record.payload.radiusMeters !== 'number' ||
      typeof record.payload.summary !== 'string'
    ) {
      return null
    }
    const countsByCategory = normalizeCountsByCategory(record.payload.countsByCategory)
    const topPlaces = normalizeTopPlaces(record.payload.topPlaces)
    if (!countsByCategory || !topPlaces) return null
    return {
      id: record.id,
      kind: 'places_context',
      savedAt: record.savedAt,
      prompt,
      marketLabel,
      payload: {
        siteLabel: record.payload.siteLabel,
        lat: record.payload.lat,
        lng: record.payload.lng,
        radiusMeters: record.payload.radiusMeters,
        summary: record.payload.summary,
        countsByCategory,
        topPlaces,
      },
    }
  }

  if (record.kind === 'uploaded_pin') {
    if (
      !isStringRecord(record.payload) ||
      typeof record.payload.siteLabel !== 'string' ||
      typeof record.payload.lat !== 'number' ||
      typeof record.payload.lng !== 'number' ||
      !isStringRecord(record.payload.rowPreview)
    ) {
      return null
    }
    return {
      id: record.id,
      kind: 'uploaded_pin',
      savedAt: record.savedAt,
      prompt,
      marketLabel,
      payload: {
        siteLabel: record.payload.siteLabel,
        lat: record.payload.lat,
        lng: record.payload.lng,
        sourceLabel: typeof record.payload.sourceLabel === 'string' ? record.payload.sourceLabel : null,
        rowPreview: record.payload.rowPreview,
      },
    }
  }

  return null
}

function normalizeSavedOutputRecords(state: unknown): SavedOutputRecord[] {
  const body =
    isStringRecord(state) && isStringRecord(state.state)
      ? state.state
      : isStringRecord(state)
        ? state
        : null
  if (!body) return []

  const outputs = Array.isArray(body.outputs) ? body.outputs : []
  if (outputs.length > 0) {
    return outputs.flatMap((output) => {
      const normalized = normalizeSavedOutputRecord(output)
      return normalized ? [normalized] : []
    })
  }

  const charts = Array.isArray(body.charts) ? body.charts : []
  return charts.flatMap((chart) => {
    const normalized = normalizeSavedOutputRecord(
      isStringRecord(chart) && isScoutChartOutput(chart.chart)
        ? {
            id: chart.id,
            kind: 'chart',
            savedAt: chart.savedAt,
            prompt: chart.prompt,
            marketLabel: chart.marketLabel ?? null,
            payload: chart.chart,
          }
        : null
    )
    return normalized ? [normalized] : []
  })
}

function buildSavedOutputSignature(input: SaveOutputInput): string {
  switch (input.kind) {
    case 'chart':
      return JSON.stringify({
        kind: input.kind,
        prompt: input.prompt,
        marketLabel: input.marketLabel ?? null,
        payload: normalizeScoutChartOutput(input.payload),
      })
    case 'stat_card':
      return JSON.stringify({
        kind: input.kind,
        prompt: input.prompt,
        marketLabel: input.marketLabel ?? null,
        payload: input.payload,
      })
    case 'permit_detail':
      return JSON.stringify({
        kind: input.kind,
        prompt: input.prompt ?? null,
        marketLabel: input.marketLabel ?? null,
        payload: {
          title: input.payload.title,
          permitLabel: input.payload.permitLabel,
          sourceKind: input.payload.sourceKind,
          sourceName: input.payload.sourceName,
          addressOrPlace: input.payload.addressOrPlace,
          categoryLabel: input.payload.categoryLabel,
          dateLabel: input.payload.dateLabel ?? null,
          sourceUrl: input.payload.sourceUrl ?? null,
          coordinates: input.payload.coordinates ?? null,
          stats: input.payload.stats.map((stat) => ({
            label: stat.label,
            value: stat.value,
            sublabel: stat.sublabel ?? null,
          })),
        },
      })
    case 'places_context':
      return JSON.stringify({
        kind: input.kind,
        marketLabel: input.marketLabel ?? null,
        siteLabel: input.payload.siteLabel,
        lat: input.payload.lat,
        lng: input.payload.lng,
        radiusMeters: input.payload.radiusMeters,
        summary: input.payload.summary,
      })
    case 'uploaded_pin':
      return JSON.stringify({
        kind: input.kind,
        marketLabel: input.marketLabel ?? null,
        siteLabel: input.payload.siteLabel,
        lat: input.payload.lat,
        lng: input.payload.lng,
        sourceLabel: input.payload.sourceLabel ?? null,
        rowPreview: input.payload.rowPreview,
      })
  }
}

function toSavedOutputRecord(input: SaveOutputInput, id = generateSavedOutputId(), savedAt = new Date().toISOString()): SavedOutputRecord {
  switch (input.kind) {
    case 'chart':
      return {
        id,
        kind: 'chart',
        savedAt,
        prompt: input.prompt,
        marketLabel: input.marketLabel ?? null,
        payload: normalizeScoutChartOutput(input.payload),
      }
    case 'stat_card':
      return {
        id,
        kind: 'stat_card',
        savedAt,
        prompt: input.prompt,
        marketLabel: input.marketLabel ?? null,
        payload: {
          title: input.payload.title,
          summary: input.payload.summary ?? null,
          stats: input.payload.stats.map((stat) => ({
            label: stat.label,
            value: stat.value,
            sublabel: stat.sublabel ?? null,
          })),
        },
      }
    case 'permit_detail':
      return {
        id,
        kind: 'permit_detail',
        savedAt,
        prompt: input.prompt ?? null,
        marketLabel: input.marketLabel ?? null,
        payload: {
          title: input.payload.title,
          permitLabel: input.payload.permitLabel,
          sourceKind: input.payload.sourceKind,
          sourceName: input.payload.sourceName,
          addressOrPlace: input.payload.addressOrPlace,
          categoryLabel: input.payload.categoryLabel,
          dateLabel: input.payload.dateLabel ?? null,
          sourceUrl: input.payload.sourceUrl ?? null,
          coordinates: input.payload.coordinates ?? null,
          stats: input.payload.stats.map((stat) => ({
            label: stat.label,
            value: stat.value,
            sublabel: stat.sublabel ?? null,
          })),
        },
      }
    case 'places_context':
      return {
        id,
        kind: 'places_context',
        savedAt,
        prompt: input.prompt ?? null,
        marketLabel: input.marketLabel ?? null,
        payload: {
          siteLabel: input.payload.siteLabel,
          lat: input.payload.lat,
          lng: input.payload.lng,
          radiusMeters: input.payload.radiusMeters,
          summary: input.payload.summary,
          countsByCategory: input.payload.countsByCategory.map((entry) => ({ ...entry })),
          topPlaces: input.payload.topPlaces.map((entry) => ({ ...entry })),
        },
      }
    case 'uploaded_pin':
      return {
        id,
        kind: 'uploaded_pin',
        savedAt,
        prompt: input.prompt ?? null,
        marketLabel: input.marketLabel ?? null,
        payload: {
          siteLabel: input.payload.siteLabel,
          lat: input.payload.lat,
          lng: input.payload.lng,
          sourceLabel: input.payload.sourceLabel ?? null,
          rowPreview: input.payload.rowPreview,
        },
      }
  }
}

function matchesSavedOutput(input: SaveOutputInput, outputs: SavedOutputRecord[]): SavedOutputRecord | null {
  const signature = buildSavedOutputSignature(input)
  return (
    outputs.find((output) => {
      const outputSignature = buildSavedOutputSignature({
        kind: output.kind,
        prompt: 'prompt' in output ? output.prompt ?? null : null,
        marketLabel: output.marketLabel ?? null,
        payload: output.payload as SaveOutputInput['payload'],
      } as SaveOutputInput)
      return outputSignature === signature
    }) ?? null
  )
}

function toSavedChartRecord(output: SavedOutputRecord): SavedChartRecord | null {
  if (output.kind !== 'chart') return null
  return {
    id: output.id,
    chart: output.payload,
    prompt: output.prompt,
    marketLabel: output.marketLabel ?? null,
    savedAt: output.savedAt,
  }
}

export const useSavedChartsStore = create<SavedChartsStore>()(
  persist(
    (set, get) => ({
      outputs: [],
      charts: [],
      saveOutput: (input) => {
        const existing = matchesSavedOutput(input, get().outputs)
        if (existing) return existing.id

        const record = toSavedOutputRecord(input)
        set((state) => {
          const nextOutputs = [record, ...state.outputs]
          return {
            outputs: nextOutputs,
            charts: nextOutputs.flatMap((output) => {
              const chart = toSavedChartRecord(output)
              return chart ? [chart] : []
            }),
          }
        })
        return record.id
      },
      hasSavedOutput: (input) => matchesSavedOutput(input, get().outputs) != null,
      removeOutput: (id) =>
        set((state) => {
          const nextOutputs = state.outputs.filter((output) => output.id !== id)
          return {
            outputs: nextOutputs,
            charts: nextOutputs.flatMap((output) => {
              const chart = toSavedChartRecord(output)
              return chart ? [chart] : []
            }),
          }
        }),
      saveChart: (input) =>
        (() => {
          const existing = matchesSavedChart(input, get().charts)
          if (existing) return existing.id
          return get().saveOutput({
            kind: 'chart',
            prompt: input.prompt,
            marketLabel: input.marketLabel ?? null,
            payload: input.chart,
          })
        })(),
      hasSavedChart: (input) =>
        matchesSavedChart(input, get().charts) != null,
      removeChart: (id) => get().removeOutput(id),
      hasChart: (id) => get().charts.some((chart) => chart.id === id),
      resetForTests: () => set({ outputs: [], charts: [] }),
    }),
    {
      name: SAVED_CHARTS_STORAGE_KEY,
      version: 1,
      storage: createJSONStorage(() => sessionStorage),
      migrate: (persistedState) => persistedState,
      merge: (persistedState, currentState) => {
        const outputs = normalizeSavedOutputRecords(persistedState)
        return {
          ...currentState,
          outputs,
          charts: outputs.flatMap((output) => {
            const chart = toSavedChartRecord(output)
            return chart ? [chart] : []
          }),
        }
      },
      partialize: (state) => ({
        outputs: state.outputs.flatMap((output) => {
          const normalized = normalizeSavedOutputRecord(output)
          return normalized ? [normalized] : []
        }),
        charts: state.charts.map((chart) => ({
          id: chart.id,
          chart: normalizeScoutChartOutput(chart.chart),
          prompt: chart.prompt,
          marketLabel: chart.marketLabel ?? null,
          savedAt: chart.savedAt,
        })),
      }),
    }
  )
)
