import React, { Fragment } from 'react'
import { Svg, Line, Polyline, Rect, Text as SvgText } from '@react-pdf/renderer'

function normY(v: number, min: number, max: number, height: number): number {
  if (max === min) return height / 2
  const t = (v - min) / (max - min)
  return height - t * height
}

export function SparklinePdf({
  data,
  width,
  height,
  color = '#D76B3D',
}: {
  data: { date: string; value: number }[]
  width: number
  height: number
  color?: string
}) {
  if (data.length < 2) {
    return (
      <Svg width={width} height={height}>
        <SvgText x={30} y={height / 2} style={{ fontSize: 7, fill: '#888' }}>
          Insufficient series
        </SvgText>
      </Svg>
    )
  }
  const vals = data.map((d) => d.value)
  const min = Math.min(...vals)
  const max = Math.max(...vals)
  const padL = 30
  const padR = 6
  const padY = 6
  const padB = 14
  const w = width - padL - padR
  const h = height - padY - padB
  const step = w / (data.length - 1)
  const points = data
    .map((d, i) => {
      const x = padL + i * step
      const y = padY + normY(d.value, min, max, h)
      return `${x},${y}`
    })
    .join(' ')

  const fmt = (v: number) =>
    Math.abs(v) >= 1000 ? Math.round(v).toLocaleString('en-US') : v.toFixed(1)

  return (
    <Svg width={width} height={height}>
      <Line x1={padL} y1={padY + h} x2={padL + w} y2={padY + h} stroke="#333" strokeWidth={0.5} />
      <SvgText x={2} y={padY + 7} style={{ fontSize: 6, fill: '#555' }}>
        {fmt(max)}
      </SvgText>
      <SvgText x={2} y={padY + h - 1} style={{ fontSize: 6, fill: '#555' }}>
        {fmt(min)}
      </SvgText>
      <Polyline points={points} fill="none" stroke={color} strokeWidth={1.2} />
    </Svg>
  )
}

export function BarChartPdf({
  bars,
  width,
  height,
  color = '#D76B3D',
  caption,
}: {
  bars: { label: string; value: number }[]
  width: number
  height: number
  color?: string
  /** Overrides default “Units (max …)” label above the chart. */
  caption?: string
}) {
  if (!bars.length) {
    return (
      <Svg width={width} height={height}>
        <SvgText x={4} y={height / 2} style={{ fontSize: 7, fill: '#888' }}>
          No permit series
        </SvgText>
      </Svg>
    )
  }
  const max = Math.max(...bars.map((b) => b.value), 1)
  const padTop = 30
  const padBottom = 20
  const padL = 34
  const chartH = height - padTop - padBottom
  const gap = 6
  const bw = Math.max(8, (width - padL - 6 - gap * (bars.length - 1)) / bars.length)
  const cap =
    caption ?? `Units (max ${Math.round(max).toLocaleString('en-US')})`
  return (
    <Svg width={width} height={height}>
      <SvgText x={4} y={padTop - 8} style={{ fontSize: 6, fill: '#555' }}>
        {cap}
      </SvgText>
      {bars.map((b, i) => {
        const bh = (b.value / max) * chartH
        const barX = padL + i * (bw + gap)
        const barY = padTop + chartH - bh
        return (
          <Fragment key={b.label}>
            <Rect x={barX} y={barY} width={bw} height={Math.max(bh, 1)} fill={color} />
            <SvgText
              x={barX + bw / 2}
              y={Math.max(barY - 3, padTop + 6)}
              style={{ fontSize: 6, fill: '#444', textAnchor: 'middle' }}
            >
              {b.value.toLocaleString('en-US')}
            </SvgText>
            <SvgText x={barX + bw / 2} y={height - 4} style={{ fontSize: 6, fill: '#888', textAnchor: 'middle' }}>
              {b.label}
            </SvgText>
          </Fragment>
        )
      })}
    </Svg>
  )
}

/** Left-aligned labels; horizontal bars - good for comparing sites on one metric. */
export function HorizontalBarChartPdf({
  rows,
  width,
  height,
  color = '#D76B3D',
  caption,
  formatValue,
}: {
  rows: { label: string; value: number }[]
  width: number
  height: number
  color?: string
  caption?: string
  /** Override bar-end labels (e.g. values already in millions). */
  formatValue?: (v: number) => string
}) {
  if (!rows.length) {
    return (
      <Svg width={width} height={height}>
        <SvgText x={4} y={height / 2} style={{ fontSize: 7, fill: '#888' }}>
          No rows
        </SvgText>
      </Svg>
    )
  }
  const max = Math.max(...rows.map((r) => r.value), 1)
  const padT = caption ? 22 : 10
  const padB = 8
  const labelW = Math.min(86, width * 0.26)
  const barX0 = labelW + 6
  const barW = width - barX0 - 6
  const innerH = height - padT - padB
  const rowH = innerH / rows.length
  const barH = Math.max(5, rowH - 5)

  const fmt =
    formatValue ??
    ((v: number) =>
      v >= 1e6 ? `${(v / 1e6).toFixed(2)}M` : v >= 1e3 ? `${(v / 1e3).toFixed(1)}k` : v.toFixed(v >= 10 ? 0 : 1))

  return (
    <Svg width={width} height={height}>
      {caption ? (
        <SvgText x={4} y={12} style={{ fontSize: 6, fill: '#555' }}>
          {caption}
        </SvgText>
      ) : null}
      {rows.map((r, i) => {
        const y = padT + i * rowH + (rowH - barH) / 2
        const fillW = (r.value / max) * barW
        return (
          <Fragment key={`${r.label}-${i}`}>
            <SvgText x={2} y={y + barH - 1} style={{ fontSize: 6, fill: '#333' }}>
              {r.label.length > 22 ? `${r.label.slice(0, 20)}…` : r.label}
            </SvgText>
            <Rect x={barX0} y={y} width={barW} height={barH} fill="#ececec" />
            <Rect x={barX0} y={y} width={Math.max(fillW, r.value > 0 ? 1 : 0)} height={barH} fill={color} />
            <SvgText x={barX0 + fillW + 3} y={y + barH - 1} style={{ fontSize: 6, fill: '#444' }}>
              {fmt(r.value)}
            </SvgText>
          </Fragment>
        )
      })}
    </Svg>
  )
}
