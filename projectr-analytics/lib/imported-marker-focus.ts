import type { ClientUploadMarker } from '@/lib/client-upload-markers-store'

export type ImportedMarkerFocusPlan =
  | { mode: 'clear' }
  | { mode: 'fly'; target: { lat: number; lng: number } }
  | { mode: 'fit' }

export function planImportedMarkerFocus(
  markers: Array<Pick<ClientUploadMarker, 'lat' | 'lng'>> | null | undefined
): ImportedMarkerFocusPlan {
  if (!markers || markers.length === 0) return { mode: 'clear' }
  if (markers.length === 1) {
    return {
      mode: 'fly',
      target: {
        lat: markers[0].lat,
        lng: markers[0].lng,
      },
    }
  }
  return { mode: 'fit' }
}
