import {
  buildTexasDemographicRows,
  parseCliFlags,
  readTexasSourceRows,
  requireFileFlag,
  upsertTexasMasterData,
} from '../lib/texas-source-adapters'

async function main() {
  const flags = parseCliFlags(process.argv.slice(2))
  const filePath = requireFileFlag(flags)
  const sheetName = flags.get('--sheet')
  const dataset = flags.get('--dataset') === 'projections' ? 'demographics-projections' : 'demographics-estimates'

  console.log('=== Texas Demographics Ingest ===')
  console.log(`Source: ${filePath}`)
  console.log(`Dataset: ${dataset === 'demographics-projections' ? 'projections' : 'estimates'}`)
  if (sheetName) console.log(`Sheet: ${sheetName}`)

  const sourceRows = readTexasSourceRows(filePath, sheetName)
  const rows = buildTexasDemographicRows(sourceRows, dataset)
  await upsertTexasMasterData(rows)

  console.log(`Normalized rows: ${rows.length}`)
  console.log('=== Done ===')
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error)
  process.exit(1)
})
