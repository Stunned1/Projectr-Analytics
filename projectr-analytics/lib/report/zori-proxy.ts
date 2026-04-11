/**
 * Zillow snapshots only store latest ZORI + YoY - approximate a monthly series for the PDF chart.
 * Footnote in PDF labels this as modeled from latest index and YoY change.
 */
export function buildZoriProxySeries(
  latest: number | null,
  yoyGrowthPct: number | null,
  months = 20
): { date: string; value: number }[] {
  if (latest == null || latest <= 0) return []
  const gAnnual = yoyGrowthPct != null && Number.isFinite(yoyGrowthPct) ? yoyGrowthPct / 100 : 0
  const monthlyMult = gAnnual === 0 ? 1 : Math.pow(1 + gAnnual, 1 / 12)

  const out: { date: string; value: number }[] = []
  const now = new Date()
  for (let i = 0; i < months; i++) {
    const m = months - 1 - i
    const d = new Date(now.getFullYear(), now.getMonth() - m, 1)
    const value = latest / Math.pow(monthlyMult, i)
    out.push({ date: d.toISOString().slice(0, 7), value: Math.round(value) })
  }
  return out
}
