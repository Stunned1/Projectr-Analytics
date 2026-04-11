import 'dotenv/config'

const baseUrl = process.env.PERF_BASE_URL ?? 'http://127.0.0.1:3000'

async function main() {
  const payload = {
    rows: [
      { rowId: 'ctx-1', lat: 37.2563, lng: -80.4347, zip: '24060' },
      { rowId: 'ctx-2', lat: 37.386, lng: -122.0838, zip: null as string | null },
    ],
    maxConcurrency: 4,
  }

  const response = await fetch(`${baseUrl}/api/upload/context`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(payload),
  })

  const json = await response.json()
  if (!response.ok) {
    console.error('Context smoke test failed:', json)
    process.exit(1)
  }

  const meta = json.meta as { total: number; ok: number; failed: number; uniqueZips: number }
  console.log('--- Upload Context Smoke ---')
  console.log(`base_url=${baseUrl}`)
  console.log(
    `total=${meta.total} ok=${meta.ok} failed=${meta.failed} unique_zips=${meta.uniqueZips}`
  )

  const rows = json.results as Array<{
    rowId: string
    status: string
    zip?: string
    momentumScore?: number
    cyclePosition?: string
    market?: { zori_latest: number | null }
    error?: string
  }>
  rows.forEach((r) => {
    if (r.status === 'ok') {
      console.log(
        `[ok] ${r.rowId} zip=${r.zip} momentum=${r.momentumScore} ${r.cyclePosition} zori=${r.market?.zori_latest ?? '—'}`
      )
    } else {
      console.log(`[failed] ${r.rowId} -> ${r.error ?? 'unknown'}`)
    }
  })
}

main().catch((err) => {
  console.error('Unexpected smoke test error:', err instanceof Error ? err.message : err)
  process.exit(1)
})
