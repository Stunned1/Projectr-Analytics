import { create } from 'zustand'
import { createJSONStorage, persist } from 'zustand/middleware'
import type {
  ClientCsvTriage,
  ClientNormalizeMarkerPoint,
  ClientNormalizeRawTable,
  ClientNormalizePreviewRow,
} from '@/lib/normalize-client-types'
import type { UploadParseSummary } from '@/lib/upload/types'

export type ClientUploadTriageSnapshot = ClientCsvTriage

export type ClientUploadPreviewRow = ClientNormalizePreviewRow

export type ClientUploadWorkflowStatus = 'mapped' | 'sidebar_only' | 'errored'

export type ClientUploadVisualizationMode = 'map' | 'chart' | 'table'

export interface ClientUploadNormalizationState {
  status: 'idle' | 'resolving' | 'resolved' | 'failed'
  attemptedCount: number
  resolvedCount: number
  failedCount: number
  lastRunAt: string | null
  message?: string | null
}

/** One normalized CSV in a batch (single- or multi-file ingest). */
export type ClientUploadSourcePart = {
  fileName: string | null
  triage: ClientUploadTriageSnapshot
  rowsIngested: number
  previewRows: ClientUploadPreviewRow[]
  parseSummary?: UploadParseSummary
  rawTable?: ClientNormalizeRawTable
  markerPoints?: ClientNormalizeMarkerPoint[]
  markerCount: number
  mapPinsActive: boolean
  mapEligible?: boolean
  workflowStatus?: ClientUploadWorkflowStatus
  visualizationMode?: ClientUploadVisualizationMode
  persistenceWarning?: string | null
  normalization?: ClientUploadNormalizationState
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
  rawTable?: ClientNormalizeRawTable
  markerPoints?: ClientNormalizeMarkerPoint[]
  markerCount: number
  mapPinsActive: boolean
  mapEligible?: boolean
  workflowStatus?: ClientUploadWorkflowStatus
  visualizationMode?: ClientUploadVisualizationMode
  persistenceWarning?: string | null
  normalization?: ClientUploadNormalizationState
}

export type ClientUploadSession = ClientUploadSessionNew | ClientUploadSessionLegacy

interface ClientUploadSessionState {
  session: ClientUploadSession | null
  setSession: (s: ClientUploadSession | null) => void
  updateSession: (updater: (session: ClientUploadSession | null) => ClientUploadSession | null) => void
  clearSession: () => void
}

export const useClientUploadSessionStore = create<ClientUploadSessionState>()(
  persist(
    (set) => ({
      session: null,
      setSession: (session) => set({ session }),
      updateSession: (updater) => set((state) => ({ session: updater(state.session) })),
      clearSession: () => set({ session: null }),
    }),
    {
      name: 'projectr-client-upload-session',
      storage: createJSONStorage(() => sessionStorage),
    }
  )
)
