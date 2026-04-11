export type CyclePosition = 'Recovery' | 'Expansion' | 'Hypersupply' | 'Recession'

export type CycleStage = 'Early' | 'Mid' | 'Late'

export type CycleDataQuality = 'High' | 'Medium' | 'Low'

export type CycleSignalScore = -1 | 0 | 1

export interface CycleSignalDetail {
  score: CycleSignalScore
  direction: string
  value: string
  source: string
}

export interface CycleAnalysis {
  zip: string
  cyclePosition: CyclePosition
  cycleStage: CycleStage
  /** 0–100 after data-quality cap */
  confidence: number
  /** How many of the four signals align with the classified quadrant (0–4) */
  signalsAgreement: number
  signals: {
    rent: CycleSignalDetail
    vacancy: CycleSignalDetail
    permits: CycleSignalDetail
    employment: CycleSignalDetail
  }
  dataQuality: CycleDataQuality
  /** Gemini-generated, anchored to classifier output */
  narrative: string
  /** Human-readable confidence line for UI/PDF */
  confidenceLine: string
  /** True when agreement is 2/4 - transitional market */
  transitional: boolean
}

export interface MasterRow {
  metric_name: string
  metric_value: number
  data_source: string
  time_period: string | null
  created_at: string
}
