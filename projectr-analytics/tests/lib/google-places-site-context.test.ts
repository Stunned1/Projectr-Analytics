import test from 'node:test'
import assert from 'node:assert/strict'

import { categorizeGooglePlaceTypes, summarizeSiteContext } from '@/lib/google-places-site-context'
import { mapGoogleTypesToSiteContextCategory } from '@/lib/site-context-taxonomy'

test('categorizeGooglePlaceTypes maps coffee and cafe types into coffee_cafe', () => {
  assert.equal(categorizeGooglePlaceTypes(['cafe', 'coffee_shop']), 'coffee_cafe')
})

test('mapGoogleTypesToSiteContextCategory maps essentials and retail types', () => {
  assert.equal(mapGoogleTypesToSiteContextCategory(['pharmacy']), 'essentials')
  assert.equal(mapGoogleTypesToSiteContextCategory(['grocery_or_supermarket']), 'essentials')
  assert.equal(mapGoogleTypesToSiteContextCategory(['restaurant']), 'food_bev')
  assert.equal(mapGoogleTypesToSiteContextCategory(['gym']), 'fitness')
  assert.equal(mapGoogleTypesToSiteContextCategory(['shopping_mall']), 'retail')
})

test('mapGoogleTypesToSiteContextCategory normalizes case whitespace and hyphens', () => {
  assert.equal(mapGoogleTypesToSiteContextCategory(['  COFFEE-SHOP  ']), 'coffee_cafe')
  assert.equal(mapGoogleTypesToSiteContextCategory(['  GROCERY STORE  ']), 'essentials')
  assert.equal(mapGoogleTypesToSiteContextCategory(['Meal-Delivery']), 'food_bev')
})

test('mapGoogleTypesToSiteContextCategory handles null empty and unmatched inputs', () => {
  assert.equal(mapGoogleTypesToSiteContextCategory(null), null)
  assert.equal(mapGoogleTypesToSiteContextCategory(undefined), null)
  assert.equal(mapGoogleTypesToSiteContextCategory([]), null)
  assert.equal(mapGoogleTypesToSiteContextCategory(['unknown_type']), null)
})

test('mapGoogleTypesToSiteContextCategory applies mixed-type precedence', () => {
  assert.equal(mapGoogleTypesToSiteContextCategory(['store', 'cafe']), 'coffee_cafe')
  assert.equal(mapGoogleTypesToSiteContextCategory(['restaurant', 'shopping_mall']), 'food_bev')
})

test('summarizeSiteContext formats a deterministic nearby summary', () => {
  assert.equal(
    summarizeSiteContext(500, [
      { category: 'coffee_cafe', label: 'Neighborhood Coffee', count: 2 },
      { category: 'food_bev', label: 'Corner Eats', count: 7 },
      { category: 'essentials', label: 'Daily Errands', count: 1 },
    ]),
    'Within 500m: 2 coffee & cafe, 7 food & bev, 1 essentials.'
  )
})

test('summarizeSiteContext handles empty nearby context', () => {
  assert.equal(summarizeSiteContext(250, []), 'No nearby place context found within 250m.')
})
