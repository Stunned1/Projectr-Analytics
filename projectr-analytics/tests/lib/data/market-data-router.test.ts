import test from 'node:test';
import assert from 'node:assert/strict';
import { buildMetroAreaKey } from '@/lib/area-keys';

test('market data router test harness is wired', () => {
  assert.strictEqual(buildMetroAreaKey('Houston metro area', 'TX'), 'metro:TX:houston');
});
