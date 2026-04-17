import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { buildMetroAreaKey } from '@/lib/area-keys';
import type { MasterDataRow } from '@/lib/data/types';
import { normalizeBigQueryDateLike, warmMonthsRetention } from '@/lib/data/types';

type BigQueryModuleExports = typeof import('@/lib/data/bigquery');
type BigQueryMasterDataModuleExports = typeof import('@/lib/data/bigquery-master-data');
type PostgresMasterDataModuleExports = typeof import('@/lib/data/postgres-master-data');

const require = createRequire(import.meta.url);
const NodeModule = require('node:module') as {
  _load: (request: string, parent: unknown, isMain: boolean) => unknown;
};
const originalModuleLoad = NodeModule._load;

let bigQueryModulePromise: Promise<BigQueryModuleExports> | null = null;
let bigQueryMasterDataModulePromise: Promise<BigQueryMasterDataModuleExports> | null = null;
let postgresMasterDataModulePromise: Promise<PostgresMasterDataModuleExports> | null = null;

async function loadBigQueryModule(): Promise<BigQueryModuleExports> {
  if (!bigQueryModulePromise) {
    NodeModule._load = function patchedModuleLoad(request: string, parent: unknown, isMain: boolean) {
      if (request === 'server-only') {
        return {};
      }

      return originalModuleLoad.call(this, request, parent, isMain);
    };
    bigQueryModulePromise = import('@/lib/data/bigquery').finally(() => {
      NodeModule._load = originalModuleLoad;
    });
  }

  return bigQueryModulePromise;
}

async function loadBigQueryMasterDataModule(): Promise<BigQueryMasterDataModuleExports> {
  if (!bigQueryMasterDataModulePromise) {
    NodeModule._load = function patchedModuleLoad(request: string, parent: unknown, isMain: boolean) {
      if (request === 'server-only') {
        return {};
      }

      return originalModuleLoad.call(this, request, parent, isMain);
    };
    bigQueryMasterDataModulePromise = import('@/lib/data/bigquery-master-data').finally(() => {
      NodeModule._load = originalModuleLoad;
    });
  }

  return bigQueryMasterDataModulePromise;
}

async function loadPostgresMasterDataModule(): Promise<PostgresMasterDataModuleExports> {
  if (!postgresMasterDataModulePromise) {
    const originalUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
    const originalAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
    process.env.NEXT_PUBLIC_SUPABASE_URL ??= 'https://example.supabase.co';
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ??=
      'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImV4YW1wbGUiLCJyb2xlIjoiYW5vbiIsImlhdCI6MCwiZXhwIjoyNTMyOTk5OTk5fQ.signature';

    NodeModule._load = function patchedModuleLoad(request: string, parent: unknown, isMain: boolean) {
      if (request === 'server-only') {
        return {};
      }

      return originalModuleLoad.call(this, request, parent, isMain);
    };
    postgresMasterDataModulePromise = import('@/lib/data/postgres-master-data')
      .finally(() => {
        NodeModule._load = originalModuleLoad;
        if (originalUrl === undefined) delete process.env.NEXT_PUBLIC_SUPABASE_URL;
        else process.env.NEXT_PUBLIC_SUPABASE_URL = originalUrl;

        if (originalAnonKey === undefined) delete process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
        else process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY = originalAnonKey;
      });
  }

  return postgresMasterDataModulePromise;
}

test('market data router test harness is wired', () => {
  assert.strictEqual(buildMetroAreaKey('Houston metro area', 'TX'), 'metro:TX:houston');
});

test('MasterDataRow exposes the router read shape only', () => {
  const row: MasterDataRow = {
    submarket_id: 'metro:TX:houston',
    metric_name: 'Permit_Units',
    metric_value: 1842,
    time_period: '2026-04-01',
    data_source: 'BigQuery',
    visual_bucket: 'TIME_SERIES',
    created_at: '2026-04-17T00:00:00.000Z',
  };

  assert.deepStrictEqual(Object.keys(row).sort(), [
    'created_at',
    'data_source',
    'metric_name',
    'metric_value',
    'submarket_id',
    'time_period',
    'visual_bucket',
  ]);
});

