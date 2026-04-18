import * as dotenv from 'dotenv'
import { createRequire } from 'node:module'

dotenv.config({ path: '.env.local' })

type ProbeRow = {
  submarket_id?: string | null
  metric_name?: string | null
  time_period?: string | null
  data_source?: string | null
}

async function main(): Promise<void> {
  const require = createRequire(import.meta.url)
  const NodeModule = require('node:module') as {
    _load: (request: string, parent: unknown, isMain: boolean) => unknown
  }
  const originalModuleLoad = NodeModule._load

  NodeModule._load = function patchedModuleLoad(request: string, parent: unknown, isMain: boolean) {
    if (request === 'server-only') {
      return {}
    }

    return originalModuleLoad.call(this, request, parent, isMain)
  }

  const [{ getBigQueryClient, getBigQueryReadConfig }, { BIGQUERY_TABLES, getBigQueryTableIdentifier }] =
    await Promise.all([
      import('../lib/data/bigquery'),
      import('../lib/data/bigquery-tables'),
    ]).finally(() => {
      NodeModule._load = originalModuleLoad
    })

  const config = getBigQueryReadConfig()
  const logicalTables = Object.fromEntries(
    Object.entries(BIGQUERY_TABLES).map(([logicalName, tableName]) => [
      logicalName,
      getBigQueryTableIdentifier(tableName),
    ])
  )

  console.log('[bigquery] config')
  console.log(JSON.stringify(config, null, 2))
  console.log('[bigquery] logical tables')
  console.log(JSON.stringify(logicalTables, null, 2))

  if (!config.isConfigured) {
    console.error('[bigquery] BIGQUERY_DATASET_ID is missing; dataset-scoped BigQuery reads are disabled.')
    process.exit(1)
  }

  const client = await getBigQueryClient()
  if (typeof client.query !== 'function') {
    throw new Error('BigQuery client does not support query()')
  }

  const masterDataTable = getBigQueryTableIdentifier(BIGQUERY_TABLES.masterData)
  console.log(`[bigquery] probing ${masterDataTable}`)

  const result = await client.query({
    query: `
      SELECT submarket_id, metric_name, time_period, data_source
      FROM ${masterDataTable}
      LIMIT 1
    `,
    location: config.location,
    useLegacySql: false,
  }) as ProbeRow[] | [ProbeRow[], ...unknown[]]

  const rows = Array.isArray(result[0]) ? result[0] as ProbeRow[] : result as ProbeRow[]
  console.log(`[bigquery] probe succeeded; rows returned: ${rows.length}`)
  if (rows[0]) {
    console.log('[bigquery] sample row')
    console.log(JSON.stringify(rows[0], null, 2))
  } else {
    console.log('[bigquery] table is reachable but returned no rows for LIMIT 1.')
  }
}

main().catch((error) => {
  const message = error instanceof Error ? error.stack ?? error.message : String(error)
  console.error('[bigquery] probe failed')
  console.error(message)
  process.exit(1)
})
