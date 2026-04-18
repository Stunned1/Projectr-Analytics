export interface BoundaryZipTarget {
  lat: number | null
  lng: number | null
}

export const MAX_MULTI_ZIP_BOUNDARIES = 120

export function selectMultiZipBoundaryTargets<T extends BoundaryZipTarget>(
  rows: readonly T[],
  limit = MAX_MULTI_ZIP_BOUNDARIES
): T[] {
  return rows.filter((row) => row.lat != null && row.lng != null).slice(0, limit)
}
