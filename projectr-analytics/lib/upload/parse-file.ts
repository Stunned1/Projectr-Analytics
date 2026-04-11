import Papa from 'papaparse'
import * as XLSX from 'xlsx'
import { detectLatLngColumns } from './lat-lng-detect'
import type { UploadCellValue, UploadParseResult, UploadRawRow } from './types'

function normalizeCell(value: unknown): UploadCellValue {
  if (value === null || value === undefined) return null
  if (typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean') return value
  return String(value)
}

function isRowEmpty(row: UploadRawRow): boolean {
  return Object.values(row).every((value) => {
    if (value === null || value === undefined) return true
    if (typeof value === 'string') return value.trim().length === 0
    return false
  })
}

function sanitizeColumns(columns: string[]): string[] {
  return columns.map((column, idx) => {
    const clean = String(column ?? '').trim()
    return clean.length > 0 ? clean : `column_${idx + 1}`
  })
}

function parseCsvFile(file: File): Promise<UploadParseResult> {
  return new Promise((resolve, reject) => {
    Papa.parse<Record<string, unknown>>(file, {
      header: true,
      skipEmptyLines: true,
      complete: (result) => {
        if (result.errors.length > 0) {
          reject(new Error(result.errors[0].message))
          return
        }
        const columns = sanitizeColumns((result.meta.fields ?? []).map((f) => String(f)))
        const rows = (result.data ?? [])
          .map((raw) => {
            const normalized: UploadRawRow = {}
            columns.forEach((col) => {
              normalized[col] = normalizeCell(raw[col])
            })
            return normalized
          })
          .filter((row) => !isRowEmpty(row))
        const hints = detectLatLngColumns(columns)
        resolve({ columns, rows, hints })
      },
      error: (error) => reject(error),
    })
  })
}

async function parseExcelFile(file: File): Promise<UploadParseResult> {
  const buffer = await file.arrayBuffer()
  const workbook = XLSX.read(buffer, { type: 'array' })
  const firstSheetName = workbook.SheetNames[0]
  if (!firstSheetName) return { columns: [], rows: [], hints: { latColumn: null, lngColumn: null } }

  const sheet = workbook.Sheets[firstSheetName]
  const data = XLSX.utils.sheet_to_json<unknown[]>(sheet, {
    header: 1,
    raw: true,
    defval: null,
    blankrows: false,
  })

  if (!data.length) return { columns: [], rows: [], hints: { latColumn: null, lngColumn: null } }
  const headerRow = data[0] ?? []
  const columns = sanitizeColumns(headerRow.map((v) => String(v ?? '')))
  const rows = data
    .slice(1)
    .map((cells) => {
      const normalized: UploadRawRow = {}
      columns.forEach((col, idx) => {
        normalized[col] = normalizeCell(cells[idx])
      })
      return normalized
    })
    .filter((row) => !isRowEmpty(row))

  const hints = detectLatLngColumns(columns)
  return { columns, rows, hints }
}

export async function parseUploadFile(file: File): Promise<UploadParseResult> {
  const name = file.name.toLowerCase()
  if (name.endsWith('.csv')) return parseCsvFile(file)
  if (name.endsWith('.xlsx')) return parseExcelFile(file)
  throw new Error('Unsupported file type. Upload CSV or XLSX only.')
}
