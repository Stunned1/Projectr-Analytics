import test from 'node:test'
import assert from 'node:assert/strict'
import type { ReactNode, ReactElement } from 'react'

import { MarketReportDocument } from '@/lib/report/pdf-document'
import type { MarketReportPdfInput } from '@/lib/report/pdf-document'

function collectText(node: ReactNode): string[] {
  if (node == null || typeof node === 'boolean') return []
  if (typeof node === 'string' || typeof node === 'number') return [String(node)]
  if (Array.isArray(node)) return node.flatMap(collectText)
  if (typeof node === 'object' && 'props' in node) {
    const element = node as ReactElement<{ children?: ReactNode }>
    return collectText(element.props.children)
  }
  return []
}

function baseInput(): MarketReportPdfInput {
  return {
    payload: {
      marketLabel: 'Houston, TX',
      primaryZip: '77002',
      metroName: 'Houston, TX',
      generatedAt: '2026-04-20T00:00:00.000Z',
      layers: {
        zipBoundary: true,
        transitStops: false,
        rentChoropleth: true,
        blockGroups: false,
        parcels: false,
        tracts: false,
        amenityHeatmap: false,
        floodRisk: false,
        nycPermits: false,
        permitH3: false,
        clientData: false,
        choroplethMetric: 'zori',
      },
      geo: { lat: 29.7604, lng: -95.3698, city: 'Houston', state: 'TX' },
      zillow: {
        zori: 1800,
        zori_growth_yoy: 3.2,
        zhvi: 325000,
        zhvi_growth_yoy: 2.1,
      },
      census: {
        vacancy_rate: 6.1,
        median_income: 75000,
        total_population: 100000,
        median_gross_rent_acs: 1500,
        migration_movers: 45,
        population_growth_3yr: 1.5,
      },
      permits: {
        total_units_2021_2023: 20,
        by_year: [{ year: '2025', units: 20 }],
      },
      employment: {
        unemployment_rate: 4.2,
        employment_rate: 95.8,
      },
      fred: {
        unemployment_monthly: [{ date: '2026-01-01', value: 4.2 }],
      },
      trends: {
        series: [{ date: '2026-01-01', value: 50 }],
        keyword_scope: 'Houston, TX',
      },
      pins: [],
      zori_peer_zips: ['77002'],
    },
    brief: {
      cycleHeadline: 'Houston, TX: Market Assessment',
      narrative: 'Narrative.',
      confidenceLine: 'Signals are mixed.',
    },
    dossier: {
      geographyContext: 'Context.',
      executiveSummary: 'Executive.',
      demandAndDemographics: { title: 'Demand', body: 'Demand body.' },
      supplyAndConstruction: { title: 'Supply', body: 'Supply body.' },
      pricingAndCapitalMarkets: { title: 'Pricing', body: 'Pricing body.' },
      laborAndMacro: { title: 'Labor', body: 'Labor body.' },
      peerAndBenchmarkRead: 'Peer read.',
      risks: ['Risk.'],
      opportunities: ['Opportunity.'],
      scenarios: ['Scenario.'],
      monitoringChecklist: ['Checklist.'],
      limitations: 'Limits.',
    },
    signals: [
      {
        id: 'rent',
        label: 'Rent',
        arrow: 'up',
        line: 'Rent is rising.',
        positiveForInvestor: true,
      },
    ],
    zoriSeries: [{ date: '2026-01-01', value: 100 }],
    zoriSeriesSource: 'zillow_monthly',
    trendsSeries: [{ date: '2026-01-01', value: 50 }],
    metro: null,
    logoDataUri: null,
    siteRows: [
      {
        label: 'Site A',
        zip: '77002',
        zori: 1800,
        momentum: 70,
        signalLine: 'Heating.',
      },
      {
        label: 'Site B',
        zip: '77003',
        zori: 1700,
        momentum: 55,
        signalLine: 'Balanced.',
      },
    ],
  }
}

test('market report document does not render cycle sections', () => {
  const doc = MarketReportDocument(baseInput())
  const text = collectText(doc).join(' ')

  assert.equal(text.includes('Cycle map'), false)
  assert.equal(text.includes('Analytical cycle classifier'), false)
})

test('site comparison page does not render a cycle column', () => {
  const doc = MarketReportDocument(baseInput())
  const text = collectText(doc).join(' ')

  assert.equal(/\bCycle\b/.test(text), false)
  assert.equal(text.includes('cycle phase'), false)
})
