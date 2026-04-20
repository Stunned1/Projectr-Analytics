import type { ClientUploadMarker } from '@/lib/client-upload-markers-store'
import type { ClientUploadSourcePart } from '@/lib/client-upload-session-store'
import type { SitePlacesContextResponse } from '@/lib/google-places-site-context'
import { getImportedSourceKey } from '@/lib/client-upload-presentation'

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

export function resolveImportedMarkerSelection(args: {
  sources: Array<Pick<ClientUploadSourcePart, 'fileName'>>
  selectedMarker: Pick<ClientUploadMarker, 'source_key'> | null
  preferredSourceKey: string | null
}): {
  selectedSourceKey: string | null
  markerBelongsToSelected: boolean
} {
  if (args.sources.length === 0) {
    return { selectedSourceKey: null, markerBelongsToSelected: false }
  }

  const sourceKeys = args.sources.map((source, index) =>
    getImportedSourceKey(source as ClientUploadSourcePart, index)
  )
  const markerSourceKey = args.selectedMarker?.source_key ?? null
  const selectedSourceKey = sourceKeys.includes(markerSourceKey ?? '')
    ? markerSourceKey
    : sourceKeys.includes(args.preferredSourceKey ?? '')
      ? args.preferredSourceKey
      : sourceKeys[0]

  return {
    selectedSourceKey,
    markerBelongsToSelected: markerSourceKey != null && markerSourceKey === selectedSourceKey,
  }
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
