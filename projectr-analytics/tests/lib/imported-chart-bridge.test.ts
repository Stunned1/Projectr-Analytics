import test from 'node:test'
import assert from 'node:assert/strict'

import { toScoutChartOutputFromImportedChart } from '@/lib/client-upload-presentation'

test('bridges imported line charts into ScoutChartOutput', () => {
  const chart = toScoutChartOutputFromImportedChart({
    kind: 'line',
    title: 'Rent trend',
    points: [
      { label: '2026-01', value: 100 },
      { label: '2026-02', value: 101 },
    ],
  })

  assert.equal(chart?.kind, 'line')
  assert.equal(chart?.series[0]?.points.length, 2)
  assert.equal(chart?.citations[0]?.sourceType, 'workspace_upload')
})
