/**
 * Gemini JSON mode and example-heavy prompts often yield strings wrapped in ASCII or curly quotes,
 * or copy the prompt's "e.g. \"...\"" delimiters into fields like confidenceEcho. Those values
 * feed PDF confidence lines next to signal tiles, so stray quotes read as a signal bug.
 */
export function stripGeminiStringWrappers(s: string): string {
  let t = s.trim()
  for (let i = 0; i < 4; i++) {
    let changed = false
    const pairs: Array<[string, string]> = [
      ['"', '"'],
      ['\u201c', '\u201d'],
      ['\u2018', '\u2019'],
    ]
    for (const [open, close] of pairs) {
      if (t.length >= 2 && t.startsWith(open) && t.endsWith(close)) {
        t = t.slice(open.length, t.length - close.length).trim()
        changed = true
        break
      }
    }
    if (!changed) break
  }
  return t
}
