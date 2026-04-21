import test from 'node:test'
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'

test('ImportedDataPanel no longer exposes recommended/chart/table sidebar view modes', async () => {
  const source = await readFile(new URL('../../components/ImportedDataPanel.tsx', import.meta.url), 'utf8')

  assert.doesNotMatch(source, /type ImportedPanelView = 'recommended' \| 'map' \| 'chart' \| 'table'/)
  assert.doesNotMatch(source, /VISUALIZATION_MODE_LABELS/)
  assert.doesNotMatch(source, /selectedView === 'recommended'/)
  assert.doesNotMatch(source, /selectedView === 'chart'/)
  assert.doesNotMatch(source, /selectedView === 'table'/)
})

test('ImportedDataPanel includes a simple no-map fallback instead of alternate mode controls', async () => {
  const source = await readFile(new URL('../../components/ImportedDataPanel.tsx', import.meta.url), 'utf8')

  assert.match(source, /This dataset does not have usable mapped rows in the sidebar\./)
  assert.doesNotMatch(source, />Recommended</)
  assert.doesNotMatch(source, />Chart</)
  assert.doesNotMatch(source, />Table</)
})
