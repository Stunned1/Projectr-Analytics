/**
 * Pre-warm Next.js API + Supabase cache for demo ZIPs (market, transit, trends, cycle).
 * Requires a running dev server and valid .env.local (same as the app).
 *
 *   cd projectr-analytics && npm run dev
 *   npm run warm:demo
 *
 * Default ZIPs: 77002 Houston, 75201 Dallas, 78701 Austin.
 */
import * as dotenv from 'dotenv'

dotenv.config({ path: '.env.local' })

const BASE = process.env.WARM_BASE_URL ?? 'http://127.0.0.1:3000'
const DEMO_ZIPS = ['77002', '75201', '78701']

async function warmZip(zip: string): Promise<void> {
  const label = `Demo ${zip}`
  const steps: { path: string; method?: string }[] = [
    { path: `/api/market?zip=${encodeURIComponent(zip)}` },
    { path: `/api/transit?zip=${encodeURIComponent(zip)}` },
    { path: `/api/trends?zip=${encodeURIComponent(zip)}` },
    { path: `/api/cycle?zip=${encodeURIComponent(zip)}&label=${encodeURIComponent(label)}` },
  ]

  for (const { path } of steps) {
    const url = `${BASE}${path}`
    const res = await fetch(url, { cache: 'no-store' })
    const ok = res.ok
    if (!ok) {
      const body = await res.text().catch(() => '')
      console.error(`[warm] FAIL ${zip} ${path} → ${res.status} ${body.slice(0, 200)}`)
    } else {
      console.log(`[warm] OK ${zip} ${path}`)
    }
  }
}

async function main(): Promise<void> {
  console.log(`[warm] Base URL: ${BASE}`)
  for (const zip of DEMO_ZIPS) {
    await warmZip(zip)
  }
  console.log('[warm] Done.')
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})
