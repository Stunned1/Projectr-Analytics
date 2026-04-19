import test from 'node:test'
import assert from 'node:assert/strict'

import {
  classifyHoustonPermitRow,
  extractHoustonReportUrlsFromHtml,
  parseHoustonPermitWorksheetRows,
} from '@/lib/texas-raw-permits'

test('extractHoustonReportUrlsFromHtml keeps unique workbook links and favors the latest window', () => {
  const html = [
    'https://www.houstonpermittingcenter.org/sites/g/files/nwywnm431/files/2026-01/week-01.xlsx',
    'https://www.houstonpermittingcenter.org/sites/g/files/nwywnm431/files/2026-01/week-02.xlsx',
    'https://www.houstonpermittingcenter.org/sites/g/files/nwywnm431/files/2026-01/week-03.xlsx',
    'https://www.houstonpermittingcenter.org/sites/g/files/nwywnm431/files/2026-01/week-04.xlsx',
    'https://www.houstonpermittingcenter.org/sites/g/files/nwywnm431/files/2026-02/week-05.xlsx',
    'https://www.houstonpermittingcenter.org/sites/g/files/nwywnm431/files/2026-02/week-06.xlsx',
    'https://www.houstonpermittingcenter.org/sites/g/files/nwywnm431/files/2026-02/week-07.xlsx',
    'https://www.houstonpermittingcenter.org/sites/g/files/nwywnm431/files/2026-03/week-08.xlsx',
    'https://www.houstonpermittingcenter.org/sites/g/files/nwywnm431/files/2026-03/week-09.xlsx',
    'https://www.houstonpermittingcenter.org/sites/g/files/nwywnm431/files/2026-04/week-10.xlsx',
    'https://www.houstonpermittingcenter.org/sites/g/files/nwywnm431/files/2026-04/week-10.xlsx',
  ].join('\n')

  assert.deepStrictEqual(extractHoustonReportUrlsFromHtml(html), [
    'https://www.houstonpermittingcenter.org/sites/g/files/nwywnm431/files/2026-01/week-03.xlsx',
    'https://www.houstonpermittingcenter.org/sites/g/files/nwywnm431/files/2026-01/week-04.xlsx',
    'https://www.houstonpermittingcenter.org/sites/g/files/nwywnm431/files/2026-02/week-05.xlsx',
    'https://www.houstonpermittingcenter.org/sites/g/files/nwywnm431/files/2026-02/week-06.xlsx',
    'https://www.houstonpermittingcenter.org/sites/g/files/nwywnm431/files/2026-02/week-07.xlsx',
    'https://www.houstonpermittingcenter.org/sites/g/files/nwywnm431/files/2026-03/week-08.xlsx',
    'https://www.houstonpermittingcenter.org/sites/g/files/nwywnm431/files/2026-03/week-09.xlsx',
    'https://www.houstonpermittingcenter.org/sites/g/files/nwywnm431/files/2026-04/week-10.xlsx',
  ])
})

test('parseHoustonPermitWorksheetRows skips the workbook preamble and blank rows', () => {
  const rows = parseHoustonPermitWorksheetRows([
    ['Web eReport', null, null, null, null, null],
    [null, null, null, null, null, null],
    ['Zip Code', 'Permit Date', 'Permit Type', 'Project No', 'Address', 'Comments'],
    ['77002', '2026/01/07', 'Building Pmt', '25081710', '701 JEFFERSON ST FLR FL 4', 'GARAGE GENERATOR REPLACEMENT 21IBC'],
    [null, null, null, null, null, null],
    ['77003', '2026/01/05', 'Demolition', '25119608', '1836 POLK ST', 'DEMO BLDG/SEWER DISC'],
  ])

  assert.deepStrictEqual(rows, [
    {
      zip_code: '77002',
      permit_date: '2026/01/07',
      permit_type: 'Building Pmt',
      project_no: '25081710',
      address: '701 JEFFERSON ST FLR FL 4',
      comments: 'GARAGE GENERATOR REPLACEMENT 21IBC',
    },
    {
      zip_code: '77003',
      permit_date: '2026/01/05',
      permit_type: 'Demolition',
      project_no: '25119608',
      address: '1836 POLK ST',
      comments: 'DEMO BLDG/SEWER DISC',
    },
  ])
})

test('classifyHoustonPermitRow distinguishes demolition, new construction, and renovation', () => {
  assert.equal(
    classifyHoustonPermitRow({
      permit_type: 'Demolition',
      comments: 'DEMO RES/SEWER DISC',
    }),
    'demolition'
  )

  assert.equal(
    classifyHoustonPermitRow({
      permit_type: 'Building Pmt',
      comments: 'NEW 229 LF 10 FT FENCE WITH BARBED WIRE 2021 IBC',
    }),
    'new_construction'
  )

  assert.equal(
    classifyHoustonPermitRow({
      permit_type: 'Building Pmt',
      comments: '6,674 SF OFFICE REMODEL 1-36-1-B-A 21 IBC SPK/FA',
    }),
    'major_renovation'
  )
})
