import test from 'node:test'
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'

test('map page uses Data, Imported Data, and Assistant sidecar tabs in that order', async () => {
  const pageSource = await readFile(new URL('../../app/page.tsx', import.meta.url), 'utf8')

  const tabListMatches = [
    ...pageSource.matchAll(/\{\(\[(.*?)\] as const\)\.map\(\(t\) => \(\s*<button/sg),
  ]
  assert.ok(tabListMatches.length >= 2, 'expected sidecar tab lists in page.tsx')

  for (const match of tabListMatches) {
    const normalized = match[1]?.replace(/\s+/g, ' ') ?? ''
    assert.match(normalized, /'data'.*'imported'.*'assistant'/)
    assert.doesNotMatch(normalized, /'analysis'/)
    assert.doesNotMatch(normalized, /'thinking'/)
  }
})

test('map page renders ImportedDataPanel only in the imported tab branch and AgentThinkingPanel in assistant', async () => {
  const pageSource = await readFile(new URL('../../app/page.tsx', import.meta.url), 'utf8')

  assert.match(pageSource, /marketPanelTab === 'imported'/)
  assert.match(pageSource, /<ImportedDataPanel/)
  assert.match(pageSource, /marketPanelTab === 'assistant'/)
  assert.match(pageSource, /<AgentThinkingPanel/)
  assert.doesNotMatch(pageSource, /marketPanelTab === 'data'[\s\S]{0,4000}<ImportedDataPanel/)
})
