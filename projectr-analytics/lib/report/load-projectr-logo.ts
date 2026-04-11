import { readFileSync, existsSync } from 'fs'
import { join } from 'path'

/** Base64 data URI for `public/Projectr_Logo.png` (for @react-pdf Image). */
export function loadProjectrLogoDataUri(): string | null {
  try {
    const p = join(process.cwd(), 'public', 'Projectr_Logo.png')
    if (!existsSync(p)) return null
    return `data:image/png;base64,${readFileSync(p).toString('base64')}`
  } catch {
    return null
  }
}
