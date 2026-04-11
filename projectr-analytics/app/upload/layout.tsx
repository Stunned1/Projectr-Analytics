import type { Metadata } from 'next'

export const metadata: Metadata = {
  title: 'CSV Upload · Scout',
  description: 'Upload CSV files for Gemini triage and map pins on the command center.',
}

export default function UploadLayout({ children }: { children: React.ReactNode }) {
  return children
}
