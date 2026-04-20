import type { ClientUploadMarker } from '@/lib/client-upload-markers-store'
import type { SitePlacesContextResponse } from '@/lib/google-places-site-context'

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

export type ImportedMarkerSiteContextState =
  | { status: 'idle'; message: null; context: null }
  | { status: 'loading'; message: null; context: null }
  | { status: 'unavailable'; message: string; context: null }
  | { status: 'empty'; message: string; context: SitePlacesContextResponse }
  | { status: 'ready'; message: null; context: SitePlacesContextResponse }

export function buildImportedMarkerSiteContextState(args: {
  marker: ClientUploadMarker | null
  context: SitePlacesContextResponse | null
  loading: boolean
  error: string | null
}): ImportedMarkerSiteContextState {
  if (!args.marker) {
    return { status: 'idle', message: null, context: null }
  }

  if (args.loading) {
    return { status: 'loading', message: null, context: null }
  }

  if (args.error) {
    return { status: 'unavailable', message: args.error, context: null }
  }

  if (!args.context) {
    return { status: 'loading', message: null, context: null }
  }

  if (args.context.countsByCategory.length === 0 && args.context.topPlaces.length === 0) {
    return {
      status: 'empty',
      message: args.context.summary,
      context: args.context,
    }
  }

  return {
    status: 'ready',
    message: null,
    context: args.context,
  }
}
