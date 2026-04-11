import type { Metadata } from 'next'
import type { ReactNode } from 'react'

export const metadata: Metadata = {
  title: 'Analyst guide · Projectr',
  description: 'Workflows and metric reference for the Projectr command center.',
}

export default function GuideLayout({ children }: { children: ReactNode }) {
  return children
}
