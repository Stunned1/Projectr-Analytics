export interface AgentAction {
  type:
    | 'toggle_layer'
    | 'toggle_layers'
    | 'set_metric'
    | 'search'
    | 'generate_memo'
    | 'set_tilt'
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
}
