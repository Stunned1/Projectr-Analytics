export interface AgentAction {
  type:
    | 'toggle_layer'
    | 'toggle_layers'
    | 'set_metric'
    | 'search'
    | 'generate_memo'
    | 'focus_data_panel'
    | 'set_tilt'
    | 'set_heading'
    | 'run_analysis'
    | 'show_sites'
    | 'set_permit_filter'
    | 'fly_to'
    | 'none'
  layer?: string
  value?: boolean
  layers?: Record<string, boolean>
  metric?: 'zori' | 'zhvi'
  query?: string
  tilt?: number
  /** Map bearing, degrees clockwise from north (Google Maps). */
  heading?: number
  borough?: string
  top_n?: number
  sites?: AnalysisSite[]
  types?: string[]
  lat?: number
  lng?: number
  site?: AnalysisSite
}

export interface AnalysisSite {
  address: string
  lat: number
  lng: number
  zone: string
  built_far: number
  max_far: number
  air_rights_sqft: number
  far_utilization: number
  lot_area: number
  assessed_value: number
  score: number
  zori_growth: number | null
  momentum: number | null
}

export interface AgentStep {
  delay: number
  message: string
  action: AgentAction
}

export interface AgentMessage {
  role: 'user' | 'agent'
  text: string
  /** Set when the user sent the message (for terminal timestamps). */
  ts?: number
  action?: AgentAction
  insight?: string | null
  isAnalyzing?: boolean
  analysisSites?: AnalysisSite[]
}

/** Last client CSV ingest — agent uses for “show my upload / pins / sidebar” intents. */
export interface MapContextClientCsv {
  fileName: string | null
  /** Number of CSVs in the last combined ingest (multi-file drop). */
  fileCount?: number
  fileNames?: string[]
  bucket: string
  visual_bucket: string
  metric_name: string
  reasoning: string
  rowsIngested: number
  mapPinCount: number
  mapEligible: boolean
  ingestedAt: string
}

export interface MapContext {
  label?: string | null
  zip?: string | null
  layers?: Record<string, boolean>
  activeMetric?: string
  zori?: number | null
  zhvi?: number | null
  zoriGrowth?: number | null
  zhviGrowth?: number | null
  vacancyRate?: number | null
  dozPending?: number | null
  priceCuts?: number | null
  inventory?: number | null
  transitStops?: number | null
  population?: number | null
  /** Present after a Client CSV normalize on this session */
  clientCsv?: MapContextClientCsv | null
}
