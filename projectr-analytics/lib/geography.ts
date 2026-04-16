export const TEXAS_MVP_SEARCH_EXAMPLES = [
  'Houston, TX',
  'Austin, TX',
  'Dallas, TX',
  'San Antonio, TX',
] as const

export const NYC_BOROUGH_NAMES = [
  'manhattan',
  'brooklyn',
  'queens',
  'bronx',
  'staten island',
] as const

export type NycBoroughName = (typeof NYC_BOROUGH_NAMES)[number]

type ZipRange = {
  min: string
  max: string
}

const NYC_BOROUGH_ZIP_RANGES: Record<NycBoroughName, ZipRange> = {
  manhattan: { min: '10001', max: '10282' },
  bronx: { min: '10451', max: '10475' },
  brooklyn: { min: '11200', max: '11256' },
  queens: { min: '11100', max: '11697' },
  'staten island': { min: '10300', max: '10315' },
}

function isZipInRange(zip: string, range: ZipRange): boolean {
  return zip >= range.min && zip <= range.max
}

export function isNycBoroughName(value: string | null | undefined): value is NycBoroughName {
  if (!value) return false
  return (NYC_BOROUGH_NAMES as readonly string[]).includes(value.trim().toLowerCase())
}

export function getNycBoroughFromZip(zip: string | null | undefined): NycBoroughName | null {
  if (!zip || !/^\d{5}$/.test(zip)) return null

  for (const borough of NYC_BOROUGH_NAMES) {
    if (isZipInRange(zip, NYC_BOROUGH_ZIP_RANGES[borough])) {
      return borough
    }
  }
  return null
}

export function isNycZip(zip: string | null | undefined): boolean {
  return getNycBoroughFromZip(zip) !== null
}

export function detectNycBoroughFromZips(
  zips: Array<{ zip: string }> | null | undefined
): NycBoroughName | null {
  if (!zips?.length) return null
  const first = getNycBoroughFromZip(zips[0]?.zip)
  if (!first) return null
  return zips.every((row) => getNycBoroughFromZip(row.zip) === first) ? first : null
}
