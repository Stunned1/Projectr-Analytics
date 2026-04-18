'use client'

import type { ScoutChartOutput } from '@/lib/scout-chart-output'
import {
  Bar,
  BarChart,
  CartesianGrid,
  Legend,
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts'

function formatValue(value: number, format: ScoutChartOutput['yAxis']['valueFormat']) {
  if (format === 'currency') return `$${Math.round(value).toLocaleString()}`
  if (format === 'percent') return `${value.toFixed(1)}%`
  return Number.isInteger(value) ? value.toLocaleString() : value.toFixed(1)
}

function toRechartsRows(chart: ScoutChartOutput): Array<Record<string, string | number>> {
  const labels = new Set<string>()
  for (const series of chart.series) {
    for (const point of series.points) labels.add(point.x)
  }

  return [...labels].map((label) => {
    const row: Record<string, string | number> = { [chart.xAxis.key]: label }
    for (const series of chart.series) {
      const point = series.points.find((entry) => entry.x === label)
      if (point) row[series.key] = point.y
    }
    return row
  })
}

export function ScoutChartCard({ chart }: { chart: ScoutChartOutput }) {
  const rows = toRechartsRows(chart)

  return (
    <div className="mt-3 rounded-lg border border-border/60 bg-muted/10 p-3">
      <div className="mb-3 flex flex-wrap items-start justify-between gap-2">
        <div className="min-w-0">
          <p className="text-sm font-semibold text-white">{chart.title}</p>
          {chart.subtitle ? <p className="text-[11px] text-zinc-400">{chart.subtitle}</p> : null}
          {chart.summary ? <p className="mt-1 text-[11px] leading-relaxed text-zinc-300">{chart.summary}</p> : null}
        </div>
        <div className="flex flex-col items-end gap-1 text-[10px]">
          {chart.placeholder ? (
            <span className="rounded-full border border-amber-700/40 bg-amber-950/30 px-2 py-0.5 text-amber-200">
              Placeholder
            </span>
          ) : null}
          {chart.confidenceLabel ? <span className="text-zinc-500">{chart.confidenceLabel}</span> : null}
        </div>
      </div>

      <div className="h-56 w-full">
        <ResponsiveContainer width="100%" height="100%">
          {chart.kind === 'line' ? (
            <LineChart data={rows}>
              <CartesianGrid stroke="#2d3342" strokeDasharray="3 3" />
              <XAxis dataKey={chart.xAxis.key} tick={{ fill: '#9ca3af', fontSize: 10 }} axisLine={{ stroke: '#374151' }} tickLine={{ stroke: '#374151' }} />
              <YAxis
                tick={{ fill: '#9ca3af', fontSize: 10 }}
                axisLine={{ stroke: '#374151' }}
                tickLine={{ stroke: '#374151' }}
                tickFormatter={(value: number) => formatValue(value, chart.yAxis.valueFormat)}
              />
              <Tooltip
                formatter={(value: number) => formatValue(value, chart.yAxis.valueFormat)}
                contentStyle={{ backgroundColor: '#09090b', border: '1px solid #27272a', color: '#fff' }}
              />
              <Legend wrapperStyle={{ fontSize: '11px' }} />
              {chart.series.map((series) => (
                <Line
                  key={series.key}
                  type="monotone"
                  dataKey={series.key}
                  name={series.label}
                  stroke={series.color ?? '#D76B3D'}
                  strokeWidth={2.5}
                  dot={{ r: 3 }}
                />
              ))}
            </LineChart>
          ) : (
            <BarChart data={rows}>
              <CartesianGrid stroke="#2d3342" strokeDasharray="3 3" />
              <XAxis dataKey={chart.xAxis.key} tick={{ fill: '#9ca3af', fontSize: 10 }} axisLine={{ stroke: '#374151' }} tickLine={{ stroke: '#374151' }} />
              <YAxis
                tick={{ fill: '#9ca3af', fontSize: 10 }}
                axisLine={{ stroke: '#374151' }}
                tickLine={{ stroke: '#374151' }}
                tickFormatter={(value: number) => formatValue(value, chart.yAxis.valueFormat)}
              />
              <Tooltip
                formatter={(value: number) => formatValue(value, chart.yAxis.valueFormat)}
                contentStyle={{ backgroundColor: '#09090b', border: '1px solid #27272a', color: '#fff' }}
              />
              <Legend wrapperStyle={{ fontSize: '11px' }} />
              {chart.series.map((series) => (
                <Bar key={series.key} dataKey={series.key} name={series.label} fill={series.color ?? '#60a5fa'} radius={[4, 4, 0, 0]} />
              ))}
            </BarChart>
          )}
        </ResponsiveContainer>
      </div>

      <div className="mt-3 border-t border-border/60 pt-2">
        <p className="text-[10px] font-semibold uppercase tracking-widest text-zinc-500">Sources</p>
        <div className="mt-1 space-y-1">
          {chart.citations.map((citation) => (
            <p key={citation.id} className="text-[10px] leading-relaxed text-zinc-400">
              <span className="font-medium text-zinc-200">{citation.label}</span>
              {citation.periodLabel ? ` · ${citation.periodLabel}` : ''}
              {citation.note ? ` · ${citation.note}` : ''}
              {citation.placeholder ? ' · placeholder' : ''}
            </p>
          ))}
        </div>
      </div>
    </div>
  )
}
