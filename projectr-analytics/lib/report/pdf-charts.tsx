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
  const padTop = 30
  const padBottom = 20
  const padL = 34
  const chartH = height - padTop - padBottom
  const gap = 6
  const bw = Math.max(8, (width - padL - 6 - gap * (bars.length - 1)) / bars.length)
  return (
    <Svg width={width} height={height}>
      <SvgText x={4} y={padTop - 8} style={{ fontSize: 6, fill: '#555' }}>
        Units (max {Math.round(max).toLocaleString('en-US')})
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
