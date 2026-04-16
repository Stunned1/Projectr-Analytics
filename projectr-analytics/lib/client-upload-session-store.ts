import { create } from 'zustand'
import { createJSONStorage, persist } from 'zustand/middleware'
import type {
  ClientCsvTriage,
  ClientNormalizePreviewRow,
} from '@/lib/normalize-client-types'
import type { UploadParseSummary } from '@/lib/upload/types'

export type ClientUploadTriageSnapshot = ClientCsvTriage

export type ClientUploadPreviewRow = ClientNormalizePreviewRow

/** One normalized CSV in a batch (single- or multi-file ingest). */
export type ClientUploadSourcePart = {
  fileName: string | null
  triage: ClientUploadTriageSnapshot
  rowsIngested: number
  previewRows: ClientUploadPreviewRow[]
  parseSummary?: UploadParseSummary
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
  parseSummary?: UploadParseSummary
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
