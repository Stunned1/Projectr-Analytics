'use client'

import { useCallback, useEffect, useMemo, useState } from 'react'
import type { MetricKey } from '@/lib/metric-definitions'
import { fetchMomentumScores, normalizeMomentumZipList, type MomentumApiResponse } from '@/lib/momentum-client'
import { MetricTooltip } from '@/components/MetricTooltip'
import { dedupedFetchJson } from '@/lib/request-cache'

function fmtComp(n: number | null) {
  if (n == null || !Number.isFinite(n)) return '-'
  return `${Math.round(n)}`
}

export function MomentumExplainBlock({
  anchorZip,
  aggregateZips,
  metricKey = 'momentum',
}: {
  anchorZip: string | null
  aggregateZips: string[] | null
  metricKey?: MetricKey
}) {
  const [open, setOpen] = useState(true)
  const [loading, setLoading] = useState(false)
  const [data, setData] = useState<MomentumApiResponse | null>(null)
  const [error, setError] = useState<string | null>(null)

  const aggregateZipsKey = normalizeMomentumZipList(aggregateZips).join(',')
  const aggregateZipCount = aggregateZipsKey ? aggregateZipsKey.split(',').length : 0
  const zipContextKey = useMemo(() => {
    if (aggregateZipCount > 0) return `a:${aggregateZipsKey}`
    if (anchorZip && /^\d{5}$/.test(anchorZip)) return `z:${anchorZip}`
    return ''
  }, [anchorZip, aggregateZipCount, aggregateZipsKey])

  const fetchMomentum = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      let zips: string[] = []
      if (aggregateZipCount > 0) {
        zips = aggregateZipsKey.split(',')
      } else if (anchorZip && /^\d{5}$/.test(anchorZip)) {
        const nJson = await dedupedFetchJson<{ zips?: Array<{ zip: string }> }>(
          `/api/neighbors?zip=${encodeURIComponent(anchorZip)}`,
          { ttlMs: 5 * 60 * 1000 }
        )
        const peers = Array.isArray(nJson.zips) ? nJson.zips.map((x) => x.zip).filter((z) => /^\d{5}$/.test(z)) : []
        zips = normalizeMomentumZipList([anchorZip, ...peers.slice(0, 19)])
      } else {
        setError('No ZIP context for momentum.')
        return
      }

      const j = await fetchMomentumScores(zips, { limit: zips.length })
      setData(j)
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to load momentum')
    } finally {
      setLoading(false)
    }
  }, [anchorZip, aggregateZipCount, aggregateZipsKey])

  useEffect(() => {
    setData(null)
    setError(null)
  }, [zipContextKey])

  useEffect(() => {
    if (!zipContextKey) return
    void fetchMomentum()
  }, [zipContextKey, fetchMomentum])

  const toggle = () => {
    const next = !open
    setOpen(next)
    if (next && !data && !loading) void fetchMomentum()
  }

  if (!anchorZip && !(aggregateZips && aggregateZips.length)) return null

  const isAggregate = aggregateZipCount > 0
  const zipSet = new Set(aggregateZipsKey ? aggregateZipsKey.split(',') : [])
  const relevantScores =
    data?.scores.filter((s) => (isAggregate ? zipSet.has(s.zip) : s.zip === anchorZip)) ?? []
  const meanScore =
    relevantScores.length > 0
      ? Math.round(relevantScores.reduce((a, s) => a + s.score, 0) / relevantScores.length)
      : null
  const anchorRow = anchorZip ? data?.scores.find((s) => s.zip === anchorZip) : null
  const displayScore = isAggregate ? meanScore : anchorRow?.score ?? null

  return (
    <div className="mb-4 rounded-lg border border-white/10 bg-white/[0.03] px-3 py-3">
      <button
        type="button"
        onClick={toggle}
        className="flex w-full items-start justify-between gap-2 text-left"
      >
        <div>
          <p className="text-[9px] uppercase tracking-widest text-zinc-500">
            <MetricTooltip metricKey={metricKey}>Momentum score</MetricTooltip>
          </p>
          <p className="mt-1 text-lg font-bold text-white tabular-nums">
            {loading ? '…' : displayScore != null ? displayScore : '-'}
            <span className="text-xs font-normal text-zinc-500"> / 100</span>
          </p>
          <p className="mt-0.5 text-[10px] text-zinc-500">
            {isAggregate ? 'Mean across ZIPs in this area (peer-normalized).' : 'Peer-normalized vs nearby ZIPs in the metro.'}
          </p>
        </div>
        <span className="text-zinc-500 text-xs">{open ? '▾' : '▸'}</span>
      </button>
      {error && <p className="mt-2 text-[10px] text-red-400">{error}</p>}
      {open && (
        <div className="mt-3 border-t border-white/10 pt-3 text-[10px] leading-relaxed text-zinc-400">
          {!isAggregate && anchorRow && (
            <ul className="space-y-1">
              <li>
                <span className="text-zinc-500">Labor (unemployment-based):</span>{' '}
                <span className="text-zinc-200">{fmtComp(anchorRow.components.jobMarket)}</span>
              </li>
              <li>
                <span className="text-zinc-500">Rent level (vs peers):</span>{' '}
                <span className="text-zinc-200">{fmtComp(anchorRow.components.rentGrowth)}</span>
              </li>
              <li>
                <span className="text-zinc-500">Permit volume (vs peers):</span>{' '}
                <span className="text-zinc-200">{fmtComp(anchorRow.components.permitDensity)}</span>
              </li>
            </ul>
          )}
          {isAggregate && data && (
            <p className="text-zinc-500">
              Component-level breakdown is per ZIP; expand a single-ZIP market to see one row’s inputs. Mean score averages
              each ZIP’s momentum across the area list (max 40 ZIPs).
            </p>
          )}
        </div>
      )}
    </div>
  )
}
