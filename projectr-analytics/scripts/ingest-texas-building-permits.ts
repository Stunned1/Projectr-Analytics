import {
  buildTexasBuildingPermitRows,
  parseCliFlags,
  readTexasSourceRows,
  requireFileFlag,
  upsertTexasMasterData,
} from '../lib/texas-source-adapters'
import {
  fetchTexasBuildingPermitRows,
  parseTexasFetchLimit,
  parseTexasFetchMatch,
  parseTexasFetchScope,
} from '../lib/texas-source-fetchers'

async function main() {
  const flags = parseCliFlags(process.argv.slice(2))
  const filePath = flags.get('--file')
  const sheetName = flags.get('--sheet')
  const useFetch = flags.has('--fetch') || !filePath

  console.log('=== Texas Building Permits Ingest ===')
  let rows

  if (useFetch) {
    const scope = parseTexasFetchScope(flags.get('--scope'))
    const match = parseTexasFetchMatch(flags.get('--match'))
    const limit = parseTexasFetchLimit(flags.get('--limit'))

    console.log('Source: official TREC building permits API')
    console.log(`Scope: ${scope}`)
    if (match.length > 0) console.log(`Match: ${match.join(', ')}`)
    if (limit != null) console.log(`Limit: ${limit}`)

    const result = await fetchTexasBuildingPermitRows({ scope, match, limit })
    rows = result.rows
    console.log(`Geographies fetched: ${result.geographyCount}`)
  } else {
    const resolvedFilePath = requireFileFlag(flags)
    console.log(`Source: ${resolvedFilePath}`)
    if (sheetName) console.log(`Sheet: ${sheetName}`)

    const sourceRows = readTexasSourceRows(resolvedFilePath, sheetName)
    rows = buildTexasBuildingPermitRows(sourceRows)
  }

  await upsertTexasMasterData(rows)

  console.log(`Normalized rows: ${rows.length}`)
  console.log('=== Done ===')
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error)
  process.exit(1)
})
