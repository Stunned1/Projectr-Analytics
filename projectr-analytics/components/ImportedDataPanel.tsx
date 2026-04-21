'use client'

import { useCallback, useEffect, useMemo, useState } from 'react'
import { useClientUploadMarkersStore, type ClientUploadMarker } from '@/lib/client-upload-markers-store'
import { getClientUploadWorkingRows } from '@/lib/client-upload-working-rows'
import { buildImportedResolvePreview, resolveImportedSourceToMarkers } from '@/lib/client-upload-map-resolver'
import {
  attachImportedMarkerSourceKey,
  buildImportedSummaryStats,
  formatImportedCell,
  getImportedSourceKey,
  isImportedWorkingRowsHydrating,
} from '@/lib/client-upload-presentation'
import { useClientUploadSessionStore, type ClientUploadSession } from '@/lib/client-upload-session-store'
import {
  getMergedSessionMarkerPoints,
  getSessionSources,
  updateSessionSourceAtIndex,
} from '@/lib/client-upload-session-aggregate'
import { useSiteContextStore } from '@/lib/site-context-store'
import {
  buildImportedMarkerSiteContextState,
  resolveImportedMarkerSelection,
} from '@/lib/imported-marker-focus'
import type { SitePlacesContextResponse } from '@/lib/google-places-site-context'

const SITE_CONTEXT_RADIUS_METERS = 500

const MAPABILITY_LABELS: Record<string, string> = {
  map_ready: 'Ready for map',
  map_normalizable: 'Needs map normalization',
  non_map_visualizable: 'Sidebar only',
  unusable: 'Unusable',
}

const FALLBACK_LABELS: Record<string, string> = {
  map_layer: 'Map layer',
  raw_table: 'Raw table',
  time_series_chart: 'Time-series chart',
  bar_chart: 'Bar chart',
  summary_cards: 'Summary cards',
  table_then_chart: 'Table first',
  none: 'No safe fallback',
}

const WORKFLOW_STATUS_LABELS: Record<string, string> = {
  mapped: 'Mapped',
  sidebar_only: 'Sidebar only',
  errored: 'Errored',
}

function SourceBadge({ label }: { label: string }) {
  return <span className="rounded bg-white/6 px-1.5 py-0.5 text-[9px] text-zinc-300">{label}</span>
}

function SelectedMarkerDetail({
  marker,
  onClear,
}: {
  marker: ClientUploadMarker
  onClear?: (() => void) | null
}) {
  const fields = Object.entries(marker.row_preview ?? {})
  if (fields.length === 0) return null

  return (
    <div className="rounded-lg border border-primary/20 bg-primary/10 p-3">
      <div className="mb-2 flex items-start justify-between gap-2">
        <div>
          <p className="text-[10px] font-semibold uppercase tracking-widest text-primary">Selected map record</p>
          <p className="text-xs font-medium text-white">{marker.label}</p>
        </div>
        {onClear ? (
          <button
            type="button"
            onClick={onClear}
            className="text-[10px] text-zinc-400 transition-colors hover:text-white"
          >
            Clear
          </button>
        ) : null}
      </div>
      <div className="grid grid-cols-2 gap-2 text-[10px]">
        {fields.map(([key, value]) => (
          <div key={key} className="rounded bg-white/6 px-2 py-1">
            <p className="text-zinc-500">{key}</p>
            <p className="break-words text-white">{formatImportedCell(value)}</p>
          </div>
        ))}
      </div>
    </div>
  )
}

