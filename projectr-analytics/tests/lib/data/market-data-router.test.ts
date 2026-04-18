import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { buildMetroAreaKey } from '@/lib/area-keys';
import type { MasterDataRow } from '@/lib/data/types';
import { normalizeBigQueryDateLike, warmMonthsRetention } from '@/lib/data/types';
import type { AnalyticalComparisonRequest } from '@/lib/data/market-data-router';

type BigQueryModuleExports = typeof import('@/lib/data/bigquery');
type BigQueryTablesModuleExports = typeof import('@/lib/data/bigquery-tables');
type BigQueryMasterDataModuleExports = typeof import('@/lib/data/bigquery-master-data');
type PostgresMasterDataModuleExports = typeof import('@/lib/data/postgres-master-data');
type MarketDataRouterModuleExports = typeof import('@/lib/data/market-data-router');
type CycleLoadDataModuleExports = typeof import('@/lib/cycle/load-data');

const require = createRequire(import.meta.url);
const NodeModule = require('node:module') as {
  _load: (request: string, parent: unknown, isMain: boolean) => unknown;
};
const originalModuleLoad = NodeModule._load;

let bigQueryModulePromise: Promise<BigQueryModuleExports> | null = null;
let bigQueryTablesModulePromise: Promise<BigQueryTablesModuleExports> | null = null;
let bigQueryMasterDataModulePromise: Promise<BigQueryMasterDataModuleExports> | null = null;
let postgresMasterDataModulePromise: Promise<PostgresMasterDataModuleExports> | null = null;
let marketDataRouterModulePromise: Promise<MarketDataRouterModuleExports> | null = null;
let cycleLoadDataModulePromise: Promise<CycleLoadDataModuleExports> | null = null;

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

