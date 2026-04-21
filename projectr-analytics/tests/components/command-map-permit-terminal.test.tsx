import test from 'node:test'
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'

test('CommandMap emits terminal permit detail events and no longer renders floating permit popups', async () => {
  const source = await readFile(new URL('../../components/CommandMap.tsx', import.meta.url), 'utf8')

  assert.match(source, /onPermitDetailSelect\?/)
  assert.doesNotMatch(source, /Permit detail panel/)
  assert.doesNotMatch(source, /selectedTexasRawPermit && \(/)
  assert.doesNotMatch(source, /selectedTexasPermit && \(/)
  assert.doesNotMatch(source, /selectedPermit && \(/)
})
