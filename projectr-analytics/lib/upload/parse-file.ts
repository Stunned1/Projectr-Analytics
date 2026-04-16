import Papa from 'papaparse'
import * as XLSX from 'xlsx'
import { detectLatLngColumns } from './lat-lng-detect'
import type {
  UploadCellValue,
  UploadFileFormat,
  UploadParseResult,
  UploadRawRow,
} from './types'

const MAX_UPLOAD_SAMPLE_ROWS = 5

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

function finalizeParseResult(
  file: File,
  format: UploadFileFormat,
  columns: string[],
  rows: UploadRawRow[],
  emptyRowCount: number
): UploadParseResult {
  if (columns.length === 0) {
    throw new Error('Uploaded file has no usable headers.')
  }
  if (rows.length === 0) {
    throw new Error('Uploaded file has no non-empty data rows.')
  }

  const sampleRows = rows.slice(0, MAX_UPLOAD_SAMPLE_ROWS)
  const hints = detectLatLngColumns(columns)

  return {
    columns,
    rows,
    hints,
    file: {
      fileName: file.name,
      format,
      byteSize: file.size,
      columnCount: columns.length,
      rowCount: rows.length,
      sampleRowCount: sampleRows.length,
      emptyRowCount,
    },
    sampleRows,
  }
}

function parseCsvText(
  text: string,
  file: File,
  format: Extract<UploadFileFormat, 'csv' | 'txt'>
): Promise<UploadParseResult> {
  return new Promise((resolve, reject) => {
    Papa.parse<Record<string, unknown>>(text, {
      header: true,
      skipEmptyLines: false,
      transformHeader: (header) => String(header).trim().replace(/^\uFEFF/, ''),
      complete: (result) => {
        const fatalErrors = result.errors.filter(
          (error) => error.type !== 'FieldMismatch'
        )
        if (fatalErrors.length > 0) {
          reject(new Error(fatalErrors[0].message))
          return
        }
        const columns = sanitizeColumns((result.meta.fields ?? []).map((f) => String(f)))
        const normalizedRows = (result.data ?? [])
          .map((raw) => {
            const normalized: UploadRawRow = {}
            columns.forEach((col) => {
              normalized[col] = normalizeCell(raw[col])
            })
            return normalized
          })
        const rows = normalizedRows.filter((row) => !isRowEmpty(row))
        const emptyRowCount = normalizedRows.length - rows.length
        resolve(finalizeParseResult(file, format, columns, rows, emptyRowCount))
      },
      error: (error: Error) => reject(error),
    })
  })
}

async function parseCsvFile(
  file: File,
  format: Extract<UploadFileFormat, 'csv' | 'txt'>
): Promise<UploadParseResult> {
  const text = await file.text()
  return parseCsvText(text, file, format)
}

async function parseExcelFile(file: File): Promise<UploadParseResult> {
  const buffer = await file.arrayBuffer()
  const workbook = XLSX.read(buffer, { type: 'array' })
  const firstSheetName = workbook.SheetNames[0]
  if (!firstSheetName) {
    throw new Error('Uploaded workbook has no sheets.')
  }

  const sheet = workbook.Sheets[firstSheetName]
  const data = XLSX.utils.sheet_to_json<unknown[]>(sheet, {
    header: 1,
    raw: true,
    defval: null,
    blankrows: false,
  })

  if (!data.length) {
    throw new Error('Uploaded workbook has no rows.')
  }
  const headerRow = data[0] ?? []
  const columns = sanitizeColumns(headerRow.map((v) => String(v ?? '')))
  const normalizedRows = data
    .slice(1)
    .map((cells) => {
      const normalized: UploadRawRow = {}
      columns.forEach((col, idx) => {
        normalized[col] = normalizeCell(cells[idx])
      })
      return normalized
    })
  const rows = normalizedRows.filter((row) => !isRowEmpty(row))
  const emptyRowCount = normalizedRows.length - rows.length

  return finalizeParseResult(file, 'xlsx', columns, rows, emptyRowCount)
}

export async function parseUploadFile(file: File): Promise<UploadParseResult> {
  const name = file.name.toLowerCase()
  if (name.endsWith('.csv')) return parseCsvFile(file, 'csv')
  if (name.endsWith('.txt')) return parseCsvFile(file, 'txt')
  if (name.endsWith('.xlsx')) return parseExcelFile(file)
  throw new Error('Unsupported file type. Upload CSV, TXT, or XLSX only.')
}
