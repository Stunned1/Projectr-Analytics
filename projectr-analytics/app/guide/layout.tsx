import type { Metadata } from 'next'
import type { ReactNode } from 'react'

export const metadata: Metadata = {
  title: 'Analyst Documentation · Scout',
  description: 'Workflows and metric reference for the Scout command center.',
}

export default function DocumentationLayout({ children }: { children: ReactNode }) {
  return children
}