test('normalizes BigQuery date values to ISO dates', () => {
  assert.strictEqual(
    normalizeBigQueryDateLike(new Date('2026-04-17T15:30:00Z')),
    '2026-04-17'
  );
  assert.strictEqual(normalizeBigQueryDateLike('2026-04-17 15:30:00+00'), '2026-04-17');
  assert.strictEqual(normalizeBigQueryDateLike('2026-04-17 23:59:59-08'), '2026-04-17');
  assert.strictEqual(normalizeBigQueryDateLike('2026-04-17T23:59:59-08:00'), '2026-04-17');
  assert.strictEqual(normalizeBigQueryDateLike({ value: '2026-04-01' }), '2026-04-01');
});

test('warmMonthsRetention reads the month env and falls back safely', () => {
  const original = process.env.MARKET_DATA_WARM_RETENTION_MONTHS;

  try {
    process.env.MARKET_DATA_WARM_RETENTION_MONTHS = '18';
    assert.strictEqual(warmMonthsRetention(), 18);

    process.env.MARKET_DATA_WARM_RETENTION_MONTHS = '0';
    assert.ok(warmMonthsRetention() > 0);
  } finally {
    if (original === undefined) {
      delete process.env.MARKET_DATA_WARM_RETENTION_MONTHS;
    } else {
      process.env.MARKET_DATA_WARM_RETENTION_MONTHS = original;
    }
  }
});

test('reads BigQuery router config from env', async () => {
  const { getBigQueryReadConfig, getBigQueryTablePath } = await loadBigQueryModule();
  const original = {
    projectId: process.env.BIGQUERY_PROJECT_ID,
    fallbackProjectId: process.env.GOOGLE_CLOUD_PROJECT,
    datasetId: process.env.BIGQUERY_DATASET_ID,
    tableId: process.env.BIGQUERY_TABLE_ID,
    location: process.env.BIGQUERY_LOCATION,
    warmMonths: process.env.MARKET_DATA_WARM_RETENTION_MONTHS,
  };

  try {
    process.env.BIGQUERY_PROJECT_ID = 'scout-dev';
    process.env.GOOGLE_CLOUD_PROJECT = 'ignored-fallback';
    process.env.BIGQUERY_DATASET_ID = 'market_router';
    process.env.BIGQUERY_TABLE_ID = 'master_data';
    process.env.BIGQUERY_LOCATION = 'US';
    process.env.MARKET_DATA_WARM_RETENTION_MONTHS = '9';

    assert.deepStrictEqual(getBigQueryReadConfig(), {
      projectId: 'scout-dev',
      datasetId: 'market_router',
      tableId: 'master_data',
      location: 'US',
      warmRetentionMonths: 9,
      isConfigured: true,
    });
    assert.strictEqual(getBigQueryTablePath(), 'scout-dev.market_router.master_data');
  } finally {
    for (const [key, value] of Object.entries(original)) {
      if (value === undefined) {
        delete process.env[key === 'projectId'
          ? 'BIGQUERY_PROJECT_ID'
          : key === 'fallbackProjectId'
            ? 'GOOGLE_CLOUD_PROJECT'
            : key === 'datasetId'
              ? 'BIGQUERY_DATASET_ID'
              : key === 'tableId'
                ? 'BIGQUERY_TABLE_ID'
                : key === 'location'
                  ? 'BIGQUERY_LOCATION'
                  : 'MARKET_DATA_WARM_RETENTION_MONTHS'];
      } else {
        process.env[key === 'projectId'
          ? 'BIGQUERY_PROJECT_ID'
          : key === 'fallbackProjectId'
            ? 'GOOGLE_CLOUD_PROJECT'
            : key === 'datasetId'
              ? 'BIGQUERY_DATASET_ID'
              : key === 'tableId'
                ? 'BIGQUERY_TABLE_ID'
                : key === 'location'
                  ? 'BIGQUERY_LOCATION'
                  : 'MARKET_DATA_WARM_RETENTION_MONTHS'] = value;
      }
    }
  }
});

