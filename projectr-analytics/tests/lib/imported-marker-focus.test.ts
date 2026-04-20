import assert from 'node:assert/strict'
import test from 'node:test'

import {
  buildImportedMarkerSiteContextState,
  planImportedMarkerFocus,
  resolveImportedMarkerSelection,
} from '@/lib/imported-marker-focus'
import { mergeImportedReviewMarkerPoints } from '@/lib/client-upload-presentation'
import { getMergedSessionMarkerPoints } from '@/lib/client-upload-session-aggregate'

test('planImportedMarkerFocus clears focus when there are no imported markers', () => {
  assert.deepEqual(planImportedMarkerFocus([]), { mode: 'clear' })
  assert.deepEqual(planImportedMarkerFocus(null), { mode: 'clear' })
})

test('planImportedMarkerFocus flies directly to a single imported marker', () => {
  assert.deepEqual(planImportedMarkerFocus([{ lat: 30.2672, lng: -97.7431 }]), {
    mode: 'fly',
    target: { lat: 30.2672, lng: -97.7431 },
  })
})

test('planImportedMarkerFocus fits bounds when multiple imported markers are present', () => {
  assert.deepEqual(
    planImportedMarkerFocus([
      { lat: 30.2672, lng: -97.7431 },
      { lat: 30.2501, lng: -97.7494 },
    ]),
    { mode: 'fit' }
  )
})

test('resolveImportedMarkerSelection prefers marker source_key over duplicate file names', () => {
  const selection = resolveImportedMarkerSelection({
    sources: [
      { fileName: 'shared.csv' },
      { fileName: 'shared.csv' },
    ],
    selectedMarker: {
      lat: 30.2672,
      lng: -97.7431,
      label: 'Second import row',
      value: 42,
      file_name: 'shared.csv',
      source_key: 'shared.csv:1',
    },
    preferredSourceKey: null,
  })

  assert.deepEqual(selection, {
    selectedSourceKey: 'shared.csv:1',
    markerBelongsToSelected: true,
  })
})

test('getMergedSessionMarkerPoints preserves duplicate labels from different source keys', () => {
  const session = {
    ingestedAt: '2026-04-20T00:00:00.000Z',
    sources: [
      {
        fileName: 'shared.csv',
        triage: {
          bucket: 'GEOSPATIAL',
          visual_bucket: 'MARKER',
          metric_name: 'Demo metric',
          reasoning: 'demo',
          mapability_classification: 'map_ready',
          fallback_visualization: 'map_layer',
          geo_column: 'address',
          value_column: 'value',
          date_column: null,
          recommended_field_mappings: {},
        },
        rowsIngested: 1,
        previewRows: [],
        markerPoints: [
          {
            lat: 30.2672,
            lng: -97.7431,
            label: 'Same Site',
            value: 1,
            file_name: 'shared.csv',
            source_key: 'shared.csv:0',
          },
        ],
        markerCount: 1,
        mapPinsActive: true,
      },
      {
        fileName: 'shared.csv',
        triage: {
          bucket: 'GEOSPATIAL',
          visual_bucket: 'MARKER',
          metric_name: 'Demo metric',
          reasoning: 'demo',
          mapability_classification: 'map_ready',
          fallback_visualization: 'map_layer',
          geo_column: 'address',
          value_column: 'value',
          date_column: null,
          recommended_field_mappings: {},
        },
        rowsIngested: 1,
        previewRows: [],
        markerPoints: [
          {
            lat: 30.2672,
            lng: -97.7431,
            label: 'Same Site',
            value: 2,
            file_name: 'shared.csv',
            source_key: 'shared.csv:1',
          },
        ],
        markerCount: 1,
        mapPinsActive: true,
      },
    ],
  } as const

  const merged = getMergedSessionMarkerPoints(session)
  assert.equal(merged.length, 2)
  assert.deepEqual(
    merged.map((marker) => marker.source_key),
    ['shared.csv:0', 'shared.csv:1']
  )
})

test('mergeImportedReviewMarkerPoints preserves duplicate labels across files', () => {
  const merged = mergeImportedReviewMarkerPoints(
    [
      {
        marker_points: [
          {
            lat: 30.2672,
            lng: -97.7431,
            label: 'Same Site',
            value: 1,
          },
        ],
      },
      {
        marker_points: [
          {
            lat: 30.2672,
            lng: -97.7431,
            label: 'Same Site',
            value: 2,
          },
        ],
      },
    ],
    ['shared.csv', 'shared.csv']
  )

  assert.equal(merged.length, 2)
  assert.deepEqual(
    merged.map((marker) => marker.source_key),
    ['shared.csv:0', 'shared.csv:1']
  )
})

test('buildImportedMarkerSiteContextState returns idle when there is no selected marker', () => {
  assert.deepEqual(
    buildImportedMarkerSiteContextState({
      marker: null,
      context: null,
      loading: false,
      error: null,
    }),
    { status: 'idle', message: null, context: null }
  )
})

test('buildImportedMarkerSiteContextState returns loading while nearby site context is in flight', () => {
  assert.deepEqual(
    buildImportedMarkerSiteContextState({
      marker: { lat: 30.2672, lng: -97.7431, label: 'Demo site', value: null },
      context: null,
      loading: true,
      error: null,
    }),
    { status: 'loading', message: null, context: null }
  )
})

test('buildImportedMarkerSiteContextState returns ready when cached site context exists', () => {
  const context = {
    radiusMeters: 500,
    summary: 'Within 500m: 1 coffee & cafe.',
    countsByCategory: [{ category: 'coffee_cafe', label: 'Coffee & Cafe', count: 1 }],
    topPlaces: [{ name: 'Merit Coffee', categoryLabel: 'Coffee & Cafe' }],
    source: { provider: 'google_places' as const },
  }

  assert.deepEqual(
    buildImportedMarkerSiteContextState({
      marker: { lat: 30.2672, lng: -97.7431, label: 'Demo site', value: null },
      context,
      loading: false,
      error: null,
    }),
    { status: 'ready', message: null, context }
  )
})

test('buildImportedMarkerSiteContextState returns unavailable for request errors', () => {
  assert.deepEqual(
    buildImportedMarkerSiteContextState({
      marker: { lat: 30.2672, lng: -97.7431, label: 'Demo site', value: null },
      context: null,
      loading: false,
      error: 'Nearby place context is unavailable.',
    }),
    {
      status: 'unavailable',
      message: 'Nearby place context is unavailable.',
      context: null,
    }
  )
})

test('buildImportedMarkerSiteContextState returns empty when the request succeeds with no nearby places', () => {
  const emptyContext = {
    radiusMeters: 500,
    summary: 'No nearby place context found within 500m.',
    countsByCategory: [],
    topPlaces: [],
    source: { provider: 'google_places' as const },
  }

  assert.deepEqual(
    buildImportedMarkerSiteContextState({
      marker: { lat: 30.2672, lng: -97.7431, label: 'Demo site', value: null },
      context: emptyContext,
      loading: false,
      error: null,
    }),
    {
      status: 'empty',
      message: 'No nearby place context found within 500m.',
      context: emptyContext,
    }
  )
})
