import test from 'node:test'
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'

test('AgentTerminal wires non-chart retail companions through saveOutput', async () => {
  const source = await readFile(new URL('../../components/AgentTerminal.tsx', import.meta.url), 'utf8')

  assert.match(source, /saveOutput/)
  assert.match(source, /kind: 'stat_card'/)
  assert.match(source, /Save output/)
})