test('treats ADC-backed BigQuery config as configured without an explicit project env', async () => {
  const { getBigQueryReadConfig, getBigQueryTablePath } = await loadBigQueryModule();
  const original = {
    projectId: process.env.BIGQUERY_PROJECT_ID,
    fallbackProjectId: process.env.GOOGLE_CLOUD_PROJECT,
    datasetId: process.env.BIGQUERY_DATASET_ID,
    tableId: process.env.BIGQUERY_TABLE_ID,
    credentialsPath: process.env.GOOGLE_APPLICATION_CREDENTIALS,
  };

  try {
    delete process.env.BIGQUERY_PROJECT_ID;
    delete process.env.GOOGLE_CLOUD_PROJECT;
    process.env.BIGQUERY_DATASET_ID = 'market_router';
    process.env.BIGQUERY_TABLE_ID = 'master_data';
    process.env.GOOGLE_APPLICATION_CREDENTIALS = 'C:\\keys\\scout.json';

    assert.deepStrictEqual(getBigQueryReadConfig(), {
      projectId: null,
      datasetId: 'market_router',
      tableId: 'master_data',
      location: 'US',
      warmRetentionMonths: 12,
      isConfigured: true,
    });
    assert.strictEqual(getBigQueryTablePath(), null);
  } finally {
    if (original.projectId === undefined) delete process.env.BIGQUERY_PROJECT_ID;
    else process.env.BIGQUERY_PROJECT_ID = original.projectId;

    if (original.fallbackProjectId === undefined) delete process.env.GOOGLE_CLOUD_PROJECT;
    else process.env.GOOGLE_CLOUD_PROJECT = original.fallbackProjectId;

    if (original.datasetId === undefined) delete process.env.BIGQUERY_DATASET_ID;
    else process.env.BIGQUERY_DATASET_ID = original.datasetId;

    if (original.tableId === undefined) delete process.env.BIGQUERY_TABLE_ID;
    else process.env.BIGQUERY_TABLE_ID = original.tableId;

    if (original.credentialsPath === undefined) delete process.env.GOOGLE_APPLICATION_CREDENTIALS;
    else process.env.GOOGLE_APPLICATION_CREDENTIALS = original.credentialsPath;
  }
});

test('creates a BigQuery client through an injected module loader', async () => {
  const { getBigQueryClient } = await loadBigQueryModule();
  const originalProjectId = process.env.BIGQUERY_PROJECT_ID;
  const originalDatasetId = process.env.BIGQUERY_DATASET_ID;
  const originalTableId = process.env.BIGQUERY_TABLE_ID;

  try {
    process.env.BIGQUERY_PROJECT_ID = 'scout-dev';
    process.env.BIGQUERY_DATASET_ID = 'market_router';
    process.env.BIGQUERY_TABLE_ID = 'master_data';

    const seen: Array<{ projectId: string | undefined }> = [];
    class FakeBigQuery {
      constructor(options?: { projectId?: string }) {
        seen.push(options ?? {});
      }
    }

    const client = await getBigQueryClient({
      loadModule: async () => ({ BigQuery: FakeBigQuery as never }),
    });

    assert.ok(client instanceof FakeBigQuery);
    assert.deepStrictEqual(seen, [{ projectId: 'scout-dev' }]);
  } finally {
    if (originalProjectId === undefined) delete process.env.BIGQUERY_PROJECT_ID;
    else process.env.BIGQUERY_PROJECT_ID = originalProjectId;

    if (originalDatasetId === undefined) delete process.env.BIGQUERY_DATASET_ID;
    else process.env.BIGQUERY_DATASET_ID = originalDatasetId;

    if (originalTableId === undefined) delete process.env.BIGQUERY_TABLE_ID;
    else process.env.BIGQUERY_TABLE_ID = originalTableId;
  }
});

test('normalizes BigQuery rows into the repo-native MasterDataRow shape', async () => {
  const { normalizeBigQueryRows } = await loadBigQueryMasterDataModule();

  assert.deepStrictEqual(
    normalizeBigQueryRows([
      {
        submarket_id: { value: 'metro:TX:houston' },
        metric_name: { value: 'Permit_Units' },
        metric_value: { value: '1842' },
        time_period: { value: '2026-04-17 03:45:00+00' },
        data_source: { value: 'TREC Building Permits' },
        visual_bucket: { value: 'TIME_SERIES' },
        created_at: { value: '2026-04-17T12:30:00Z' },
      },
    ]),
    [
      {
        submarket_id: 'metro:TX:houston',
        metric_name: 'Permit_Units',
        metric_value: 1842,
        time_period: '2026-04-17',
        data_source: 'TREC Building Permits',
        visual_bucket: 'TIME_SERIES',
        created_at: '2026-04-17T12:30:00.000Z',
      },
    ]
  );
});

