import { create } from 'zustand'
import { createJSONStorage, persist } from 'zustand/middleware'

export interface Site {
  id: string
  label: string
  zip: string
  lat: number
  lng: number
  marketLabel: string
  isAggregate?: boolean
  savedSearch?: string | null
  cyclePosition?: string
  cycleStage?: string
  momentumScore?: number | null
  notes?: string
  createdAt?: string
}

export function normalizeSavedSearch(q: string): string {
  return q.trim().toLowerCase().replace(/\s+/g, ' ')
}

const SITES_STORAGE_KEY = 'projectr-saved-sites-v2'

function generateSiteId(): string {
  return `site-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`
}

function normalizeSite(value: unknown): Site | null {
  if (!value || typeof value !== 'object') return null
  const record = value as Record<string, unknown>
  if (
    typeof record.id !== 'string' ||
    typeof record.label !== 'string' ||
    typeof record.zip !== 'string' ||
    typeof record.lat !== 'number' ||
    typeof record.lng !== 'number' ||
    !Number.isFinite(record.lat) ||
    !Number.isFinite(record.lng)
  ) {
    return null
  }

  return {
    id: record.id,
    label: record.label,
    zip: record.zip,
    lat: record.lat,
    lng: record.lng,
    marketLabel: typeof record.marketLabel === 'string' ? record.marketLabel : '',
    isAggregate: record.isAggregate === true,
    savedSearch: typeof record.savedSearch === 'string' ? record.savedSearch : null,
    cyclePosition: typeof record.cyclePosition === 'string' ? record.cyclePosition : undefined,
    cycleStage: typeof record.cycleStage === 'string' ? record.cycleStage : undefined,
    momentumScore: typeof record.momentumScore === 'number' && Number.isFinite(record.momentumScore) ? record.momentumScore : null,
    notes: typeof record.notes === 'string' ? record.notes : undefined,
    createdAt: typeof record.createdAt === 'string' ? record.createdAt : undefined,
  }
}

interface SitesStore {
  sites: Site[]
  selectedForComparison: string[]
  loading: boolean
  syncError: string | null
  loadSites: () => Promise<void>
  addSite: (site: Omit<Site, 'id' | 'createdAt'>) => Promise<boolean>
  removeSite: (id: string) => Promise<void>
  updateLabel: (id: string, label: string) => Promise<void>
  updateNotes: (id: string, notes: string) => Promise<void>
  toggleComparison: (id: string) => void
  clearComparisonSelection: () => void
  hasZip: (zip: string) => boolean
  getSiteIdByZip: (zip: string) => string | undefined
  hasAggregateSaved: (searchInput: string) => boolean
  getAggregateSiteId: (searchInput: string) => string | undefined
}

export const useSitesStore = create<SitesStore>()(
  persist(
    (set, get) => ({
      sites: [],
      selectedForComparison: [],
      loading: false,
      syncError: null,

      hasZip: (zip) => get().sites.some((s) => !s.isAggregate && s.zip === zip),

      getSiteIdByZip: (zip) => get().sites.find((s) => !s.isAggregate && s.zip === zip)?.id,

      hasAggregateSaved: (searchInput) => {
        const key = normalizeSavedSearch(searchInput)
        if (!key) return false
        return get().sites.some(
          (s) => s.isAggregate && s.savedSearch && normalizeSavedSearch(s.savedSearch) === key
        )
      },

      getAggregateSiteId: (searchInput) => {
        const key = normalizeSavedSearch(searchInput)
        return get().sites.find(
          (s) => s.isAggregate && s.savedSearch && normalizeSavedSearch(s.savedSearch) === key
        )?.id
      },

      loadSites: async () => {
        set({ loading: false, syncError: null })
      },

      addSite: async (site) => {
        const record: Site = {
          ...site,
          id: generateSiteId(),
          createdAt: new Date().toISOString(),
        }
        set((state) => ({
          sites: [record, ...state.sites.filter((entry) => entry.id !== record.id)],
          syncError: null,
        }))
        return true
      },

      removeSite: async (id) => {
        set((state) => ({
          sites: state.sites.filter((entry) => entry.id !== id),
          selectedForComparison: state.selectedForComparison.filter((entry) => entry !== id),
        }))
      },

      updateLabel: async (id, label) => {
        const trimmed = label.trim()
        if (!trimmed) return
        set((state) => ({
          sites: state.sites.map((entry) => (entry.id === id ? { ...entry, label: trimmed } : entry)),
        }))
      },

      updateNotes: async (id, notes) => {
        set((state) => ({
          sites: state.sites.map((entry) => (entry.id === id ? { ...entry, notes } : entry)),
        }))
      },

      toggleComparison: (id) =>
        set((state) => {
          const on = state.selectedForComparison.includes(id)
          return {
            selectedForComparison: on
              ? state.selectedForComparison.filter((entry) => entry !== id)
              : [...state.selectedForComparison, id],
          }
        }),

      clearComparisonSelection: () => set({ selectedForComparison: [] }),
    }),
    {
      name: SITES_STORAGE_KEY,
      storage: createJSONStorage(() => localStorage),
      partialize: (state) => ({
        sites: state.sites,
        selectedForComparison: state.selectedForComparison,
      }),
      merge: (persisted, current) => {
        const record = persisted as Partial<SitesStore> | null
        const persistedSites = Array.isArray(record?.sites)
          ? record.sites.map(normalizeSite).filter((site): site is Site => site != null)
          : []
        const selectedForComparison = Array.isArray(record?.selectedForComparison)
          ? record.selectedForComparison.filter((entry): entry is string => typeof entry === 'string')
          : []
        return {
          ...current,
          sites: persistedSites,
          selectedForComparison,
          loading: false,
          syncError: null,
        }
      },
    }
  )
)
