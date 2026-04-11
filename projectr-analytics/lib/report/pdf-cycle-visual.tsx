import React from 'react'
import { View, Text, StyleSheet, Svg, Line, Rect, Circle, Text as SvgText } from '@react-pdf/renderer'
import type { CycleAnalysis, CycleSignalDetail, CyclePosition, CycleStage } from '@/lib/cycle/types'
import { sanitizeCycleSignalText } from '@/lib/sanitize-gemini-string'
import { PdfTrendArrow, trendKindToVariant, type TrendSignalKind } from '@/lib/report/pdf-trend-arrow'

function tileSignalLine(s: string | null | undefined): string {
  const t = sanitizeCycleSignalText(s)
  return t.length > 0 ? t : '-'
}

function normalizeSignalScore(raw: unknown): -1 | 0 | 1 {
  if (raw === 1 || raw === -1 || raw === 0) return raw
  const n = typeof raw === 'number' && Number.isFinite(raw) ? raw : Number(raw)
  if (n === 1) return 1
  if (n === -1) return -1
  return 0
}

const WHEEL = 260
const C = WHEEL / 2

const styles = StyleSheet.create({
  tileRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'flex-start',
    marginBottom: 10,
    width: '100%',
  },
  tileColumn: {
    flexDirection: 'column',
    width: '100%',
    flex: 1,
    minWidth: 0,
  },
  /** Explicit width - flex:1 tiles often collapse text width to 0 in @react-pdf row layouts. */
  tile: {
    width: '23.5%',
    borderRadius: 4,
    borderWidth: 1,
    padding: 5,
    marginHorizontal: 0,
  },
  tileVertical: {
    flex: 0,
    flexGrow: 0,
    width: '100%',
    marginHorizontal: 0,
    marginBottom: 6,
  },
  tileTitle: { fontSize: 7, fontFamily: 'Helvetica', fontWeight: 'bold', marginBottom: 3 },
  tileArrowSlot: { height: 12, marginBottom: 3, justifyContent: 'center' },
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
      return { dx: 21, dy: 5 }
    case 'Expansion':
      return { dx: 18, dy: 18 }
    case 'Hypersupply':
      return { dx: -10, dy: 13 }
    case 'Recession':
      return { dx: -16, dy: -16 }
    default:
      return { dx: 16, dy: 10 }
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
      <Rect x={0} y={0} width={C} height={C} fill="#eff6ff" opacity={0.65} />
      <Rect x={C} y={0} width={C} height={C} fill="#f0fdf4" opacity={0.65} />
      <Rect x={C} y={C} width={C} height={C} fill="#fff7ed" opacity={0.65} />
      <Rect x={0} y={C} width={C} height={C} fill="#fef2f2" opacity={0.65} />
      <Rect x={0} y={0} width={WHEEL} height={WHEEL} fill="none" stroke="#d4d4d8" strokeWidth={1} />
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

function tileColors(score: unknown): { bg: string; border: string; title: string } {
  const s = normalizeSignalScore(score)
  if (s === 1) return { bg: '#ecfdf5', border: '#6ee7b7', title: '#047857' }
  if (s === -1) return { bg: '#fef2f2', border: '#fca5a5', title: '#b91c1c' }
  return { bg: '#f4f4f5', border: '#d4d4d8', title: '#3f3f46' }
}

function CycleTile({
  label,
  kind,
  detail,
  layout,
}: {
  label: string
  kind: TrendSignalKind
  detail: CycleSignalDetail
  layout: 'horizontal' | 'vertical'
}) {
  const c = tileColors(detail.score)
  const direction = tileSignalLine(detail.direction)
  const value = tileSignalLine(detail.value)
  const source = tileSignalLine(detail.source)
  return (
    <View
      style={[
        styles.tile,
        ...(layout === 'vertical' ? [styles.tileVertical] : []),
        { backgroundColor: c.bg, borderColor: c.border },
      ]}
    >
      <Text style={[styles.tileTitle, { color: c.title }]}>{label}</Text>
      <View style={styles.tileArrowSlot}>
        <PdfTrendArrow variant={trendKindToVariant(kind, detail.score)} color={c.title} />
      </View>
      <Text style={styles.tileDirection} wrap>
        {direction}
      </Text>
      <Text style={styles.tileValue} wrap>
        {value}
      </Text>
      <Text style={styles.tileSource} wrap>
        {source}
      </Text>
    </View>
  )
}

export function CycleSignalTilesPdf({
  cycle,
  layout = 'horizontal',
}: {
  cycle: CycleAnalysis
  layout?: 'horizontal' | 'vertical'
}) {
  const s = cycle.signals
  const wrap = layout === 'vertical' ? styles.tileColumn : styles.tileRow
  return (
    <View style={wrap}>
      <CycleTile label="Rent" kind="rent" detail={s.rent} layout={layout} />
      <CycleTile label="Vacancy" kind="vacancy" detail={s.vacancy} layout={layout} />
      <CycleTile label="Permits" kind="permits" detail={s.permits} layout={layout} />
      <CycleTile label="Employment" kind="employment" detail={s.employment} layout={layout} />
    </View>
  )
}
