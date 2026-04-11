import { create } from 'zustand'
import { persist, createJSONStorage } from 'zustand/middleware'

export type ClientUploadMarker = { lat: number; lng: number; label: string; value: number | null }

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
      name: 'scout-client-upload-markers',
      storage: createJSONStorage(() => sessionStorage),
    }
  )
)
