'use client'

import { useState, useCallback } from 'react'
import type { CycleAnalysis } from '@/lib/cycle/types'
import type { ClientReportPayload, ClientReportPin, MapLayersSnapshot } from '@/lib/report/types'
import {
  buildClientReportPayloadFromAggregate,
  buildClientReportPayloadFromZip,
  type AggregateShape,
  type CityZipShape,
  type TrendsShape,
  type ZipMarketShape,
} from '@/lib/report/build-client-payload'

type BuildResult = { ok: true; payload: ClientReportPayload } | { ok: false; reason: string }

interface MarketReportExportProps {
  mapLayersSnapshot: MapLayersSnapshot
  uploadedMarkers: Array<{ lat: number; lng: number; label: string; value: number | null }> | null
  /** When 2+ sites are checked for comparison, PDF Page 4 uses these pins instead of CSV upload markers. */
  comparisonPins?: ClientReportPin[] | null
  result: ZipMarketShape | null
  aggregateData: AggregateShape | null
  cityZips: CityZipShape[] | null
  trends: TrendsShape | null
  cycleAnalysis?: CycleAnalysis | null
}

export default function MarketReportExport({
  mapLayersSnapshot,
  uploadedMarkers,
  comparisonPins = null,
  result,
  aggregateData,
  cityZips,
  trends,
  cycleAnalysis = null,
}: MarketReportExportProps) {
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const buildPayload = useCallback((): BuildResult => {
    const fromUpload = (uploadedMarkers ?? []).map((m) => ({
      lat: m.lat,
      lng: m.lng,
      label: m.label,
      value: m.value,
    }))
    const pins: ClientReportPin[] =
      comparisonPins && comparisonPins.length >= 2 ? comparisonPins : fromUpload
    if (result) {
      return {
        ok: true,
        payload: buildClientReportPayloadFromZip({
          result,
          trends,
          layers: mapLayersSnapshot,
          pins,
          cycleAnalysis,
        }),
      }
    }
    if (aggregateData) {
      return {
        ok: true,
        payload: buildClientReportPayloadFromAggregate({
          aggregate: aggregateData,
          cityZips,
          layers: mapLayersSnapshot,
          pins,
          trends,
          cycleAnalysis,
        }),
      }
    }
    return { ok: false, reason: 'Run a ZIP or city/borough search first.' }
  }, [aggregateData, cityZips, comparisonPins, cycleAnalysis, mapLayersSnapshot, result, trends, uploadedMarkers])

  const downloadPdf = useCallback(async () => {
    setError(null)
    const built = buildPayload()
    if (!built.ok) {
      setError(built.reason)
      return
    }
    setLoading(true)
    try {
      const res = await fetch('/api/report/pdf', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(built.payload),
      })
      if (!res.ok) {
        const j = await res.json().catch(() => ({}))
        setError(typeof j.error === 'string' ? j.error : 'PDF generation failed')
        return
      }
      const blob = await res.blob()
      const url = URL.createObjectURL(blob)
      const a = document.createElement('a')
      a.href = url
      const label = built.payload.marketLabel.replace(/[^\w\s-]/g, '').trim().slice(0, 48) || 'brief'
      a.download = `Projectr-${label}.pdf`
      a.click()
      URL.revokeObjectURL(url)
    } catch {
      setError('Network error while generating PDF')
    } finally {
      setLoading(false)
    }
  }, [buildPayload])

  return (
    <div className="flex flex-col gap-2">
      <button
        type="button"
        onClick={downloadPdf}
        disabled={loading || (!result && !aggregateData)}
        className="w-full flex items-center justify-center gap-2 bg-white/8 hover:bg-white/12 border border-white/12 text-white text-xs font-semibold py-2.5 rounded-lg transition-colors disabled:opacity-40"
      >
        {loading ? (
          <>
            <span className="w-3 h-3 border border-white border-t-transparent rounded-full animate-spin" />
            Building PDF…
          </>
        ) : (
          <>Download market brief (PDF)</>
        )}
      </button>
      {error && <p className="text-red-400 text-[10px]">{error}</p>}
      <p className="text-zinc-600 text-[9px] leading-relaxed">
        Multi-page analyst brief: cycle headline, signals, metrics vs metro, charts, static map, and site comparison
        when 2+ shortlist sites are checked for compare or 2+ uploaded CSV pins are on the map.
      </p>
    </div>
  )
}
