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
        <SvgText x={4} y={height / 2} style={{ fontSize: 7, fill: '#888' }}>
          Insufficient series
        </SvgText>
      </Svg>
    )
  }
  const vals = data.map((d) => d.value)
  const min = Math.min(...vals)
  const max = Math.max(...vals)
  const pad = 4
  const w = width - pad * 2
  const h = height - pad * 2
  const step = w / (data.length - 1)
  const points = data
    .map((d, i) => {
      const x = pad + i * step
      const y = pad + normY(d.value, min, max, h)
      return `${x},${y}`
    })
    .join(' ')

  return (
    <Svg width={width} height={height}>
      <Line x1={pad} y1={pad + h} x2={pad + w} y2={pad + h} stroke="#333" strokeWidth={0.5} />
      <Polyline points={points} fill="none" stroke={color} strokeWidth={1.2} />
    </Svg>
  )
}

export function BarChartPdf({
  bars,
  width,
  height,
  color = '#D76B3D',
}: {
  bars: { label: string; value: number }[]
  width: number
  height: number
  color?: string
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
  const pad = 22
  const chartH = height - pad
  const gap = 6
  const bw = Math.max(8, (width - 12 - gap * (bars.length - 1)) / bars.length)
  return (
    <Svg width={width} height={height}>
      {bars.map((b, i) => {
        const bh = (b.value / max) * chartH
        const barX = 6 + i * (bw + gap)
        const barY = pad + chartH - bh
        return (
          <Fragment key={b.label}>
            <Rect x={barX} y={barY} width={bw} height={Math.max(bh, 1)} fill={color} />
            <SvgText x={barX} y={height - 4} style={{ fontSize: 6, fill: '#aaa' }}>
              {b.label}
            </SvgText>
          </Fragment>
        )
      })}
    </Svg>
  )
}
