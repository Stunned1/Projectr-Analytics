import 'dotenv/config'

const baseUrl = process.env.PERF_BASE_URL ?? 'http://127.0.0.1:3000'

async function main() {
  const payload = {
    rows: [
      { rowId: 'row-1', locationText: '24060' },
      { rowId: 'row-2', locationText: '1600 Amphitheatre Parkway, Mountain View, CA' },
      { rowId: 'row-3', locationText: '1 Apple Park Way, Cupertino, CA' },
      { rowId: 'row-4', locationText: 'not-a-real-address-xyz' },
      { rowId: 'row-5', locationText: null },
    ],
    maxConcurrency: 4,
  }

  const response = await fetch(`${baseUrl}/api/upload/geocode`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(payload),
  })

  const json = await response.json()
  if (!response.ok) {
    console.error('Geocode smoke test failed:', json)
    process.exit(1)
  }

  const meta = json.meta as { total: number; ok: number; failed: number; maxConcurrency: number }
  console.log('--- Upload Geocode Smoke ---')
  console.log(`base_url=${baseUrl}`)
  console.log(`total=${meta.total} ok=${meta.ok} failed=${meta.failed} concurrency=${meta.maxConcurrency}`)

  const rows = (json.results as Array<{ rowId: string; status: string; formattedAddress?: string; error?: string }>) ?? []
  rows.forEach((row) => {
    if (row.status === 'ok') {
      console.log(`[ok] ${row.rowId} -> ${row.formattedAddress ?? 'address unavailable'}`)
    } else {
      console.log(`[failed] ${row.rowId} -> ${row.error ?? 'unknown error'}`)
    }
  })
}

main().catch((err) => {
  console.error('Unexpected smoke test error:', err instanceof Error ? err.message : err)
  process.exit(1)
})
