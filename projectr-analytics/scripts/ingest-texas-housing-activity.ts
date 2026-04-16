import {
  buildTexasHousingActivityRows,
  parseCliFlags,
  readTexasSourceRows,
  requireFileFlag,
  upsertTexasMasterData,
} from '../lib/texas-source-adapters'

async function main() {
  const flags = parseCliFlags(process.argv.slice(2))
  const filePath = requireFileFlag(flags)
  const sheetName = flags.get('--sheet')

  console.log('=== Texas Housing Activity Ingest ===')
  console.log(`Source: ${filePath}`)
  if (sheetName) console.log(`Sheet: ${sheetName}`)

  const sourceRows = readTexasSourceRows(filePath, sheetName)
  const rows = buildTexasHousingActivityRows(sourceRows)
  await upsertTexasMasterData(rows)

  console.log(`Normalized rows: ${rows.length}`)
  console.log('=== Done ===')
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error)
  process.exit(1)
})
