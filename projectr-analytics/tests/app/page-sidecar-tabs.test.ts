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
  assert.match(pageSource, /setMarketPanelTab\('imported'\)/)
  assert.match(pageSource, /setPanelOpen\(true\)/)
  assert.doesNotMatch(pageSource, /marketPanelTab === 'data'[\s\S]{0,4000}<ImportedDataPanel/)
})

test('map page does not keep a separate upload-only side panel branch', async () => {
  const pageSource = await readFile(new URL('../../app/page.tsx', import.meta.url), 'utf8')

  assert.doesNotMatch(
    pageSource,
    /\{panelOpen && !selectedSite && !result && !aggregateData && clientUploadAgg && \(/,
  )
  assert.doesNotMatch(
    pageSource,
    /<h2 className="text-base font-bold leading-tight text-foreground">Imported Data<\/h2>/,
  )
})

test('map page gives the Data tab a no-market empty state inside the shared panel', async () => {
  const pageSource = await readFile(new URL('../../app/page.tsx', import.meta.url), 'utf8')

  assert.match(pageSource, /No market loaded yet/)
  assert.match(pageSource, /Load a ZIP, city, county, or metro to inspect market metrics here\./)
})

test('right sidebar width constant is set back to the narrower size', async () => {
  const guideSource = await readFile(new URL('../../lib/analyst-guide.ts', import.meta.url), 'utf8')

  assert.match(guideSource, /export const RIGHT_PANEL_WIDTH_PX = 360/)
})
