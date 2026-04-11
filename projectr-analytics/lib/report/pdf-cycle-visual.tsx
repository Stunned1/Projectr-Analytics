import React from 'react'
import { View, Text, StyleSheet, Svg, Line, Rect, Circle, Text as SvgText } from '@react-pdf/renderer'
import type { CycleAnalysis, CycleSignalDetail, CyclePosition, CycleStage } from '@/lib/cycle/types'
import { sanitizeCycleSignalText } from '@/lib/sanitize-gemini-string'

const WHEEL = 200
const C = WHEEL / 2

const styles = StyleSheet.create({
  tileRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    marginBottom: 10,
    width: '100%',
  },
  tile: {
    flex: 1,
    minWidth: 0,
    borderRadius: 4,
    borderWidth: 1,
    padding: 6,
    marginHorizontal: 3,
  },
  tileTitle: { fontSize: 7, fontFamily: 'Helvetica', fontWeight: 'bold', marginBottom: 3 },
  tileArrow: { fontSize: 11, fontFamily: 'Helvetica', fontWeight: 'bold', marginBottom: 2 },
  tileDirection: { fontSize: 6.5, color: '#444', lineHeight: 1.25, marginBottom: 2 },
  tileValue: { fontSize: 7, color: '#333', lineHeight: 1.25, marginBottom: 3 },
  tileSource: { fontSize: 5.5, color: '#666', lineHeight: 1.2 },
})

/** Normalized (0–1) dot position: x from left, y from top. */
function wheelDotNorm(position: CyclePosition, stage: CycleStage): { nx: number; ny: number } {
  const m: Record<CyclePosition, Record<CycleStage, [number, number]>> = {
    Recovery: {
      Early: [0.32, 0.32],
      Mid: [0.28, 0.48],
      Late: [0.38, 0.62],
    },
    Expansion: {
      Early: [0.6, 0.35],
      Mid: [0.72, 0.5],
      Late: [0.8, 0.65],
    },
    Hypersupply: {
      Early: [0.62, 0.58],
      Mid: [0.76, 0.72],
      Late: [0.88, 0.86],
    },
    Recession: {
      Early: [0.32, 0.58],
      Mid: [0.22, 0.74],
      Late: [0.36, 0.88],
    },
  }
  const pair = m[position]?.[stage] ?? [0.5, 0.5]
  return { nx: pair[0], ny: pair[1] }
}

function dotColor(confidence: number): string {
  if (confidence >= 70) return '#D76B3D'
  if (confidence >= 45) return '#ca8a04'
  return '#94a3b8'
}

/** Trajectory hint: vector from dot toward next-phase stress (PDF points). */
function trajectoryDelta(position: CyclePosition): { dx: number; dy: number } {
  switch (position) {
    case 'Recovery':
      return { dx: 16, dy: 4 }
    case 'Expansion':
      return { dx: 14, dy: 14 }
    case 'Hypersupply':
      return { dx: -8, dy: 10 }
    case 'Recession':
      return { dx: -12, dy: -12 }
    default:
      return { dx: 12, dy: 8 }
  }
}

export function CycleWheelPdf({ cycle }: { cycle: CycleAnalysis }) {
  const { nx, ny } = wheelDotNorm(cycle.cyclePosition, cycle.cycleStage)
  const cx = nx * WHEEL
  const cy = ny * WHEEL
  const fill = dotColor(cycle.confidence)
  const { dx, dy } = trajectoryDelta(cycle.cyclePosition)
  const r = 6

  return (
    <Svg width={WHEEL} height={WHEEL}>
      <Rect x={0} y={0} width={WHEEL} height={WHEEL} fill="#fafafa" stroke="#d4d4d8" strokeWidth={1} />
      <Line x1={C} y1={0} x2={C} y2={WHEEL} stroke="#a1a1aa" strokeWidth={0.75} />
      <Line x1={0} y1={C} x2={WHEEL} y2={C} stroke="#a1a1aa" strokeWidth={0.75} />
      <SvgText x={6} y={12} style={{ fontSize: 6, fill: '#52525b' }}>
        Recovery
      </SvgText>
      <SvgText x={WHEEL - 52} y={12} style={{ fontSize: 6, fill: '#52525b' }}>
        Expansion
      </SvgText>
      <SvgText x={6} y={WHEEL - 4} style={{ fontSize: 6, fill: '#52525b' }}>
        Recession
      </SvgText>
      <SvgText x={WHEEL - 68} y={WHEEL - 4} style={{ fontSize: 6, fill: '#52525b' }}>
        Hypersupply
      </SvgText>
      <Line x1={cx} y1={cy} x2={cx + dx} y2={cy + dy} stroke={fill} strokeWidth={2} />
      <Circle cx={cx} cy={cy} r={r} fill={fill} />
    </Svg>
  )
}

/** ASCII marks — Helvetica often omits Unicode arrows (same convention as legacy PDF signal tiles). */
function scoreArrow(detail: CycleSignalDetail, kind: 'rent' | 'vacancy' | 'permits' | 'employment'): string {
  const s = detail.score
  if (kind === 'vacancy') {
    if (s === 1) return '-'
    if (s === -1) return '+'
    return '~'
  }
  if (s === 1) return '+'
  if (s === -1) return '-'
  return '~'
}

function tileColors(score: -1 | 0 | 1): { bg: string; border: string; title: string } {
  if (score === 1) return { bg: '#ecfdf5', border: '#6ee7b7', title: '#047857' }
  if (score === -1) return { bg: '#fef2f2', border: '#fca5a5', title: '#b91c1c' }
  return { bg: '#f4f4f5', border: '#d4d4d8', title: '#3f3f46' }
}

function CycleTile({
  label,
  kind,
  detail,
}: {
  label: string
  kind: 'rent' | 'vacancy' | 'permits' | 'employment'
  detail: CycleSignalDetail
}) {
  const c = tileColors(detail.score)
  const direction = sanitizeCycleSignalText(detail.direction)
  const value = sanitizeCycleSignalText(detail.value)
  const source = sanitizeCycleSignalText(detail.source)
  return (
    <View style={[styles.tile, { backgroundColor: c.bg, borderColor: c.border }]}>
      <Text style={[styles.tileTitle, { color: c.title }]}>{label}</Text>
      <Text style={[styles.tileArrow, { color: c.title }]}>{scoreArrow(detail, kind)}</Text>
      <Text style={styles.tileDirection}>{direction}</Text>
      <Text style={styles.tileValue}>{value}</Text>
      <Text style={styles.tileSource}>{source}</Text>
    </View>
  )
}

export function CycleSignalTilesPdf({ cycle }: { cycle: CycleAnalysis }) {
  const s = cycle.signals
  return (
    <View style={styles.tileRow}>
      <CycleTile label="Rent" kind="rent" detail={s.rent} />
      <CycleTile label="Vacancy" kind="vacancy" detail={s.vacancy} />
      <CycleTile label="Permits" kind="permits" detail={s.permits} />
      <CycleTile label="Employment" kind="employment" detail={s.employment} />
    </View>
  )
}
