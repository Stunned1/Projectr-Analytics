import test from 'node:test'
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'

import { buildSavedOutputRenderGroups } from '@/lib/report/saved-charts-pdf-document'
import type { SavedOutputPdfRecord } from '@/lib/report/saved-charts-export'

test('groups uploaded pin and nearby context for the same site onto one render page', () => {
  const records: SavedOutputPdfRecord[] = [
    {
      id: 'pin-1',
      kind: 'uploaded_pin',
      savedAt: '2026-04-20T12:00:00.000Z',
      marketLabel: 'Austin, TX',
      payload: {
        siteLabel: 'South Lamar candidate',
        lat: 30.25012,
        lng: -97.76543,
        sourceLabel: 'sites.csv',
        rowPreview: { Address: '111 Example St' },
      },
    },
    {
      id: 'places-1',
      kind: 'places_context',
      savedAt: '2026-04-20T12:01:00.000Z',
      marketLabel: 'Austin, TX',
      payload: {
        siteLabel: 'South Lamar candidate',
        lat: 30.25012,
        lng: -97.76543,
        radiusMeters: 500,
        summary: 'Within 500m: 3 essentials.',
        countsByCategory: [{ category: 'essentials', label: 'Essentials', count: 3 }],
        topPlaces: [{ name: 'HEB', categoryLabel: 'Essentials' }],
      },
    },
  ]

  const groups = buildSavedOutputRenderGroups(records)

  assert.equal(groups.length, 1)
  assert.equal(groups[0]?.kind, 'site')
  if (groups[0]?.kind !== 'site') return
  assert.equal(groups[0].siteLabel, 'South Lamar candidate')
  assert.equal(groups[0].uploadedPin.id, 'pin-1')
  assert.equal(groups[0].placesContext?.id, 'places-1')
})

test('leaves unrelated site outputs on separate render pages', () => {
  const records: SavedOutputPdfRecord[] = [
    {
      id: 'places-only',
      kind: 'places_context',
      savedAt: '2026-04-20T12:01:00.000Z',
      marketLabel: 'Austin, TX',
      payload: {
        siteLabel: 'Standalone context',
        lat: 30.25012,
        lng: -97.76543,
        radiusMeters: 500,
        summary: 'Within 500m: 3 essentials.',
        countsByCategory: [{ category: 'essentials', label: 'Essentials', count: 3 }],
        topPlaces: [{ name: 'HEB', categoryLabel: 'Essentials' }],
      },
    },
    {
      id: 'pin-other',
      kind: 'uploaded_pin',
      savedAt: '2026-04-20T12:00:00.000Z',
      marketLabel: 'Austin, TX',
      payload: {
        siteLabel: 'Another site',
        lat: 30.26012,
        lng: -97.77543,
        sourceLabel: 'sites.csv',
        rowPreview: { Address: '222 Example St' },
      },
    },
  ]

  const groups = buildSavedOutputRenderGroups(records)

  assert.equal(groups.length, 2)
  assert.equal(groups[0]?.kind, 'single')
  assert.equal(groups[1]?.kind, 'site')
})

test('pdf document treats permit detail as a structured non-chart section', async () => {
  const source = await readFile(new URL('../../../lib/report/saved-charts-pdf-document.tsx', import.meta.url), 'utf8')

  assert.match(source, /permit_detail/)
  assert.match(source, /sourceName|addressOrPlace|categoryLabel/)
})
