'use client'

import { useEffect } from 'react'
import { useSitesStore } from '@/lib/sites-store'

/** Loads saved_sites once the app mounts (uses anonymous or existing Supabase session). */
export default function SitesBootstrap() {
  const loadSites = useSitesStore((s) => s.loadSites)

  useEffect(() => {
    void loadSites()
  }, [loadSites])

  return null
}
