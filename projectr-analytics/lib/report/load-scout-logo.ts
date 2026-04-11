import { existsSync, readFileSync } from 'fs'
import { join } from 'path'

/** Base64 data URI for PDF header; prefers `public/Scout_Logo.png`, then legacy `Projectr_Logo.png`. */
export function loadScoutLogoDataUri(): string | null {
  const pub = join(process.cwd(), 'public')
  for (const name of ['Scout_Logo.png', 'Projectr_Logo.png'] as const) {
    const p = join(pub, name)
    if (!existsSync(p)) continue
    try {
      const buf = readFileSync(p)
      return `data:image/png;base64,${buf.toString('base64')}`
    } catch {
      return null
    }
  }
  return null
}