test('fetchLatestRowsForSubmarkets reads Postgres per submarket instead of applying one shared limit', async () => {
  const { fetchLatestRowsForSubmarkets } = await loadPostgresMasterDataModule();
  const requestedSubmarkets: string[] = [];
  const buildResult = (submarketIds: string[]) =>
    Promise.resolve({
      data: submarketIds.map((value) => ({
        submarket_id: value,
        metric_name: `metric:${value}`,
        metric_value: 1,
        time_period: '2026-04-01',
        data_source: 'Postgres',
        visual_bucket: 'TABULAR',
        created_at: '2026-04-17T00:00:00.000Z',
      })),
      error: null,
    });
  const client = {
    from() {
      return {
        select() {
          const orderedQuery = {
            order() {
              return this;
            },
            limit(limitValue: number) {
              assert.strictEqual(limitValue, 1);
              return buildResult(requestedSubmarkets.slice(-1));
            },
          };

          return {
            eq(column: string, value: string) {
              assert.strictEqual(column, 'submarket_id');
              requestedSubmarkets.push(value);
              return orderedQuery;
            },
            in(column: string, values: string[]) {
              assert.strictEqual(column, 'submarket_id');
              requestedSubmarkets.push(...values);
              return {
                order() {
                  return this;
                },
                limit(limitValue: number) {
                  assert.strictEqual(limitValue, 1);
                  return buildResult(values);
                },
              };
            },
          };
        },
      };
    },
  };

  const rows = await fetchLatestRowsForSubmarkets(['submarket-a', 'submarket-b'], {
    client: client as never,
    limit: 1,
  });

  assert.deepStrictEqual(requestedSubmarkets, ['submarket-a', 'submarket-b']);
  assert.deepStrictEqual(
    rows.map((row) => row.submarket_id),
    ['submarket-a', 'submarket-b']
  );
});

test('fetchLatestRowsForSubmarkets reads BigQuery per submarket instead of applying one shared limit', async () => {
  const { fetchLatestRowsForSubmarkets } = await loadBigQueryMasterDataModule();
  const querySubmarkets: string[] = [];
  const originalProjectId = process.env.BIGQUERY_PROJECT_ID;
  const originalDatasetId = process.env.BIGQUERY_DATASET_ID;
  const originalTableId = process.env.BIGQUERY_TABLE_ID;
  process.env.BIGQUERY_PROJECT_ID = 'scout-dev';
  process.env.BIGQUERY_DATASET_ID = 'market_router';
  process.env.BIGQUERY_TABLE_ID = 'master_data';
  const client = {
    query({ params }: { params: { submarketId?: string; submarketIds?: string[]; rowLimit: number } }) {
      assert.strictEqual(params.rowLimit, 1);
      if (params.submarketId) {
        querySubmarkets.push(params.submarketId);
        return Promise.resolve([
          [
            {
              submarket_id: params.submarketId,
              metric_name: `metric:${params.submarketId}`,
              metric_value: '1',
              time_period: '2026-04-01',
              data_source: 'BigQuery',
              visual_bucket: 'TABULAR',
              created_at: '2026-04-17T00:00:00Z',
            },
          ],
        ]);
      }

      if (params.submarketIds) {
        querySubmarkets.push(...params.submarketIds);
        return Promise.resolve([
          params.submarketIds.map((submarketId) => ({
            submarket_id: submarketId,
            metric_name: `metric:${submarketId}`,
            metric_value: '1',
            time_period: '2026-04-01',
            data_source: 'BigQuery',
            visual_bucket: 'TABULAR',
            created_at: '2026-04-17T00:00:00Z',
          })),
        ]);
      }

      throw new Error('Missing submarket params');
    },
  };

  try {
    const rows = await fetchLatestRowsForSubmarkets(['submarket-a', 'submarket-b'], {
      client: client as never,
      limit: 1,
    });

    assert.deepStrictEqual(querySubmarkets, ['submarket-a', 'submarket-b']);
    assert.deepStrictEqual(
      rows.map((row) => row.submarket_id),
      ['submarket-a', 'submarket-b']
    );
  } finally {
    if (originalProjectId === undefined) delete process.env.BIGQUERY_PROJECT_ID;
    else process.env.BIGQUERY_PROJECT_ID = originalProjectId;

    if (originalDatasetId === undefined) delete process.env.BIGQUERY_DATASET_ID;
    else process.env.BIGQUERY_DATASET_ID = originalDatasetId;

    if (originalTableId === undefined) delete process.env.BIGQUERY_TABLE_ID;
    else process.env.BIGQUERY_TABLE_ID = originalTableId;
  }
});
