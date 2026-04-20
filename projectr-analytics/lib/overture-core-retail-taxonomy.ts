export const OVERTURE_SIGNAL_CATEGORY_NAMES = [
  'coffee_shop',
  'cafe',
  'grocery_store',
  'supermarket',
  'pharmacy',
  'drug_store',
  'fitness_center',
  'gym',
  'school',
  'university',
  'bar',
  'restaurant',
  'park',
  'playground',
  'bank',
] as const

export const OVERTURE_SIGNAL_CATEGORY_FILTER = OVERTURE_SIGNAL_CATEGORY_NAMES.join(',')

export const OVERTURE_ANCHOR_BRANDS = [
  'Whole Foods',
  'Whole Foods Market',
  'Equinox',
  'SoulCycle',
  "Barry's",
  'Orangetheory',
  'Sweetgreen',
  'Dig',
  'Bluestone Lane',
  'Erewhon',
  "Trader Joe's",
  'Apple Store',
  'Apple',
  'Lululemon',
  'Warby Parker',
  'Glossier',
  'WeWork',
  'Industrious',
  'Regus',
  'Shake Shack',
  'Dig Inn',
] as const

export function normalizeOvertureAnchorBrandValue(value: string): string {
  return value.trim().toLowerCase().replace(/[^a-z0-9]+/g, ' ').replace(/\s+/g, ' ')
}

const OVERTURE_ANCHOR_BRAND_SET = new Set(
  OVERTURE_ANCHOR_BRANDS.map((brand) => normalizeOvertureAnchorBrandValue(brand))
)

export function isOvertureAnchorBrandValue(value: string): boolean {
  return OVERTURE_ANCHOR_BRAND_SET.has(normalizeOvertureAnchorBrandValue(value))
}

export const OVERTURE_CORE_RETAIL_CATEGORY_TO_BUCKET = {
  restaurant: 'food_bev',
  bakery: 'food_bev',
  bar: 'food_bev',
  sandwich_shop: 'food_bev',
  burger_restaurant: 'food_bev',
  seafood_restaurant: 'food_bev',
  coffee_shop: 'coffee_cafe',
  cafe: 'coffee_cafe',
  grocery_store: 'essentials',
  supermarket: 'essentials',
  pharmacy: 'essentials',
  drug_store: 'essentials',
  fitness_center: 'fitness',
  gym: 'fitness',
} as const

export const OVERTURE_CORE_RETAIL_CATEGORY_NAMES = Object.keys(
  OVERTURE_CORE_RETAIL_CATEGORY_TO_BUCKET
) as Array<keyof typeof OVERTURE_CORE_RETAIL_CATEGORY_TO_BUCKET>

export const OVERTURE_CORE_RETAIL_CATEGORY_FILTER = OVERTURE_CORE_RETAIL_CATEGORY_NAMES.join(',')

export const OVERTURE_CORE_RETAIL_BUCKET_LABELS = {
  food_bev: 'Food & Bev',
  coffee_cafe: 'Coffee & Cafe',
  essentials: 'Essentials',
  fitness: 'Fitness',
} as const

export const OVERTURE_CORE_RETAIL_BUCKET_KEYS = Object.keys(
  OVERTURE_CORE_RETAIL_BUCKET_LABELS
) as Array<keyof typeof OVERTURE_CORE_RETAIL_BUCKET_LABELS>
