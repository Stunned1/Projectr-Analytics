'use client'

import { useState } from 'react'
import type { CycleAnalysis, CyclePosition, CycleSignalScore } from '@/lib/cycle/types'
import type { MetricKey } from '@/lib/metric-definitions'
import { MetricTooltip } from '@/components/MetricTooltip'

const PHASE_TO_KEY: Record<CyclePosition, MetricKey> = {
  Recovery: 'cycleRecovery',
  Expansion: 'cycleExpansion',
  Hypersupply: 'cycleHypersupply',
  Recession: 'cycleRecession',
}

function scoreSymbol(s: CycleSignalScore) {
  if (s === 1) return '+'
  if (s === -1) return '-'
  return '~'
}

export function CycleExplainCard({
  marketLabel,
  cycle,
  subtitle,
}: {
  marketLabel: string
  cycle: CycleAnalysis
  subtitle?: string
}) {
  const [open, setOpen] = useState(false)
  const phaseKey = PHASE_TO_KEY[cycle.cyclePosition]

  const rows = [
    { label: 'Rent', detail: cycle.signals.rent },
    { label: 'Vacancy', detail: cycle.signals.vacancy },
    { label: 'Permits', detail: cycle.signals.permits },
    { label: 'Employment', detail: cycle.signals.employment },
  ] as const

  return (
    <div className="mb-4 rounded-lg border border-[#D76B3D]/30 bg-[#D76B3D]/10 px-3 py-3">
      <button
        type="button"
        onClick={() => setOpen(!open)}
        className="w-full text-left"
      >
        <div className="flex items-start justify-between gap-2">
          <div className="min-w-0 flex-1">
            <p className="text-[9px] uppercase tracking-widest text-[#D76B3D] mb-1">
              <MetricTooltip metricKey="cycleClassifier">Market cycle</MetricTooltip>
            </p>
            <p className="text-white text-[15px] font-bold leading-tight">
              {marketLabel} is in {cycle.cycleStage}{' '}
              <MetricTooltip metricKey={phaseKey}>{cycle.cyclePosition}</MetricTooltip>
            </p>
            <p className="text-zinc-500 text-[10px] mt-1.5 leading-snug">{cycle.confidenceLine}</p>
            {subtitle && <p className="text-zinc-600 text-[9px] mt-2 leading-snug">{subtitle}</p>}
          </div>
          <span className="flex-shrink-0 text-zinc-500 text-sm leading-none pt-0.5">{open ? '▾' : '▸'}</span>
        </div>
      </button>
      {open && (
        <div className="mt-3 border-t border-[#D76B3D]/20 pt-3 space-y-2">
          <p className="text-[10px] text-zinc-500 leading-snug">
            {cycle.signalsAgreement}/4 classifier signals agree with{' '}
            <span className="text-zinc-300">
              {cycle.cycleStage} {cycle.cyclePosition}
            </span>
            . Read each line to clients as the transparent input to the quadrant.
          </p>
          <ul className="space-y-2">
            {rows.map(({ label, detail }) => (
              <li key={label} className="text-[10px] leading-snug">
                <span className="font-semibold text-zinc-300">
                  {label} ({scoreSymbol(detail.score)}):
                </span>{' '}
                <span className="text-zinc-400">{detail.direction}</span>
                <span className="text-zinc-600"> · {detail.value}</span>
                <span className="block text-[9px] text-zinc-600 mt-0.5">Source: {detail.source}</span>
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  )
}
