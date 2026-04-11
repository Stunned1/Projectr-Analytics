import React from 'react'
import { Svg, Line } from '@react-pdf/renderer'

export type TrendSignalKind = 'rent' | 'vacancy' | 'permits' | 'employment'

export type TrendArrowVariant = 'up' | 'down' | 'flat'

function normalizeScore(raw: unknown): -1 | 0 | 1 {
  if (raw === 1 || raw === -1 || raw === 0) return raw
  const n = typeof raw === 'number' && Number.isFinite(raw) ? raw : Number(raw)
  if (n === 1) return 1
  if (n === -1) return -1
  return 0
}

/** Same semantics as the old Unicode classifier glyphs (vacancy inverted). */
export function trendKindToVariant(kind: TrendSignalKind, score: unknown): TrendArrowVariant {
  const s = normalizeScore(score)
  if (kind === 'vacancy') {
    if (s === 1) return 'down'
    if (s === -1) return 'up'
    return 'flat'
  }
  if (s === 1) return 'up'
  if (s === -1) return 'down'
  return 'flat'
}

export function signalIndicatorToVariant(s: {
  id: TrendSignalKind
  arrow: 'up' | 'down' | 'flat'
}): TrendArrowVariant {
  if (s.id === 'vacancy') {
    if (s.arrow === 'down') return 'down'
    if (s.arrow === 'up') return 'up'
    return 'flat'
  }
  if (s.arrow === 'up') return 'up'
  if (s.arrow === 'down') return 'down'
  return 'flat'
}

const W = 12
const H = 11
const SW = 2
const M = 1.2

/**
 * Stroke-only trend marks - PDF Standard Helvetica has no U+2191–U+2193; Unicode renders as junk (",", etc.).
 */
export function PdfTrendArrow({ variant, color }: { variant: TrendArrowVariant; color: string }) {
  if (variant === 'up') {
    return (
      <Svg width={W} height={H}>
        <Line x1={M} y1={H - M} x2={W / 2} y2={M} stroke={color} strokeWidth={SW} />
        <Line x1={W / 2} y1={M} x2={W - M} y2={H - M} stroke={color} strokeWidth={SW} />
      </Svg>
    )
  }
  if (variant === 'down') {
    return (
      <Svg width={W} height={H}>
        <Line x1={M} y1={M} x2={W / 2} y2={H - M} stroke={color} strokeWidth={SW} />
        <Line x1={W / 2} y1={H - M} x2={W - M} y2={M} stroke={color} strokeWidth={SW} />
      </Svg>
    )
  }
  return (
    <Svg width={W} height={H}>
      <Line x1={M} y1={H / 2} x2={W - M} y2={H / 2} stroke={color} strokeWidth={SW} />
    </Svg>
  )
}
