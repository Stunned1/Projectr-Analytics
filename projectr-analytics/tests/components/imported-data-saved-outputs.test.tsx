import test from 'node:test'
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'

test('ImportedDataPanel exposes save actions for selected uploaded pins and ready places context', async () => {
  const source = await readFile(new URL('../../components/ImportedDataPanel.tsx', import.meta.url), 'utf8')

  assert.match(source, /kind: 'uploaded_pin'/)
  assert.match(source, /kind: 'places_context'/)
  assert.match(source, /Save site snapshot/)
  assert.match(source, /Save nearby context/)
  assert.match(source, /useSavedChartsStore\(\(state\) => state\.outputs\)/)
  assert.match(source, /buildTopPlaceKey\(place, index\)/)
})
