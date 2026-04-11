'use client'

import { useCallback, useRef, useState } from 'react'
import { parseUploadFile, type UploadParseResult } from '@/lib/upload'

interface UploadZoneProps {
  disabled?: boolean
  onParsed: (fileName: string, parsed: UploadParseResult) => void
  onError?: (message: string) => void
}

export default function UploadZone({ disabled, onParsed, onError }: UploadZoneProps) {
  const [dragActive, setDragActive] = useState(false)
  const [parsing, setParsing] = useState(false)
  const fileInputRef = useRef<HTMLInputElement | null>(null)

  const handleFiles = useCallback(async (files: FileList | null) => {
    const file = files?.[0]
    if (!file) return
    setParsing(true)
    try {
      const parsed = await parseUploadFile(file)
      onParsed(file.name, parsed)
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Failed to parse uploaded file'
      onError?.(message)
    } finally {
      setParsing(false)
      if (fileInputRef.current) fileInputRef.current.value = ''
    }
  }, [onParsed, onError])

  return (
    <div className="mt-3">
      <input
        ref={fileInputRef}
        type="file"
        className="hidden"
        accept=".csv,.xlsx"
        onChange={(e) => handleFiles(e.target.files)}
        disabled={disabled || parsing}
      />

      <button
        type="button"
        disabled={disabled || parsing}
        onClick={() => fileInputRef.current?.click()}
        onDragOver={(e) => {
          e.preventDefault()
          if (disabled || parsing) return
          setDragActive(true)
        }}
        onDragEnter={(e) => {
          e.preventDefault()
          if (disabled || parsing) return
          setDragActive(true)
        }}
        onDragLeave={(e) => {
          e.preventDefault()
          setDragActive(false)
        }}
        onDrop={(e) => {
          e.preventDefault()
          setDragActive(false)
          if (disabled || parsing) return
          void handleFiles(e.dataTransfer.files)
        }}
        className={`w-full text-left border rounded-md px-3 py-3 transition-colors ${
          dragActive
            ? 'border-primary bg-primary/10'
            : 'border-white/10 bg-white/5 hover:bg-white/[0.07]'
        } disabled:opacity-50`}
      >
        <p className="text-xs text-white font-medium">
          {parsing ? 'Parsing file...' : 'Upload CSV/XLSX'}
        </p>
        <p className="text-[10px] text-zinc-500 mt-1">
          Drag and drop, or click to select
        </p>
      </button>
    </div>
  )
}
