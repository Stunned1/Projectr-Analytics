export type SiteContextCategory =
  | 'food_bev'
  | 'coffee_cafe'
  | 'essentials'
  | 'fitness'
  | 'retail'

export const SITE_CONTEXT_CATEGORY_LABELS: Record<SiteContextCategory, string> = {
  food_bev: 'Food & Bev',
  coffee_cafe: 'Coffee & Cafe',
  essentials: 'Essentials',
  fitness: 'Fitness',
  retail: 'Retail',
}

const SITE_CONTEXT_CATEGORY_TO_GOOGLE_TYPES: Array<[SiteContextCategory, readonly string[]]> = [
  ['coffee_cafe', ['cafe', 'coffee_shop', 'coffee_tea_shop']],
  ['essentials', ['grocery_store', 'grocery_or_supermarket', 'supermarket', 'pharmacy', 'drug_store', 'drugstore', 'convenience_store']],
  ['fitness', ['gym', 'fitness_center', 'sports_club', 'health_club']],
  ['food_bev', ['restaurant', 'bar', 'bakery', 'meal_takeaway', 'meal_delivery']],
  ['retail', ['store', 'clothing_store', 'shopping_mall', 'department_store']],
]

function normalizeGooglePlaceType(value: string): string {
  return value.trim().toLowerCase().replace(/[\s-]+/g, '_')
}

export function mapGoogleTypesToSiteContextCategory(
  types: readonly string[] | null | undefined
): SiteContextCategory | null {
  if (!Array.isArray(types) || types.length === 0) return null

  const normalized = new Set(types.map((type) => normalizeGooglePlaceType(type)).filter(Boolean))

  for (const [category, candidates] of SITE_CONTEXT_CATEGORY_TO_GOOGLE_TYPES) {
    if (candidates.some((candidate) => normalized.has(candidate))) {
      return category
    }
  }

  return null
}