async function loadBigQueryTablesModule(): Promise<BigQueryTablesModuleExports> {
  if (!bigQueryTablesModulePromise) {
    NodeModule._load = function patchedModuleLoad(request: string, parent: unknown, isMain: boolean) {
      if (request === 'server-only') {
        return {};
      }

      return originalModuleLoad.call(this, request, parent, isMain);
    };
    bigQueryTablesModulePromise = import('@/lib/data/bigquery-tables').finally(() => {
      NodeModule._load = originalModuleLoad;
    });
  }

  return bigQueryTablesModulePromise;
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

async function loadMarketDataRouterModule(): Promise<MarketDataRouterModuleExports> {
  if (!marketDataRouterModulePromise) {
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
    marketDataRouterModulePromise = import('@/lib/data/market-data-router')
      .finally(() => {
        NodeModule._load = originalModuleLoad;
        if (originalUrl === undefined) delete process.env.NEXT_PUBLIC_SUPABASE_URL;
        else process.env.NEXT_PUBLIC_SUPABASE_URL = originalUrl;

        if (originalAnonKey === undefined) delete process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
        else process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY = originalAnonKey;
      });
  }

  return marketDataRouterModulePromise;
}

async function loadCycleLoadDataModule(): Promise<CycleLoadDataModuleExports> {
  if (!cycleLoadDataModulePromise) {
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
    cycleLoadDataModulePromise = import('@/lib/cycle/load-data')
      .finally(() => {
        NodeModule._load = originalModuleLoad;
        if (originalUrl === undefined) delete process.env.NEXT_PUBLIC_SUPABASE_URL;
        else process.env.NEXT_PUBLIC_SUPABASE_URL = originalUrl;

        if (originalAnonKey === undefined) delete process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
        else process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY = originalAnonKey;
      });
  }

  return cycleLoadDataModulePromise;
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
    location: process.env.BIGQUERY_LOCATION,
    warmMonths: process.env.MARKET_DATA_WARM_RETENTION_MONTHS,
  };

  try {
    process.env.BIGQUERY_PROJECT_ID = 'scout-dev';
    process.env.GOOGLE_CLOUD_PROJECT = 'ignored-fallback';
    process.env.BIGQUERY_DATASET_ID = 'market_router';
    process.env.BIGQUERY_LOCATION = 'US';
    process.env.MARKET_DATA_WARM_RETENTION_MONTHS = '9';

    assert.deepStrictEqual(getBigQueryReadConfig(), {
      projectId: 'scout-dev',
      datasetId: 'market_router',
      location: 'US',
      warmRetentionMonths: 9,
      isConfigured: true,
    });
    assert.strictEqual(getBigQueryTablePath('master_data'), 'scout-dev.market_router.master_data');
  } finally {
    for (const [key, value] of Object.entries(original)) {
      if (value === undefined) {
        delete process.env[key === 'projectId'
          ? 'BIGQUERY_PROJECT_ID'
          : key === 'fallbackProjectId'
            ? 'GOOGLE_CLOUD_PROJECT'
            : key === 'datasetId'
              ? 'BIGQUERY_DATASET_ID'
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
    credentialsPath: process.env.GOOGLE_APPLICATION_CREDENTIALS,
  };

  try {
    delete process.env.BIGQUERY_PROJECT_ID;
    delete process.env.GOOGLE_CLOUD_PROJECT;
    process.env.BIGQUERY_DATASET_ID = 'market_router';
    process.env.GOOGLE_APPLICATION_CREDENTIALS = 'C:\\keys\\scout.json';

    assert.deepStrictEqual(getBigQueryReadConfig(), {
      projectId: null,
      datasetId: 'market_router',
      location: 'US',
      warmRetentionMonths: 12,
      isConfigured: true,
    });
    assert.strictEqual(getBigQueryTablePath('master_data'), null);
  } finally {
    if (original.projectId === undefined) delete process.env.BIGQUERY_PROJECT_ID;
    else process.env.BIGQUERY_PROJECT_ID = original.projectId;

    if (original.fallbackProjectId === undefined) delete process.env.GOOGLE_CLOUD_PROJECT;
    else process.env.GOOGLE_CLOUD_PROJECT = original.fallbackProjectId;

    if (original.datasetId === undefined) delete process.env.BIGQUERY_DATASET_ID;
    else process.env.BIGQUERY_DATASET_ID = original.datasetId;

    if (original.credentialsPath === undefined) delete process.env.GOOGLE_APPLICATION_CREDENTIALS;
    else process.env.GOOGLE_APPLICATION_CREDENTIALS = original.credentialsPath;
  }
});

test('builds logical BigQuery table identifiers from the shared registry', async () => {
  const { BIGQUERY_TABLES, getBigQueryTableIdentifier } = await loadBigQueryTablesModule();
  const originalProjectId = process.env.BIGQUERY_PROJECT_ID;
  const originalDatasetId = process.env.BIGQUERY_DATASET_ID;

  try {
    process.env.BIGQUERY_PROJECT_ID = 'scout-dev';
    process.env.BIGQUERY_DATASET_ID = 'market_router';

    assert.strictEqual(BIGQUERY_TABLES.masterData, 'master_data');
    assert.strictEqual(getBigQueryTableIdentifier(BIGQUERY_TABLES.masterData), '`scout-dev.market_router.master_data`');
  } finally {
    if (originalProjectId === undefined) delete process.env.BIGQUERY_PROJECT_ID;
    else process.env.BIGQUERY_PROJECT_ID = originalProjectId;

    if (originalDatasetId === undefined) delete process.env.BIGQUERY_DATASET_ID;
    else process.env.BIGQUERY_DATASET_ID = originalDatasetId;
  }
});

test('creates a BigQuery client through an injected module loader', async () => {
  const { getBigQueryClient } = await loadBigQueryModule();
  const originalProjectId = process.env.BIGQUERY_PROJECT_ID;
  const originalDatasetId = process.env.BIGQUERY_DATASET_ID;

  try {
    process.env.BIGQUERY_PROJECT_ID = 'scout-dev';
    process.env.BIGQUERY_DATASET_ID = 'market_router';

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
  process.env.BIGQUERY_PROJECT_ID = 'scout-dev';
  process.env.BIGQUERY_DATASET_ID = 'market_router';
  const client = {
    query({ query, params }: { query: string; params: { submarketId?: string; submarketIds?: string[]; rowLimit: number } }) {
      assert.strictEqual(params.rowLimit, 1);
      assert.match(query, /market_router\.master_data/);
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
  }
});

test('fetchRowsForSubmarkets does not impose a synthetic global cap when no limit is provided', async () => {
  const { fetchRowsForSubmarkets } = await loadPostgresMasterDataModule();
  let seenLimit: number | null = null;

  const result = Promise.resolve({ data: [], error: null });
  const query = {
    in() {
      return query;
    },
    order() {
      return query;
    },
    limit(limitValue: number) {
      seenLimit = limitValue;
      return result;
    },
    then: result.then.bind(result),
  };

  const client = {
    from() {
      return {
        select() {
          return query;
        },
      };
    },
  };

  await fetchRowsForSubmarkets(['77002', '77003'], {
    client: client as never,
    dataSource: ['Census ACS', 'HUD', 'Census BPS'],
    metricName: ['Total_Population', 'Permit_Units'],
  });

  assert.strictEqual(seenLimit, null);
});

test('routes series older than the warm window to BigQuery', async () => {
  const { shouldReadSeriesFromBigQuery } = await loadMarketDataRouterModule();

  assert.strictEqual(shouldReadSeriesFromBigQuery('2020-01-01', 24, new Date('2026-04-17')), true);
  assert.strictEqual(shouldReadSeriesFromBigQuery('2025-01-01', 24, new Date('2026-04-17')), false);
});

test('merges and sorts warm and cold rows by time period', async () => {
  const { mergeSeriesRows } = await loadMarketDataRouterModule();

  const rows = mergeSeriesRows(
    [{
      submarket_id: '77002',
      metric_name: 'Unemployment_Rate',
      metric_value: 4.3,
      time_period: '2024-01-01',
      data_source: 'FRED',
      visual_bucket: 'TIME_SERIES',
      created_at: '2026-04-17T00:00:00.000Z',
    }],
    [{
      submarket_id: '77002',
      metric_name: 'Unemployment_Rate',
      metric_value: 5.1,
      time_period: '2023-01-01',
      data_source: 'FRED',
      visual_bucket: 'TIME_SERIES',
      created_at: '2026-04-16T00:00:00.000Z',
    }]
  )

  assert.deepStrictEqual(rows.map((row) => row.time_period), ['2023-01-01', '2024-01-01']);
});

test('normalizes since windows with UTC date math for date-only values', async () => {
  const { normalizeAnalyticalTimeWindow } = await loadMarketDataRouterModule();

  const normalized = normalizeAnalyticalTimeWindow(
    {
      mode: 'since',
      startDate: '2024-04-30',
    },
    new Date('2024-05-01T00:30:00.000Z')
  );

  assert.strictEqual(normalized.startDate, '2024-04-30');
  assert.strictEqual(normalized.monthsBack, 1);
  assert.strictEqual(normalized.label, 'Since 2024-04-30');
});

test('getMetricSeries reads BigQuery first when the request is outside the warm window', async () => {
  const { getMetricSeries } = await loadMarketDataRouterModule();
  const calls: string[] = [];

  const rows = await getMetricSeries(
    {
      submarketId: '77002',
      metricName: 'Unemployment_Rate',
      startDate: '2020-01-01',
    },
    {
      now: new Date('2026-04-17T00:00:00.000Z'),
      warmMonths: 12,
      fetchMetricSeriesFromPostgres: async () => {
        calls.push('postgres');
        return [];
      },
      fetchMetricSeriesFromBigQuery: async () => {
        calls.push('bigquery');
        return [{
          submarket_id: '77002',
          metric_name: 'Unemployment_Rate',
          metric_value: 4.1,
          time_period: '2020-01-01',
          data_source: 'FRED',
          visual_bucket: 'TIME_SERIES',
          created_at: '2026-04-17T00:00:00.000Z',
        }];
      },
    }
  );

  assert.deepStrictEqual(calls, ['bigquery', 'postgres']);
  assert.strictEqual(rows.length, 1);
  assert.strictEqual(rows[0]?.metric_value, 4.1);
});

test('getMetricSeries merges BigQuery history with warm Postgres rows when the request crosses the retention boundary', async () => {
  const { getMetricSeries } = await loadMarketDataRouterModule();
  const calls: Array<{ source: string; options?: Record<string, unknown> }> = [];

  const rows = await getMetricSeries(
    {
      submarketId: '77002',
      metricName: 'Unemployment_Rate',
      startDate: '2024-01-01',
    },
    {
      now: new Date('2026-04-17T00:00:00.000Z'),
      warmMonths: 12,
      fetchMetricSeriesFromPostgres: async (_submarketId, _metricName, options) => {
        calls.push({ source: 'postgres', options: options as Record<string, unknown> | undefined });
        return [{
          submarket_id: '77002',
          metric_name: 'Unemployment_Rate',
          metric_value: 4.1,
          time_period: '2025-05-01',
          data_source: 'FRED',
          visual_bucket: 'TIME_SERIES',
          created_at: '2026-04-17T00:00:00.000Z',
        }];
      },
      fetchMetricSeriesFromBigQuery: async (_submarketId, _metricName, options) => {
        calls.push({ source: 'bigquery', options: options as Record<string, unknown> | undefined });
        return [{
          submarket_id: '77002',
          metric_name: 'Unemployment_Rate',
          metric_value: 4.8,
          time_period: '2024-01-01',
          data_source: 'FRED',
          visual_bucket: 'TIME_SERIES',
          created_at: '2026-04-16T00:00:00.000Z',
        }];
      },
    }
  );

  assert.deepStrictEqual(calls.map((call) => call.source), ['bigquery', 'postgres']);
  assert.deepStrictEqual(calls[0]?.options?.startDate, '2024-01-01');
  assert.deepStrictEqual(calls[1]?.options?.startDate, '2025-04-01');
  assert.deepStrictEqual(
    rows.map((row) => row.time_period),
    ['2024-01-01', '2025-05-01']
  );
});

test('returns a comparison-ready rent ZIP history result', async () => {
  const { getAnalyticalComparisonForTest } = await loadMarketDataRouterModule();
  const calls: Array<{ zip: string; startDate: string }> = [];

  const result = await getAnalyticalComparisonForTest(
    {
      comparisonMode: 'history',
      metric: 'rent',
      subjectMarket: { kind: 'zip', id: '78701', label: '78701' },
      comparisonMarket: null,
      timeWindow: { mode: 'relative', unit: 'months', value: 24 },
    },
    {
      now: new Date('2026-04-18T00:00:00.000Z'),
      fetchRentSeries: async (zip, options) => {
        calls.push({ zip, startDate: options.startDate });
        return [
          { x: '2024-04', y: 2100 },
          { x: '2025-04', y: 2250 },
        ];
      },
    }
  );

  assert.deepStrictEqual(calls, [{ zip: '78701', startDate: '2024-04-01' }]);
  assert.strictEqual(result.metric, 'rent');
  assert.strictEqual(result.metricLabel, 'Rent');
  assert.strictEqual(result.timeWindow.startDate, '2024-04-01');
  assert.strictEqual(result.series[0]?.subject.kind, 'zip');
  assert.deepStrictEqual(
    result.series[0]?.points,
    [
      { x: '2024-04', y: 2100 },
      { x: '2025-04', y: 2250 },
    ]
  );
  assert.ok(result.citations.length >= 1);
});

test('returns a comparison-ready permit county history result', async () => {
  const { getAnalyticalComparisonForTest } = await loadMarketDataRouterModule();
  const calls: Array<{ submarketId: string; metricName: string; startDate: string }> = [];

  const result = await getAnalyticalComparisonForTest(
    {
      comparisonMode: 'history',
      metric: 'permit_units',
      subjectMarket: { kind: 'county', id: 'county:harris-tx', label: 'Harris County, TX' },
      comparisonMarket: null,
      timeWindow: { mode: 'relative', unit: 'years', value: 5 },
    },
    {
      now: new Date('2026-04-18T00:00:00.000Z'),
      fetchMetricSeries: async (args) => {
        calls.push({
          submarketId: args.submarketId,
          metricName: args.metricName,
          startDate: args.startDate,
        });
        return [
          {
            submarket_id: 'county:harris-tx',
            metric_name: 'Permit_Units',
            metric_value: 1024,
            time_period: '2021-04-01',
            data_source: 'Census BPS',
            visual_bucket: 'TIME_SERIES',
            created_at: '2026-04-18T00:00:00.000Z',
          },
          {
            submarket_id: 'county:harris-tx',
            metric_name: 'Permit_Units',
            metric_value: 1180,
            time_period: '2025-04-01',
            data_source: 'Census BPS',
            visual_bucket: 'TIME_SERIES',
            created_at: '2026-04-18T00:00:00.000Z',
          },
        ];
      },
    }
  );

  assert.deepStrictEqual(calls, [{
    submarketId: 'county:harris-tx',
    metricName: 'Permit_Units',
    startDate: '2021-04-01',
  }]);
  assert.strictEqual(result.metric, 'permit_units');
  assert.strictEqual(result.metricLabel, 'Permit units');
  assert.strictEqual(result.timeWindow.startDate, '2021-04-01');
  assert.strictEqual(result.series[0]?.subject.kind, 'county');
  assert.deepStrictEqual(
    result.series[0]?.points,
    [
      { x: '2021-04-01', y: 1024 },
      { x: '2025-04-01', y: 1180 },
    ]
  );
  assert.ok(result.citations.length >= 1);
});

test('rejects a non-null comparison market for history requests', async () => {
  const { getAnalyticalComparisonForTest } = await loadMarketDataRouterModule();

  await assert.rejects(
    () =>
      getAnalyticalComparisonForTest({
        comparisonMode: 'history',
        metric: 'rent',
        subjectMarket: { kind: 'zip', id: '78701', label: '78701' },
        comparisonMarket: { kind: 'zip', id: '77002', label: '77002' },
        timeWindow: { mode: 'relative', unit: 'months', value: 12 },
      }),
    /comparisonMarket/i
  );
});

test('rejects unsupported analytical metrics before querying history', async () => {
  const { getAnalyticalComparisonForTest } = await loadMarketDataRouterModule();
  await assert.rejects(
    () =>
      getAnalyticalComparisonForTest({
        comparisonMode: 'history',
        metric: 'median_income',
        subjectMarket: { kind: 'zip', id: '78701', label: '78701' },
        comparisonMarket: null,
        timeWindow: { mode: 'relative', unit: 'months', value: 12 },
      } as AnalyticalComparisonRequest),
    /Unsupported analytical metric/i
  );
});

test('router exports all required read intents', async () => {
  const router = await loadMarketDataRouterModule();

  assert.strictEqual(typeof router.getLatestRowsForSubmarket, 'function');
  assert.strictEqual(typeof router.getLatestRowsForSubmarkets, 'function');
  assert.strictEqual(typeof router.getAreaRows, 'function');
  assert.strictEqual(typeof router.getMetricSeries, 'function');
  assert.strictEqual(typeof router.upsertOperationalRows, 'function');
});

test('upsertOperationalRows respects ignore conflict mode for client-upload style writes', async () => {
  const { upsertOperationalRows } = await loadPostgresMasterDataModule();
  const calls: Array<{ ignoreDuplicates: boolean; onConflict: string }> = [];

  const client = {
    from() {
      return {
        upsert(_values: Record<string, unknown>[], options: { onConflict: string; ignoreDuplicates: boolean }) {
          calls.push(options);
          return Promise.resolve({ data: [], error: null });
        },
      };
    },
  };

  await upsertOperationalRows(
    [{
      submarket_id: '77002',
      geometry: null,
      metric_name: 'Imported_Metric',
      metric_value: 10,
      time_period: '2026-04-01',
      data_source: 'Client Upload',
      visual_bucket: 'TABULAR',
    }],
    {
      client: client as never,
      conflictMode: 'ignore',
    }
  );

  assert.deepStrictEqual(calls, [{
    onConflict: 'submarket_id,metric_name,time_period,data_source',
    ignoreDuplicates: true,
  }]);
});

test('loadCycleRawInputs pulls historical permit and unemployment series through the router when enabled', async () => {
  const { loadCycleRawInputs } = await loadCycleLoadDataModule();
  const seriesCalls: Array<{ metricName: string; startDate: string; dataSource: string | readonly string[] | undefined }> = [];

  const result = await loadCycleRawInputs('77002', {
    now: new Date('2026-04-18T00:00:00.000Z'),
    historicalSeriesEnabled: true,
    getRowsForSubmarket: async () => [{
      metric_name: 'Vacancy_Rate',
      metric_value: 7.1,
      data_source: 'Census ACS',
      time_period: '2026-01-01',
      created_at: '2026-04-18T00:00:00.000Z',
    }],
    getMetricSeries: async ({ metricName, startDate, dataSource }) => {
      seriesCalls.push({ metricName, startDate, dataSource });
      if (metricName === 'Unemployment_Rate') {
        return [{
          submarket_id: '77002',
          metric_name: 'Unemployment_Rate',
          metric_value: 4.2,
          time_period: '2024-01-01',
          data_source: 'FRED',
          visual_bucket: 'TIME_SERIES',
          created_at: '2026-04-18T00:00:00.000Z',
        }];
      }

      if (metricName === 'Permit_Units') {
        return [{
          submarket_id: '77002',
          metric_name: 'Permit_Units',
          metric_value: 120,
          time_period: '2022-01-01',
          data_source: 'Census BPS',
          visual_bucket: 'TIME_SERIES',
          created_at: '2026-04-18T00:00:00.000Z',
        }];
      }

      return [];
    },
    fetchZoriMonthly: async () => [],
    fetchZillowSnapshot: async () => ({
      zori_growth_12m: 2.4,
      zori_latest: 1835,
    }),
  });

  assert.deepStrictEqual(seriesCalls, [
    { metricName: 'Unemployment_Rate', startDate: '2023-04-01', dataSource: 'FRED' },
    { metricName: 'Permit_Units', startDate: '2020-01-01', dataSource: 'Census BPS' },
  ]);
  assert.deepStrictEqual(
    result.masterRows
      .map((row) => ({ metric_name: row.metric_name, time_period: row.time_period, data_source: row.data_source }))
      .sort((a, b) => a.metric_name.localeCompare(b.metric_name)),
    [
      { metric_name: 'Permit_Units', time_period: '2022-01-01', data_source: 'Census BPS' },
      { metric_name: 'Unemployment_Rate', time_period: '2024-01-01', data_source: 'FRED' },
      { metric_name: 'Vacancy_Rate', time_period: '2026-01-01', data_source: 'Census ACS' },
    ]
      .sort((a, b) => a.metric_name.localeCompare(b.metric_name))
  );
  assert.strictEqual(result.zoriGrowthYoy, 2.4);
  assert.strictEqual(result.zoriLatest, 1835);
});
