import { stripTrailingStateSuffix } from '@/lib/area-keys'

import type { TexasZctaDimRow } from './texas-zcta-dim'

export interface TexasPlaceLookupRow {
  city: string | null
  county_name?: string | null
  lat: number | null
  lng: number | null
}

export interface TexasLookupCentroid {
  lat: number
  lng: number
  source: 'zip_lookup'
}

type CentroidAccumulator = {
  latSum: number
  lngSum: number
  count: number
}

function normalizeText(value: string): string {
  return value
    .trim()
    .toLowerCase()
    .replace(/^city of\s+/i, '')
    .replace(/&/g, ' and ')
    .replace(/[^a-z0-9]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
}

export function normalizeTexasCountyToken(value: string | null | undefined): string {
  if (!value) return ''
  return normalizeText(value.replace(/\s+county$/i, ''))
}

export function normalizeTexasCityToken(value: string | null | undefined): string {
  if (!value) return ''
  return normalizeText(stripTrailingStateSuffix(value))
}

export function buildTexasPlaceKey(placeName: string, countyName: string | null): string {
  const city = normalizeTexasCityToken(placeName)
  const county = normalizeTexasCountyToken(countyName)
  return county ? `${city}|${county}` : city
}

function addCentroid(
  accumulators: Map<string, CentroidAccumulator>,
  key: string,
  lat: number,
  lng: number
) {
  const current = accumulators.get(key)
  if (!current) {
    accumulators.set(key, {
      latSum: lat,
      lngSum: lng,
      count: 1,
    })
    return
  }

  current.latSum += lat
  current.lngSum += lng
  current.count += 1
}

function finalizeCentroids(
  accumulators: Map<string, CentroidAccumulator>
): Map<string, TexasLookupCentroid> {
  const centroids = new Map<string, TexasLookupCentroid>()
  for (const [key, value] of accumulators.entries()) {
    if (value.count <= 0) continue
    centroids.set(key, {
      lat: value.latSum / value.count,
      lng: value.lngSum / value.count,
      source: 'zip_lookup',
    })
  }
  return centroids
}

function addLookupRow(
  byCity: Map<string, CentroidAccumulator>,
  byCityCounty: Map<string, CentroidAccumulator>,
  row: TexasPlaceLookupRow
) {
  if (row.lat == null || row.lng == null || !row.city) return
  const cityKey = normalizeTexasCityToken(row.city)
  if (!cityKey) return

  addCentroid(byCity, cityKey, row.lat, row.lng)

  const countyKey = normalizeTexasCountyToken(row.county_name)
  if (!countyKey) return
  addCentroid(byCityCounty, `${cityKey}|${countyKey}`, row.lat, row.lng)
}

function addCanonicalRow(
  byCity: Map<string, CentroidAccumulator>,
  byCityCounty: Map<string, CentroidAccumulator>,
  row: TexasZctaDimRow
) {
  if (row.lat == null || row.lng == null || !row.city) return
  addLookupRow(byCity, byCityCounty, {
    city: row.city,
    county_name: row.county_name,
    lat: row.lat,
    lng: row.lng,
  })
}

export function buildTexasPlaceCentroidMaps(
  lookupRows: readonly TexasPlaceLookupRow[],
  canonicalRows: readonly TexasZctaDimRow[] = []
): {
  byCity: Map<string, TexasLookupCentroid>
  byCityCounty: Map<string, TexasLookupCentroid>
} {
  const byCityAccumulators = new Map<string, CentroidAccumulator>()
  const byCityCountyAccumulators = new Map<string, CentroidAccumulator>()

  for (const row of lookupRows) {
    addLookupRow(byCityAccumulators, byCityCountyAccumulators, row)
  }

  for (const row of canonicalRows) {
    addCanonicalRow(byCityAccumulators, byCityCountyAccumulators, row)
  }

  return {
    byCity: finalizeCentroids(byCityAccumulators),
    byCityCounty: finalizeCentroids(byCityCountyAccumulators),
  }
}
