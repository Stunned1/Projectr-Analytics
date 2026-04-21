import test from 'node:test'
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'

test('CommandMap renders uploaded csv markers with a dedicated pin path instead of permit styling', async () => {
  const source = await readFile(new URL('../../components/CommandMap.tsx', import.meta.url), 'utf8')

  assert.match(source, /uploaded-marker-pin/i)
  assert.match(source, /client-upload-icon-layer/i)
  assert.match(source, /client-upload-column-layer/i)
  assert.doesNotMatch(source, /color: '#D76B3D', label: 'Client'/)
})
