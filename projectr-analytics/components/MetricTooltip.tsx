'use client'

import type { MetricKey } from '@/lib/metric-definitions'
import { METRIC_DEFINITIONS } from '@/lib/metric-definitions'

export function MetricTooltip({
  metricKey,
  children,
  className,
}: {
  metricKey: MetricKey
  children: React.ReactNode
  className?: string
}) {
  const d = METRIC_DEFINITIONS[metricKey]
  if (!d) return <>{children}</>

  return (
    <span className={`group relative inline max-w-full ${className ?? ''}`}>
      <span className="cursor-help border-b border-dotted border-zinc-600 text-inherit">{children}</span>
      <span
        role="tooltip"
        className="pointer-events-none absolute left-0 bottom-[calc(100%+6px)] z-[60] hidden w-max max-w-[min(280px,calc(100vw-48px))] rounded-md border border-white/12 bg-zinc-950 px-2.5 py-2 text-left text-[10px] leading-snug text-zinc-200 shadow-xl group-hover:block group-focus-within:block"
      >
        <span className="font-semibold text-white">{d.label}</span>
        <span className="mt-1 block text-zinc-400">{d.short}</span>
        {d.calculation && (
          <span className="mt-1.5 block border-t border-white/10 pt-1.5 text-zinc-500">{d.calculation}</span>
        )}
        <span className="mt-1 block text-[9px] text-zinc-600">Source: {d.source}</span>
      </span>
    </span>
  )
}
