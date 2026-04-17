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

export type EdaTaskType =
  | 'summarize_dataset'
  | 'describe_distribution'
  | 'detect_outliers'
  | 'compare_segments'
  | 'compare_geographies'
  | 'compare_periods'
  | 'spot_trends'
  | 'check_data_quality'
  | 'explain_metric'

export interface EdaEvidenceStat {
  label: string
  value: string
  note?: string | null
}

export interface EdaDistributionSummary {
  column: string
  count: number
  nullCount: number
  mean: number | null
  median: number | null
  min: number | null
  max: number | null
  stddev: number | null
  p25: number | null
  p75: number | null
}

export interface EdaOutlierSummary {
  label: string
  value: number
  reason: string
}

export interface EdaTrendSummary {
  dateColumn: string
  valueColumn: string
  pointCount: number
  startLabel: string
  endLabel: string
  startValue: number
  endValue: number
  delta: number
  pctChange: number | null
  direction: 'up' | 'down' | 'flat'
  volatility: number | null
}

export interface EdaDataQualitySummary {
  duplicateRows: number
  sparseColumns: string[]
  inconsistentDateColumns: string[]
  invalidGeographyRows: number
  warnings: string[]
}

export interface UploadedDatasetEdaProfile {
  fileName: string | null
  datasetType: string
  mapabilityClassification: string
  visualizationMode: 'map' | 'chart' | 'table'
  rowCount: number
  sampleRowCount: number
  columnCount: number
  headers: string[]
  focusMetric: string | null
  geoField: string | null
  dateField: string | null
  categoryField: string | null
  summaryStats: EdaEvidenceStat[]
  primaryDistribution?: EdaDistributionSummary | null
  outliers?: EdaOutlierSummary[]
  topCategories?: EdaEvidenceStat[]
  trend?: EdaTrendSummary | null
  dataQuality: EdaDataQualitySummary
  explanation: string
  warnings: string[]
}

export interface MarketMetricEdaProfile {
  key: string
  label: string
  value: number | null
  formattedValue: string
  note?: string | null
  source?: string | null
}

export interface MarketSnapshotEdaProfile {
  label: string | null
  metrics: MarketMetricEdaProfile[]
  notableFlags: string[]
}

export interface WorkspaceEdaContext {
  focus: 'uploaded_dataset' | 'market' | 'mixed' | 'empty'
  market: MarketSnapshotEdaProfile | null
  uploadedDatasets: UploadedDatasetEdaProfile[]
  uploadedDatasetCount: number
  notes: string[]
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

/** Optional row for future server-side tool loops (args/results are previews only). */
export type AgentTraceToolRow = {
  name: string
  argsPreview?: string
  resultPreview?: string
  ok?: boolean
}

/**
 * Analyst-facing notes from `/api/agent`, shown in the right sidebar via **Show analysis notes**.
 */
export interface AgentTrace {
  summary: string
  taskType?: EdaTaskType | null
  methodology?: string | null
  keyFindings?: string[]
  evidence?: string[]
  caveats?: string[]
  nextQuestions?: string[]
  /**
   * Legacy long-form prose field retained for compatibility; new EDA responses prefer `methodology`.
   */
  thinking?: string | null
  detail?: string | null
  plan?: string[]
  eval?: string | null
  executionSteps?: { message: string; actionType: string }[]
  toolCalls?: AgentTraceToolRow[]
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
  trace?: AgentTrace
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
  datasets?: UploadedDatasetEdaProfile[]
  notes?: string[]
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
  eda?: WorkspaceEdaContext | null
}
