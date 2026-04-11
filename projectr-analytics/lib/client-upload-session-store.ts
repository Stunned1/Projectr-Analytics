import { create } from 'zustand'
import { createJSONStorage, persist } from 'zustand/middleware'

export type ClientUploadTriageSnapshot = {
  bucket: string
  visual_bucket: string
  metric_name: string
  reasoning: string
  geo_column: string | null
  value_column: string | null
  date_column: string | null
}

export type ClientUploadPreviewRow = {
  submarket_id: string | null
  metric_name: string
  metric_value: number | null
  time_period: string | null
  visual_bucket: string
}

/** One normalized CSV in a batch (single- or multi-file ingest). */
export type ClientUploadSourcePart = {
  fileName: string | null
  triage: ClientUploadTriageSnapshot
  rowsIngested: number
  previewRows: ClientUploadPreviewRow[]
  markerCount: number
  mapPinsActive: boolean
  mapEligible?: boolean
}

/** Multi-file ingest: one `sources` entry per CSV. */
export type ClientUploadSessionNew = {
  ingestedAt: string
  sources: ClientUploadSourcePart[]
}

/** v0 persisted shape (single file) — still rehydrates from sessionStorage until user re-uploads. */
export type ClientUploadSessionLegacy = {
  fileName: string | null
  ingestedAt: string
  triage: ClientUploadTriageSnapshot
  rowsIngested: number
  previewRows: ClientUploadPreviewRow[]
  markerCount: number
  mapPinsActive: boolean
  mapEligible?: boolean
}

export type ClientUploadSession = ClientUploadSessionNew | ClientUploadSessionLegacy

interface ClientUploadSessionState {
  session: ClientUploadSession | null
  setSession: (s: ClientUploadSession | null) => void
  clearSession: () => void
}

export const useClientUploadSessionStore = create<ClientUploadSessionState>()(
  persist(
    (set) => ({
      session: null,
      setSession: (session) => set({ session }),
      clearSession: () => set({ session: null }),
    }),
    {
      name: 'projectr-client-upload-session',
      storage: createJSONStorage(() => sessionStorage),
    }
  )
)
