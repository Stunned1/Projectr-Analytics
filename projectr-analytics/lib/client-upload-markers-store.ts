import { create } from 'zustand'
import { persist, createJSONStorage } from 'zustand/middleware'
import type { UploadRawRow } from '@/lib/upload/types'

export type ClientUploadMarker = {
  lat: number
  lng: number
  label: string
  value: number | null
  source_key?: string | null
  file_name?: string | null
  metric_name?: string | null
  submarket_id?: string | null
  time_period?: string | null
  row_preview?: UploadRawRow
}

interface ClientUploadMarkersState {
  markers: ClientUploadMarker[] | null
  setMarkers: (markers: ClientUploadMarker[] | null) => void
  clearMarkers: () => void
}

export const useClientUploadMarkersStore = create<ClientUploadMarkersState>()(
  persist(
    (set) => ({
      markers: null,
      setMarkers: (markers) => set({ markers }),
      clearMarkers: () => set({ markers: null }),
    }),
    {
      name: 'projectr-client-upload-markers',
      storage: createJSONStorage(() => sessionStorage),
    }
  )
)