export function ImportedDataPanel({
  session,
  selectedMarker = null,
  onClearSelectedMarker,
  currentZip = null,
  onMarkersResolved,
}: {
  session: ClientUploadSession | null
  selectedMarker?: ClientUploadMarker | null
  onClearSelectedMarker?: (() => void) | null
  currentZip?: string | null
  onMarkersResolved?: ((markers: ClientUploadMarker[]) => void) | null
}) {
  const updateSession = useClientUploadSessionStore((state) => state.updateSession)
  const setMarkers = useClientUploadMarkersStore((state) => state.setMarkers)
  const sources = useMemo(() => (session ? getSessionSources(session) : []), [session])
  const [preferredSourceKey, setPreferredSourceKey] = useState<string | null>(null)
  const [resolvingSourceKey, setResolvingSourceKey] = useState<string | null>(null)
  const [resolveError, setResolveError] = useState<string | null>(null)
  const [hydratingRowsSourceKey, setHydratingRowsSourceKey] = useState<string | null>(null)
  const [workingRowsError, setWorkingRowsError] = useState<string | null>(null)
  const [selectedMarkerSiteContext, setSelectedMarkerSiteContext] = useState<SitePlacesContextResponse | null>(null)
  const [selectedMarkerSiteContextLoading, setSelectedMarkerSiteContextLoading] = useState(false)
  const [selectedMarkerSiteContextError, setSelectedMarkerSiteContextError] = useState<string | null>(null)
  const { selectedSourceKey, markerBelongsToSelected } = resolveImportedMarkerSelection({
    sources,
    selectedMarker,
    preferredSourceKey,
  })

  const selectedSource =
    sources.find((source, index) => getImportedSourceKey(source, index) === selectedSourceKey) ?? null
  const selectedSourceIndex = sources.findIndex(
    (source, index) => getImportedSourceKey(source, index) === selectedSourceKey
  )
  const summaryStats = selectedSource ? buildImportedSummaryStats(selectedSource) : []
  const selectedSourceNeedsWorkingRows = selectedSource ? isImportedWorkingRowsHydrating(selectedSource) : false
  const rowsHydrationInFlight = hydratingRowsSourceKey === selectedSourceKey
  const resolvePreview = useMemo(
    () =>
      selectedSource
        ? buildImportedResolvePreview(selectedSource, currentZip)
        : { totalRows: 0, candidateRows: 0, directCoordinateRows: 0, requestRows: 0, uniqueRequestRows: 0 },
    [currentZip, selectedSource]
  )
  const resolveInFlight = resolvingSourceKey === selectedSourceKey
  const siteContextStore = useSiteContextStore.getState()
  const selectedMarkerSiteContextKey =
    markerBelongsToSelected && selectedMarker
      ? siteContextStore.buildKey({
          lat: selectedMarker.lat,
          lng: selectedMarker.lng,
          radiusMeters: SITE_CONTEXT_RADIUS_METERS,
        })
      : null

  useEffect(() => {
    if (!selectedMarkerSiteContextKey || !selectedMarker) {
      setSelectedMarkerSiteContext(null)
      setSelectedMarkerSiteContextLoading(false)
      setSelectedMarkerSiteContextError(null)
      return
    }

    const input = {
      lat: selectedMarker.lat,
      lng: selectedMarker.lng,
      radiusMeters: SITE_CONTEXT_RADIUS_METERS,
    }
    const cached = siteContextStore.read(input)
    if (cached) {
      setSelectedMarkerSiteContext(cached)
      setSelectedMarkerSiteContextLoading(false)
      setSelectedMarkerSiteContextError(null)
      return
    }

    let cancelled = false
    setSelectedMarkerSiteContext(null)
    setSelectedMarkerSiteContextLoading(true)
    setSelectedMarkerSiteContextError(null)

    void fetch(
      `/api/site-context/places?lat=${encodeURIComponent(String(selectedMarker.lat))}&lng=${encodeURIComponent(
        String(selectedMarker.lng)
      )}&radius=${SITE_CONTEXT_RADIUS_METERS}`
    )
      .then(async (response) => {
        const payload = (await response.json().catch(() => null)) as SitePlacesContextResponse | { error?: string } | null
        if (!response.ok) {
          throw new Error(
            payload && typeof payload === 'object' && 'error' in payload && typeof payload.error === 'string'
              ? payload.error
              : 'Nearby place context is unavailable.'
          )
        }
        return payload as SitePlacesContextResponse
      })
      .then((payload) => {
        if (cancelled) return
        siteContextStore.write(input, payload)
        setSelectedMarkerSiteContext(payload)
      })
      .catch((error) => {
        if (cancelled) return
        setSelectedMarkerSiteContextError(
          error instanceof Error ? error.message : 'Nearby place context is unavailable.'
        )
      })
      .finally(() => {
        if (cancelled) return
        setSelectedMarkerSiteContextLoading(false)
      })

    return () => {
      cancelled = true
    }
  }, [markerBelongsToSelected, selectedMarker, selectedMarkerSiteContextKey, siteContextStore])

  const selectedMarkerSiteContextState = buildImportedMarkerSiteContextState({
    marker: markerBelongsToSelected ? selectedMarker : null,
    context: selectedMarkerSiteContext,
    loading: selectedMarkerSiteContextLoading,
    error: selectedMarkerSiteContextError,
  })

  useEffect(() => {
    if (
      selectedSourceIndex < 0 ||
      !selectedSourceKey ||
      !selectedSource?.workingRowsKey ||
      !selectedSourceNeedsWorkingRows
    ) {
      return
    }

    let cancelled = false
    setHydratingRowsSourceKey(selectedSourceKey)
    setWorkingRowsError(null)

    void getClientUploadWorkingRows(selectedSource.workingRowsKey)
      .then((rows) => {
        if (cancelled) return

        if (rows && rows.length > 0) {
          updateSession((currentSession) =>
            updateSessionSourceAtIndex(currentSession, selectedSourceIndex, (source) => ({
              ...source,
              workingRows: rows,
            }))
          )
          return
        }

        const message =
          'Full imported rows could not be restored after reload, so Scout is falling back to preview rows only.'
        setWorkingRowsError(message)
        updateSession((currentSession) =>
          updateSessionSourceAtIndex(currentSession, selectedSourceIndex, (source) => ({
            ...source,
            workingRowsKey: null,
            persistenceWarning: [source.persistenceWarning, message].filter(Boolean).join(' ') || null,
          }))
        )
      })
      .catch(() => {
        if (cancelled) return

        const message =
          'Scout could not reopen the full imported dataset from browser storage, so preview rows are being used instead.'
        setWorkingRowsError(message)
        updateSession((currentSession) =>
          updateSessionSourceAtIndex(currentSession, selectedSourceIndex, (source) => ({
            ...source,
            workingRowsKey: null,
            persistenceWarning: [source.persistenceWarning, message].filter(Boolean).join(' ') || null,
          }))
        )
      })
      .finally(() => {
        if (cancelled) return
        setHydratingRowsSourceKey((currentKey) => (currentKey === selectedSourceKey ? null : currentKey))
      })

    return () => {
      cancelled = true
    }
  }, [selectedSource, selectedSourceIndex, selectedSourceKey, selectedSourceNeedsWorkingRows, updateSession])

  const handleResolveGeography = useCallback(async () => {
    if (selectedSourceIndex < 0 || !selectedSourceKey || !selectedSource) return

    setResolvingSourceKey(selectedSourceKey)
    setResolveError(null)
    updateSession((currentSession) =>
      updateSessionSourceAtIndex(currentSession, selectedSourceIndex, (source) => ({
        ...source,
        normalization: {
          ...(source.normalization ?? {
            status: 'idle',
            attemptedCount: 0,
            resolvedCount: 0,
            failedCount: 0,
            lastRunAt: null,
            message: null,
          }),
          status: 'resolving',
          message: 'Resolving geography for map rendering...',
        },
      }))
    )

    try {
      const resolved = await resolveImportedSourceToMarkers({
        source: selectedSource,
        sourceKey: selectedSourceKey,
        currentZip,
      })
      const markers = attachImportedMarkerSourceKey(resolved.markers, selectedSourceKey)

      updateSession((currentSession) =>
        updateSessionSourceAtIndex(currentSession, selectedSourceIndex, (source) => {
          const inferredMapEligible =
            source.triage.mapability_classification === 'map_ready' ||
            source.triage.mapability_classification === 'map_normalizable'
          const mapEligible = source.mapEligible === true || inferredMapEligible
          return {
            ...source,
            markerPoints: markers,
            markerCount: markers.length,
            mapPinsActive: markers.length > 0,
            mapEligible,
            workflowStatus:
              markers.length > 0
                ? 'mapped'
                : resolved.normalization.status === 'failed'
                  ? 'errored'
                  : 'sidebar_only',
            visualizationMode: 'map',
            normalization: resolved.normalization,
            persistenceWarning: source.persistenceWarning ?? null,
          }
        })
      )

      const nextSession = useClientUploadSessionStore.getState().session
      const mergedMarkers = getMergedSessionMarkerPoints(nextSession)
      setMarkers(mergedMarkers.length > 0 ? mergedMarkers : null)

      if (markers.length > 0) {
        onMarkersResolved?.(mergedMarkers)
      }

      if (resolved.normalization.status === 'failed') {
        setResolveError(resolved.normalization.message ?? 'Scout could not normalize this dataset for the map.')
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Scout could not normalize this dataset for the map.'
      setResolveError(message)
      updateSession((currentSession) =>
        updateSessionSourceAtIndex(currentSession, selectedSourceIndex, (source) => ({
          ...source,
          workflowStatus: 'errored',
          normalization: {
            status: 'failed',
            attemptedCount: source.normalization?.attemptedCount ?? 0,
            resolvedCount: source.normalization?.resolvedCount ?? 0,
            failedCount: source.normalization?.failedCount ?? 0,
            lastRunAt: new Date().toISOString(),
            message,
          },
        }))
      )
    } finally {
      setResolvingSourceKey(null)
    }
  }, [currentZip, onMarkersResolved, selectedSource, selectedSourceIndex, selectedSourceKey, setMarkers, updateSession])

  if (!selectedSource) return null

  return (
    <div className="space-y-4">
      <div>
        <div className="flex flex-wrap items-center gap-2">
          <SourceBadge
            label={
              WORKFLOW_STATUS_LABELS[selectedSource.workflowStatus ?? 'sidebar_only'] ??
              (selectedSource.workflowStatus ?? 'sidebar_only')
            }
          />
          <SourceBadge
            label={
              MAPABILITY_LABELS[selectedSource.triage.mapability_classification] ??
              selectedSource.triage.mapability_classification
            }
          />
          <SourceBadge
            label={
              FALLBACK_LABELS[selectedSource.triage.fallback_visualization] ??
              selectedSource.triage.fallback_visualization
            }
          />
          <SourceBadge label={`${(selectedSource.triage.confidence * 100).toFixed(0)}% confidence`} />
        </div>
        <p className="mt-2 text-sm font-semibold text-white">{selectedSource.fileName ?? selectedSource.triage.metric_name}</p>
        <p className="mt-1 text-[10px] text-zinc-500">
          Imported {new Date(session?.ingestedAt ?? Date.now()).toLocaleString()} · {selectedSource.triage.inferred_dataset_type}
        </p>
        <p className="mt-1 text-[11px] leading-relaxed text-zinc-400">{selectedSource.triage.explanation}</p>
      </div>

      {sources.length > 1 ? (
        <div className="flex flex-wrap gap-2">
          {sources.map((source, index) => {
            const key = getImportedSourceKey(source, index)
            const active = key === selectedSourceKey
            return (
              <button
                key={key}
                type="button"
                onClick={() => {
                  setPreferredSourceKey(key)
                  setResolveError(null)
                  setWorkingRowsError(null)
                }}
                className={`rounded-full border px-2.5 py-1 text-[10px] transition-colors ${
                  active
                    ? 'border-primary/45 bg-primary/10 text-primary'
                    : 'border-white/10 text-zinc-400 hover:border-white/20 hover:text-white'
                }`}
              >
                {(source.fileName ?? `Import ${index + 1}`) + ' · ' + (WORKFLOW_STATUS_LABELS[source.workflowStatus ?? 'sidebar_only'] ?? 'Sidebar only')}
              </button>
            )
          })}
        </div>
      ) : null}

      <div className="grid grid-cols-2 gap-2">
        {summaryStats.map((stat) => (
          <div key={stat.label} className="rounded-lg border border-border/50 bg-muted/10 px-3 py-2">
            <p className="text-[9px] uppercase tracking-wider text-zinc-500">{stat.label}</p>
            <p className="text-sm font-semibold text-white">{stat.value}</p>
            {stat.sub ? <p className="text-[10px] text-zinc-500">{stat.sub}</p> : null}
          </div>
        ))}
      </div>

      {(selectedSource.persistenceWarning || selectedSource.triage.warnings.length > 0 || rowsHydrationInFlight || workingRowsError) ? (
        <div className="rounded-lg border border-amber-900/40 bg-amber-950/20 px-3 py-2 text-[10px] text-amber-200">
          {rowsHydrationInFlight
            ? 'Loading the full imported dataset from browser storage...'
            : workingRowsError ?? selectedSource.persistenceWarning ?? selectedSource.triage.warnings[0]}
        </div>
      ) : null}

      {selectedSource.triage.mapability_classification === 'map_normalizable' ? (
        <div className="rounded-lg border border-primary/20 bg-primary/5 px-3 py-3">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div className="min-w-0">
              <p className="text-[10px] font-semibold uppercase tracking-widest text-primary/80">
                Normalize For Map
              </p>
              <p className="mt-1 text-[11px] leading-relaxed text-zinc-300">
                {resolvePreview.candidateRows.toLocaleString()} of {resolvePreview.totalRows.toLocaleString()} row
                {resolvePreview.totalRows === 1 ? '' : 's'} expose coordinates, ZIPs, or address clues that Scout can try
                to normalize for map rendering.
              </p>
              <p className="mt-1 text-[10px] text-zinc-500">
                {resolvePreview.directCoordinateRows.toLocaleString()} direct coordinate row
                {resolvePreview.directCoordinateRows === 1 ? '' : 's'} · {resolvePreview.uniqueRequestRows.toLocaleString()} unique
                geography lookup{resolvePreview.uniqueRequestRows === 1 ? '' : 's'}
              </p>
            </div>
            <button
              type="button"
              disabled={resolveInFlight || rowsHydrationInFlight || resolvePreview.candidateRows === 0}
              onClick={() => void handleResolveGeography()}
              className="rounded-md border border-primary/35 bg-primary/10 px-3 py-1.5 text-[11px] font-semibold text-primary transition-colors hover:bg-primary/20 disabled:cursor-not-allowed disabled:opacity-50"
            >
              {rowsHydrationInFlight
                ? 'Loading rows...'
                : resolveInFlight
                  ? 'Resolving...'
                  : selectedSource.normalization?.status === 'resolved'
                    ? 'Re-run geography normalization'
                    : 'Resolve geography'}
            </button>
          </div>

          {(selectedSource.normalization?.status === 'resolved' ||
            selectedSource.normalization?.status === 'failed' ||
            resolveError) ? (
            <div className="mt-3 rounded-md border border-white/10 bg-white/5 px-3 py-2 text-[10px] text-zinc-300">
              <p className="font-medium text-white">
                {selectedSource.normalization?.resolvedCount?.toLocaleString() ?? 0} resolved ·{' '}
                {selectedSource.normalization?.failedCount?.toLocaleString() ?? 0} unresolved
              </p>
              <p className="mt-1 text-zinc-400">
                {resolveError ?? selectedSource.normalization?.message ?? 'Scout has not attempted geography normalization yet.'}
              </p>
            </div>
          ) : null}
        </div>
      ) : null}

      {markerBelongsToSelected && selectedMarker ? (
        <>
          <SelectedMarkerDetail marker={selectedMarker} onClear={onClearSelectedMarker} />
          <div className="rounded-lg border border-border/50 bg-muted/10 p-3">
            <p className="text-[10px] font-semibold uppercase tracking-widest text-zinc-500">Around this site</p>
            {selectedMarkerSiteContextState.status === 'loading' ? (
              <p className="mt-2 text-[11px] text-zinc-400">Loading nearby place context...</p>
            ) : null}
            {selectedMarkerSiteContextState.status === 'unavailable' ? (
              <p className="mt-2 text-[11px] text-zinc-400">{selectedMarkerSiteContextState.message}</p>
            ) : null}
            {selectedMarkerSiteContextState.status === 'empty' ? (
              <p className="mt-2 text-[11px] text-zinc-400">{selectedMarkerSiteContextState.message}</p>
            ) : null}
            {selectedMarkerSiteContextState.status === 'ready' ? (
              <div className="mt-2 space-y-3">
                <p className="text-[11px] leading-relaxed text-zinc-300">
                  {selectedMarkerSiteContextState.context.summary}
                </p>
                <div className="flex flex-wrap gap-2">
                  {selectedMarkerSiteContextState.context.countsByCategory.map((entry) => (
                    <span
                      key={entry.category}
                      className="rounded-full border border-white/10 px-2 py-1 text-[10px] text-zinc-300"
                    >
                      {entry.label}: {entry.count}
                    </span>
                  ))}
                </div>
                <div className="space-y-1">
                  {selectedMarkerSiteContextState.context.topPlaces.map((place) => (
                    <p key={`${place.name}:${place.categoryLabel}`} className="text-[11px] text-zinc-400">
                      <span className="text-zinc-200">{place.name}</span> · {place.categoryLabel}
                    </p>
                  ))}
                </div>
              </div>
            ) : null}
          </div>
        </>
      ) : null}

      {selectedSource.mapPinsActive ? (
        <div className="rounded-lg border border-border/50 bg-muted/10 px-3 py-3 text-[11px] leading-relaxed text-zinc-400">
          <p className="font-medium text-white">
            {selectedSource.markerCount.toLocaleString()} imported pin
            {selectedSource.markerCount === 1 ? '' : 's'} are active on the <span className="text-primary">Client</span> map layer.
          </p>
          <p className="mt-1">
            Click a pin on the map to inspect its imported record here. The imported layer stays isolated from the market
            aggregate state and can be toggled off independently.
          </p>
        </div>
      ) : (
        <div className="rounded-lg border border-border/50 bg-muted/10 px-3 py-3 text-[11px] leading-relaxed text-zinc-400">
          <p className="font-medium text-white">Map view unavailable</p>
          <p className="mt-1">
            This dataset does not have usable mapped rows in the sidebar.
          </p>
        </div>
      )}
    </div>
  )
}
