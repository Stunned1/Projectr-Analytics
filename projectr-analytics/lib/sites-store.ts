import { create } from 'zustand'
import { supabase } from '@/lib/supabase'

export interface Site {
  id: string
  label: string
  zip: string
  lat: number
  lng: number
  marketLabel: string
  /** City/borough row: replay this exact search to reload the area. */
  isAggregate?: boolean
  savedSearch?: string | null
  cyclePosition?: string
  cycleStage?: string
  momentumScore?: number | null
  notes?: string
  createdAt?: string
}

type SavedSiteRow = {
  id: string
  user_id: string
  label: string
  zip: string
  lat: number | string | null
  lng: number | string | null
  market_label: string | null
  is_aggregate?: boolean | null
  saved_search?: string | null
  cycle_position: string | null
  cycle_stage: string | null
  momentum_score: number | string | null
  notes: string | null
  created_at: string
}

export function normalizeSavedSearch(q: string): string {
  return q.trim().toLowerCase().replace(/\s+/g, ' ')
}

function toNum(v: number | string | null | undefined): number | null {
  if (v == null || v === '') return null
  const n = typeof v === 'number' ? v : Number(v)
  return Number.isFinite(n) ? n : null
}

export function rowToSite(r: SavedSiteRow): Site | null {
  const lat = toNum(r.lat)
  const lng = toNum(r.lng)
  if (lat == null || lng == null) return null
  return {
    id: r.id,
    label: r.label,
    zip: r.zip,
    lat,
    lng,
    marketLabel: r.market_label ?? '',
    isAggregate: Boolean(r.is_aggregate),
    savedSearch: r.saved_search ?? null,
    cyclePosition: r.cycle_position ?? undefined,
    cycleStage: r.cycle_stage ?? undefined,
    momentumScore: toNum(r.momentum_score),
    notes: r.notes ?? undefined,
    createdAt: r.created_at,
  }
}

/** Anonymous sign-in (Supabase Auth → Providers → Anonymous). */
async function ensureAuthUser(): Promise<{ id: string } | null> {
  const { data: first } = await supabase.auth.getSession()
  if (first.session?.user) return first.session.user
  const { data, error } = await supabase.auth.signInAnonymously()
  if (error || !data.session?.user) return null
  return data.session.user
}

interface SitesStore {
  sites: Site[]
  selectedForComparison: string[]
  loading: boolean
  syncError: string | null
  shortlistPanelOpen: boolean
  setShortlistPanelOpen: (open: boolean) => void
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

export const useSitesStore = create<SitesStore>((set, get) => ({
  sites: [],
  selectedForComparison: [],
  loading: false,
  syncError: null,
  shortlistPanelOpen: true,

  setShortlistPanelOpen: (open) => set({ shortlistPanelOpen: open }),

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
    set({ loading: true, syncError: null })
    try {
      const user = await ensureAuthUser()
      if (!user) {
        set({
          sites: [],
          loading: false,
          syncError: 'Sign in unavailable — enable Anonymous sign-ins in Supabase Auth (Authentication → Providers).',
        })
        return
      }
      const { data, error } = await supabase
        .from('saved_sites')
        .select('*')
        .order('created_at', { ascending: false })
      if (error) throw new Error(error.message)
      const rows = (data ?? []) as SavedSiteRow[]
      const sites = rows.map(rowToSite).filter((s): s is Site => s != null)
      set({ sites, loading: false, syncError: null })
    } catch (e) {
      const msg = e instanceof Error ? e.message : 'Could not load shortlist'
      set({ sites: [], loading: false, syncError: msg })
    }
  },

  addSite: async (site) => {
    const user = await ensureAuthUser()
    if (!user) {
      set({
        syncError: 'Cannot save — enable Anonymous sign-ins in Supabase Auth (Authentication → Providers).',
      })
      return false
    }
    const row = {
      user_id: user.id,
      label: site.label,
      zip: site.zip,
      lat: site.lat,
      lng: site.lng,
      market_label: site.marketLabel || null,
      is_aggregate: site.isAggregate ?? false,
      saved_search: site.savedSearch ?? null,
      cycle_position: site.cyclePosition ?? null,
      cycle_stage: site.cycleStage ?? null,
      momentum_score: site.momentumScore ?? null,
      notes: site.notes ?? null,
    }
    const { data, error } = await supabase.from('saved_sites').insert(row).select('*').single()
    if (error) {
      set({ syncError: error.message })
      return false
    }
    const mapped = rowToSite(data as SavedSiteRow)
    if (mapped) set((s) => ({ sites: [mapped, ...s.sites.filter((x) => x.id !== mapped.id)], syncError: null }))
    return true
  },

  removeSite: async (id) => {
    const prev = get().sites
    set((s) => ({
      sites: s.sites.filter((x) => x.id !== id),
      selectedForComparison: s.selectedForComparison.filter((x) => x !== id),
    }))
    const { error } = await supabase.from('saved_sites').delete().eq('id', id)
    if (error) {
      set({ sites: prev, syncError: error.message })
    }
  },

  updateLabel: async (id, label) => {
    const trimmed = label.trim()
    if (!trimmed) return
    set((s) => ({
      sites: s.sites.map((x) => (x.id === id ? { ...x, label: trimmed } : x)),
    }))
    const { error } = await supabase.from('saved_sites').update({ label: trimmed }).eq('id', id)
    if (error) set({ syncError: error.message })
  },

  updateNotes: async (id, notes) => {
    set((s) => ({
      sites: s.sites.map((x) => (x.id === id ? { ...x, notes } : x)),
    }))
    const { error } = await supabase.from('saved_sites').update({ notes }).eq('id', id)
    if (error) set({ syncError: error.message })
  },

  toggleComparison: (id) =>
    set((s) => {
      const on = s.selectedForComparison.includes(id)
      const selectedForComparison = on
        ? s.selectedForComparison.filter((x) => x !== id)
        : [...s.selectedForComparison, id]
      return { selectedForComparison }
    }),

  clearComparisonSelection: () => set({ selectedForComparison: [] }),
}))
