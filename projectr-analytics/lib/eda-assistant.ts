import type {
  AgentTrace,
  EdaTaskType,
  MapContext,
  MarketSnapshotEdaProfile,
  UploadedDatasetEdaProfile,
  WorkspaceEdaContext,
} from '@/lib/agent-types'
import type { MetricKey } from '@/lib/metric-definitions'
import { METRIC_DEFINITIONS } from '@/lib/metric-definitions'

const TASK_KEYWORDS: Array<{ taskType: EdaTaskType; patterns: RegExp[] }> = [
  {
    taskType: 'detect_outliers',
    patterns: [/\boutlier/i, /\banomal/i, /\bunusual/i, /\bweird/i],
  },
  {
    taskType: 'check_data_quality',
    patterns: [/\bdata quality/i, /\bmissing/i, /\bnull/i, /\bduplicate/i, /\bambiguous/i],
  },
  {
    taskType: 'describe_distribution',
    patterns: [/\bdistribution/i, /\bspread/i, /\bpercentile/i, /\bmedian\b/i, /\bmean\b/i],
  },
  {
    taskType: 'spot_trends',
    patterns: [/\btrend/i, /\bover time/i, /\bchanged/i, /\bchange\b/i, /\btime series/i],
  },
  {
    taskType: 'compare_segments',
    patterns: [/\btop\b/i, /\bbottom\b/i, /\brank/i, /\bsegment/i, /\bcategory/i],
  },
  {
    taskType: 'compare_geographies',
    patterns: [/\bcompare\b/i, /\bvs\b/i, /\bversus\b/i],
  },
  {
    taskType: 'compare_periods',
    patterns: [/\bperiod\b/i, /\bmonth\b/i, /\bquarter\b/i, /\byear\b/i, /\bbefore\b/i, /\bafter\b/i],
  },
  {
    taskType: 'explain_metric',
    patterns: [/\bwhat is\b/i, /\bhow is\b/i, /\bmetric\b/i, /\bdefine\b/i],
  },
]

const DATASET_FOCUS_PATTERN =
  /\b(upload|uploaded|import|imported|dataset|csv|file|rows?|raw table|table|chart|sidebar|mapp?able|pins?|client data)\b/i

const MARKET_FOCUS_PATTERN =
  /\b(market|county|metro|zip|geography|area|rent|rents|zori|zhvi|vacancy|inventory|price cuts?|transit|population|snapshot|loaded market)\b/i

const MAP_UPLOAD_PATTERN = /\b(map|mapped|pins?|client layer|on the map)\b/i
const CHART_PATTERN = /\b(chart|trend|trends|time series|over time|month|quarter|year)\b/i
const TABLE_PATTERN = /\b(table|rows?|raw|sidebar)\b/i

function trimLines(lines: Array<string | null | undefined>, max = 4): string[] {
  return lines
    .map((line) => line?.trim())
    .filter((line): line is string => Boolean(line))
    .slice(0, max)
}

function formatNumber(value: number | null | undefined): string {
  if (value == null || !Number.isFinite(value)) return 'N/A'
  return value.toLocaleString(undefined, {
    maximumFractionDigits: Math.abs(value) >= 100 ? 0 : 1,
  })
}

function asStringArray(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((item): item is string => typeof item === 'string') : []
}

function normalizeMarketProfile(market: MarketSnapshotEdaProfile | null | undefined): MarketSnapshotEdaProfile | null {
  if (!market) return null

  return {
    label: market.label ?? null,
    metrics: Array.isArray(market.metrics) ? market.metrics : [],
    notableFlags: asStringArray(market.notableFlags),
  }
}

function normalizeDatasetProfile(dataset: UploadedDatasetEdaProfile): UploadedDatasetEdaProfile {
  return {
    fileName: dataset.fileName ?? null,
    datasetType: dataset.datasetType ?? 'tabular',
    mapabilityClassification: dataset.mapabilityClassification ?? 'non_map_visualizable',
    visualizationMode: dataset.visualizationMode ?? 'table',
    rowCount: dataset.rowCount ?? 0,
    sampleRowCount: dataset.sampleRowCount ?? 0,
    columnCount: dataset.columnCount ?? 0,
    headers: asStringArray(dataset.headers),
    focusMetric: dataset.focusMetric ?? null,
    geoField: dataset.geoField ?? null,
    dateField: dataset.dateField ?? null,
    categoryField: dataset.categoryField ?? null,
    summaryStats: Array.isArray(dataset.summaryStats) ? dataset.summaryStats : [],
    primaryDistribution: dataset.primaryDistribution ?? null,
    outliers: Array.isArray(dataset.outliers) ? dataset.outliers : [],
    topCategories: Array.isArray(dataset.topCategories) ? dataset.topCategories : [],
    trend: dataset.trend ?? null,
    dataQuality: {
      duplicateRows: dataset.dataQuality?.duplicateRows ?? 0,
      sparseColumns: asStringArray(dataset.dataQuality?.sparseColumns),
      inconsistentDateColumns: asStringArray(dataset.dataQuality?.inconsistentDateColumns),
      invalidGeographyRows: dataset.dataQuality?.invalidGeographyRows ?? 0,
      warnings: asStringArray(dataset.dataQuality?.warnings),
    },
    explanation: dataset.explanation ?? 'The current workspace context does not include enough reliable geography to place these rows on the map.',
    warnings: asStringArray(dataset.warnings),
  }
}

function safeContext(context: MapContext | null | undefined): WorkspaceEdaContext {
  const fallbackActiveLayerKeys = Object.entries(context?.layers ?? {})
    .filter(([, enabled]) => enabled)
    .map(([key]) => key)

  const eda = context?.eda
  const uploadedDatasets = Array.isArray(eda?.uploadedDatasets)
    ? eda.uploadedDatasets.map((dataset) => normalizeDatasetProfile(dataset))
    : []

  const activeLayerKeys = Array.isArray(eda?.activeLayerKeys) ? asStringArray(eda?.activeLayerKeys) : fallbackActiveLayerKeys
  const hasMarket = Boolean(eda?.market)
  const inferredFocus =
    uploadedDatasets.length > 0 && hasMarket
      ? 'mixed'
      : uploadedDatasets.length > 0
        ? 'uploaded_dataset'
        : hasMarket
          ? 'market'
          : 'empty'

  return {
    focus: eda?.focus ?? inferredFocus,
    market: normalizeMarketProfile(eda?.market ?? null),
    uploadedDatasets,
    uploadedDatasetCount: eda?.uploadedDatasetCount ?? uploadedDatasets.length,
    geographyLabel: eda?.geographyLabel ?? context?.label ?? null,
    activeMetric: eda?.activeMetric ?? context?.activeMetric ?? null,
    activeLayerKeys,
    notes: asStringArray(eda?.notes),
  }
}

function datasetNameTokens(fileName: string | null): string[] {
  return (fileName ?? '')
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter((token) => token.length >= 3 && !['csv', 'txt', 'data', 'upload', 'imported'].includes(token))
}

function datasetFieldTokens(dataset: UploadedDatasetEdaProfile): string[] {
  return [
    dataset.focusMetric,
    dataset.geoField,
    dataset.dateField,
    dataset.categoryField,
    ...dataset.headers.slice(0, 24),
  ]
    .filter((value): value is string => Boolean(value?.trim()))
    .map((value) => value.toLowerCase())
}

function marketMetricTokens(market: MarketSnapshotEdaProfile): string[] {
  const aliasMap: Partial<Record<string, string[]>> = {
    zori: ['rent', 'rents'],
    zhvi: ['home value', 'home values', 'value layer'],
    vacancy: ['vacancy'],
    inventory: ['inventory'],
    transit: ['transit'],
    population: ['population'],
    priceCuts: ['price cut', 'price cuts'],
    dozPending: ['days on zillow', 'doz'],
  }

  return [...new Set(
    market.metrics.flatMap((metric) => [
      metric.key.toLowerCase(),
      metric.label.toLowerCase(),
      ...(aliasMap[metric.key] ?? []),
    ])
  )]
}

function promptMentionsDatasetField(prompt: string, dataset: UploadedDatasetEdaProfile): boolean {
  const normalized = prompt.toLowerCase()
  return datasetFieldTokens(dataset).some((token) => token.length >= 3 && normalized.includes(token))
}

function promptMentionsMarketOnlyMetric(
  prompt: string,
  market: MarketSnapshotEdaProfile,
  dataset: UploadedDatasetEdaProfile
): boolean {
  const normalized = prompt.toLowerCase()
  const datasetTokens = new Set(datasetFieldTokens(dataset))

  return marketMetricTokens(market).some((token) => token.length >= 3 && normalized.includes(token) && !datasetTokens.has(token))
}

function scoreDatasetForPrompt(prompt: string, dataset: UploadedDatasetEdaProfile): number {
  let score = 0
  const normalized = prompt.toLowerCase()
  const nameTokens = datasetNameTokens(dataset.fileName)

  if (nameTokens.some((token) => normalized.includes(token))) score += 6
  if (DATASET_FOCUS_PATTERN.test(normalized)) score += 1
  if (MAP_UPLOAD_PATTERN.test(normalized) && dataset.visualizationMode === 'map') score += 4
  if (CHART_PATTERN.test(normalized) && (dataset.visualizationMode === 'chart' || dataset.trend)) score += 4
  if (TABLE_PATTERN.test(normalized) && dataset.visualizationMode !== 'map') score += 3
  if (normalized.includes('not map') || normalized.includes("isn't on the map") || normalized.includes('why not map')) {
    if (dataset.visualizationMode !== 'map') score += 4
  }

  if (promptMentionsDatasetField(prompt, dataset)) score += 2

  return score
}

function selectRelevantDataset(
  prompt: string,
  workspace: WorkspaceEdaContext
): UploadedDatasetEdaProfile | null {
  if (workspace.uploadedDatasets.length === 0) return null
  if (workspace.uploadedDatasets.length === 1) return workspace.uploadedDatasets[0]

  let best: UploadedDatasetEdaProfile | null = workspace.uploadedDatasets[0] ?? null
  let bestScore = Number.NEGATIVE_INFINITY

  for (const dataset of workspace.uploadedDatasets) {
    const score = scoreDatasetForPrompt(prompt, dataset)
    if (score > bestScore) {
      bestScore = score
      best = dataset
    }
  }

  return best
}

function chooseAnalysisSubject(prompt: string, context: MapContext | null | undefined): {
  workspace: WorkspaceEdaContext
  dataset: UploadedDatasetEdaProfile | null
  market: MarketSnapshotEdaProfile | null
} {
  const workspace = safeContext(context)
  const dataset = selectRelevantDataset(prompt, workspace)
  const market = workspace.market

  if (!dataset || !market) {
    return { workspace, dataset, market }
  }

  const normalized = prompt.toLowerCase()
  const datasetFocus = DATASET_FOCUS_PATTERN.test(normalized) || scoreDatasetForPrompt(prompt, dataset) >= 4
  const marketFocus = MARKET_FOCUS_PATTERN.test(normalized)
  const metricKey = inferMetricKey(prompt, market)
  const datasetFieldMatch = promptMentionsDatasetField(prompt, dataset)
  const marketOnlyMetricMatch = promptMentionsMarketOnlyMetric(prompt, market, dataset)

  if (marketOnlyMetricMatch) {
    return { workspace, dataset: null, market }
  }

  if (datasetFocus && !marketFocus) {
    return { workspace, dataset, market: null }
  }

  if ((marketFocus || metricKey) && (!datasetFocus || !datasetFieldMatch)) {
    return { workspace, dataset: null, market }
  }

  return { workspace, dataset, market: null }
}

function inferMetricKey(prompt: string, market: MarketSnapshotEdaProfile | null): MetricKey | null {
  const normalized = prompt.toLowerCase()

  for (const [key, definition] of Object.entries(METRIC_DEFINITIONS) as Array<[MetricKey, (typeof METRIC_DEFINITIONS)[MetricKey]]>) {
    const label = definition.label.toLowerCase()
    const short = definition.short.toLowerCase()
    if (normalized.includes(key.toLowerCase()) || normalized.includes(label) || normalized.includes(short.split(' - ')[0] ?? '')) {
      if (!market || market.metrics.some((metric) => metric.key === key)) return key
    }
  }

  return null
}

export function inferEdaTaskType(prompt: string, context: MapContext | null | undefined): EdaTaskType {
  const normalized = prompt.trim()
  if (!normalized) return 'summarize_dataset'

  for (const task of TASK_KEYWORDS) {
      if (task.patterns.some((pattern) => pattern.test(normalized))) return task.taskType
  }

  const workspace = safeContext(context)
  const metricKey = inferMetricKey(prompt, workspace.market)
  if (
    /\bexplain\b/i.test(normalized) &&
    metricKey &&
    !/\b(snapshot|market|dataset|upload|uploaded|csv|trend|trends|change|changed|compare|summary|summari[sz]e)\b/i.test(normalized)
  ) {
    return 'explain_metric'
  }
  if (workspace.uploadedDatasetCount > 0 || workspace.market) return 'summarize_dataset'
  return 'explain_metric'
}

function datasetEvidence(dataset: UploadedDatasetEdaProfile, workspace: WorkspaceEdaContext): string[] {
  const evidence = dataset.summaryStats.map((stat) => `${stat.label}: ${stat.value}${stat.note ? ` (${stat.note})` : ''}`)

  if (workspace.geographyLabel) {
    evidence.push(`Active geography: ${workspace.geographyLabel}.`)
  }

  if (workspace.activeLayerKeys.length > 0) {
    evidence.push(`Visible layers: ${workspace.activeLayerKeys.join(', ')}.`)
  }

  if (dataset.primaryDistribution) {
    evidence.push(
      `Primary distribution (${dataset.primaryDistribution.column}): median ${formatNumber(dataset.primaryDistribution.median)}, min ${formatNumber(dataset.primaryDistribution.min)}, max ${formatNumber(dataset.primaryDistribution.max)}.`
    )
  }

  if (dataset.trend) {
    evidence.push(
      `Trend (${dataset.trend.valueColumn}): ${dataset.trend.startLabel} ${formatNumber(dataset.trend.startValue)} to ${dataset.trend.endLabel} ${formatNumber(dataset.trend.endValue)} (${dataset.trend.delta >= 0 ? '+' : ''}${formatNumber(dataset.trend.delta)}).`
    )
  }

  if (dataset.topCategories && dataset.topCategories.length > 0) {
    evidence.push(
      `Top categories: ${dataset.topCategories
        .slice(0, 3)
        .map((row) => `${row.label} ${row.value}`)
        .join(', ')}.`
    )
  }

  return evidence.slice(0, 6)
}

function datasetFindings(
  prompt: string,
  taskType: EdaTaskType,
  dataset: UploadedDatasetEdaProfile
): string[] {
  const findings: string[] = []
  const normalized = prompt.toLowerCase()
  const asksAboutMapability = /\bwhy\b/i.test(normalized) && MAP_UPLOAD_PATTERN.test(normalized)
  const normalizedMapExplanation = dataset.explanation.trim().replace(/[.?!]+$/, '')

  if (asksAboutMapability) {
    if (dataset.visualizationMode === 'map') {
      findings.push(
        `${dataset.fileName ?? 'This dataset'} can render on the map because Scout has usable geography for its active rows.`
      )
    } else {
      findings.push(
        `${dataset.fileName ?? 'This dataset'} stays in ${dataset.visualizationMode} view because ${normalizedMapExplanation || 'the current import session does not have reliable row-level geography for direct map placement'}.`
      )
    }
  }

  findings.push(
    `${dataset.fileName ?? 'Imported dataset'} has ${dataset.rowCount.toLocaleString()} rows across ${dataset.columnCount.toLocaleString()} columns and currently routes to ${dataset.visualizationMode} view.`
  )

  if (taskType === 'detect_outliers' && dataset.outliers && dataset.outliers.length > 0) {
    const first = dataset.outliers[0]
    findings.push(`${first.label} is the clearest outlier in ${dataset.primaryDistribution?.column ?? dataset.focusMetric ?? 'the primary metric'} at ${formatNumber(first.value)}.`)
  } else if (dataset.primaryDistribution) {
    findings.push(
      `${dataset.primaryDistribution.column} centers around ${formatNumber(dataset.primaryDistribution.median)} with a range from ${formatNumber(dataset.primaryDistribution.min)} to ${formatNumber(dataset.primaryDistribution.max)}.`
    )
  }

  if (dataset.trend && (taskType === 'spot_trends' || taskType === 'compare_periods' || taskType === 'summarize_dataset')) {
    findings.push(
      `${dataset.trend.valueColumn} trends ${dataset.trend.direction} from ${dataset.trend.startLabel} to ${dataset.trend.endLabel} (${dataset.trend.delta >= 0 ? '+' : ''}${formatNumber(dataset.trend.delta)}).`
    )
  }

  if (taskType === 'check_data_quality' || dataset.dataQuality.warnings.length > 0) {
    if (dataset.dataQuality.duplicateRows > 0) {
      findings.push(`${dataset.dataQuality.duplicateRows} sampled rows look duplicated.`)
    }
    if (dataset.dataQuality.invalidGeographyRows > 0) {
      findings.push(`${dataset.dataQuality.invalidGeographyRows} sampled rows contain invalid geography values.`)
    }
    if (dataset.dataQuality.sparseColumns.length > 0) {
      findings.push(`The sparsest sampled columns are ${dataset.dataQuality.sparseColumns.slice(0, 3).join(', ')}.`)
    }
  }

  return trimLines(findings, 4)
}

function datasetCaveats(
  dataset: UploadedDatasetEdaProfile,
  workspace: WorkspaceEdaContext,
  context: MapContext | null | undefined
): string[] {
  const clientLayerActive = context?.layers?.clientData === true
  const lines = [
    dataset.visualizationMode === 'map'
      ? clientLayerActive
        ? `${dataset.fileName ?? 'This dataset'} currently has mapped rows available through the Client layer.`
        : `${dataset.fileName ?? 'This dataset'} can render on the map, but the Client layer is currently off.`
      : dataset.visualizationMode === 'chart'
        ? `${dataset.fileName ?? 'This dataset'} is being analyzed in chart/sidebar mode rather than direct map mode.`
        : `${dataset.fileName ?? 'This dataset'} is being analyzed in table/sidebar mode because direct row placement is not the active rendering path.`,
    dataset.mapabilityClassification === 'map_normalizable' && dataset.visualizationMode !== 'map'
      ? 'This dataset may become mappable after geography normalization or resolution.'
      : null,
    dataset.sampleRowCount < dataset.rowCount
      ? `${dataset.fileName ?? 'This dataset'} is being analyzed from ${dataset.sampleRowCount.toLocaleString()} sampled rows in the current workspace, not the full imported row set.`
      : null,
    dataset.explanation,
    ...dataset.warnings,
    ...dataset.dataQuality.warnings,
    ...workspace.notes,
  ]

  return trimLines([...new Set(lines.filter(Boolean) as string[])], 5)
}

function marketFindings(
  taskType: EdaTaskType,
  market: MarketSnapshotEdaProfile,
  workspace: WorkspaceEdaContext
): string[] {
  const findings: string[] = []
  const rent = market.metrics.find((metric) => metric.key === 'zori')
  const value = market.metrics.find((metric) => metric.key === 'zhvi')
  const vacancy = market.metrics.find((metric) => metric.key === 'vacancy')

  findings.push(
    `${market.label ?? 'The loaded market'} currently has ${market.metrics.length} active EDA-ready market metrics in workspace context.`
  )

  if (rent) findings.push(`${rent.label} is ${rent.formattedValue}${rent.note ? ` (${rent.note})` : ''}.`)
  if (value && taskType !== 'explain_metric') findings.push(`${value.label} is ${value.formattedValue}${value.note ? ` (${value.note})` : ''}.`)
  if (vacancy && (taskType === 'summarize_dataset' || taskType === 'check_data_quality' || taskType === 'compare_geographies')) {
    findings.push(`${vacancy.label} is ${vacancy.formattedValue}.`)
  }

  if (workspace.activeMetric) findings.push(`The active map metric is ${workspace.activeMetric.toUpperCase()}.`)
  if (market.notableFlags.length > 0) findings.push(market.notableFlags[0])

  return trimLines(findings, 4)
}

function marketEvidence(market: MarketSnapshotEdaProfile, workspace: WorkspaceEdaContext): string[] {
  const evidence = market.metrics
    .slice(0, 6)
    .map((metric) => `${metric.label}: ${metric.formattedValue}${metric.note ? ` (${metric.note})` : ''}`)

  if (workspace.geographyLabel) evidence.push(`Active geography: ${workspace.geographyLabel}.`)
  if (workspace.activeLayerKeys.length > 0) evidence.push(`Visible layers: ${workspace.activeLayerKeys.join(', ')}.`)

  return evidence
}

function explainMetricTrace(metricKey: MetricKey): AgentTrace {
  const definition = METRIC_DEFINITIONS[metricKey]
  return {
    summary: `${definition.label} explanation`,
    taskType: 'explain_metric',
    methodology: 'Used the deterministic metric glossary already wired into Scout, then constrained the explanation to the currently loaded workspace metrics.',
    keyFindings: trimLines([definition.short, definition.long], 2),
    evidence: trimLines([
      `Source: ${definition.source}.`,
      definition.calculation ? `Calculation: ${definition.calculation}` : null,
    ], 3),
    caveats: ['This explanation describes the metric itself, not a causal conclusion about the active market.'],
    nextQuestions: [
      `How does ${definition.label} compare with the rest of the loaded market context?`,
      `What other metric should I pair with ${definition.label} for a better read?`,
    ],
  }
}

export function buildFallbackEdaResponse(prompt: string, context: MapContext | null | undefined): {
  message: string
  trace: AgentTrace
} {
  const { workspace, dataset, market } = chooseAnalysisSubject(prompt, context)
  const taskType = inferEdaTaskType(prompt, context)
  const metricKey = inferMetricKey(prompt, market)

  if (taskType === 'explain_metric' && metricKey) {
    const trace = explainMetricTrace(metricKey)
    return {
      message: trace.keyFindings?.join(' ') ?? trace.summary,
      trace,
    }
  }

  if (dataset) {
    const summaryLabel = taskType === 'summarize_dataset' ? 'summarize uploaded dataset' : taskType.replace(/_/g, ' ')
    const findings = datasetFindings(prompt, taskType, dataset)
    const evidence = datasetEvidence(dataset, workspace)
    const caveats = datasetCaveats(dataset, workspace, context)
    const nextQuestions = trimLines([
      `Compare the top and bottom ${dataset.focusMetric ?? 'records'}.`,
      dataset.trend ? `Explain what changed around ${dataset.trend.endLabel}.` : null,
      dataset.visualizationMode === 'map' ? 'Explain what the mapped rows suggest relative to the loaded market.' : null,
      dataset.visualizationMode !== 'map' ? 'Explain why this dataset is using a sidebar fallback instead of the map.' : null,
      dataset.dataQuality.sparseColumns.length > 0 ? 'Inspect the sparsest columns before drawing a hard conclusion.' : null,
    ], 3)

    return {
      message: findings.slice(0, 2).join(' '),
      trace: {
        summary: `${summaryLabel} · ${dataset.fileName ?? 'imported dataset'}`,
        taskType,
        methodology: 'Used deterministic upload summaries, distribution stats, outlier checks, and data-quality checks already computed from the active imported dataset.',
        keyFindings: findings,
        evidence,
        caveats,
        nextQuestions,
      },
    }
  }

  if (market) {
    const summaryLabel = taskType === 'summarize_dataset' ? 'summarize market snapshot' : taskType.replace(/_/g, ' ')
    const findings = marketFindings(taskType, market, workspace)
    const evidence = marketEvidence(market, workspace)
    const caveats = trimLines([
      taskType === 'compare_geographies'
        ? 'Only one geography is loaded in the current workspace, so this comparison is limited to the active market snapshot.'
        : null,
      workspace.uploadedDatasetCount > 0
        ? 'An imported dataset is also active, but this answer stayed on the loaded market because the request referenced market metrics or geography.'
        : null,
      'Current market context is a snapshot of loaded metrics, not a full cross-market benchmark set.',
      ...workspace.notes,
    ], 4)

    return {
      message: findings.slice(0, 2).join(' '),
      trace: {
        summary: `${summaryLabel} · ${market.label ?? 'market snapshot'}`,
        taskType,
        methodology: 'Used the deterministic market snapshot already loaded into the workspace and limited the response to visible metrics.',
        keyFindings: findings,
        evidence,
        caveats,
        nextQuestions: [
          'Load a second geography if you want a true side-by-side comparison.',
          'Ask for a metric explanation if you want the methodology behind one of these numbers.',
        ],
      },
    }
  }

  return {
    message: 'No uploaded dataset or market snapshot is active yet. Load a market or import a CSV, then ask for a summary, outliers, trends, or data-quality check.',
    trace: {
      summary: 'No active EDA context',
      taskType,
      methodology: 'Checked the current workspace and found no active imported dataset or market metrics to ground a deterministic analysis.',
      keyFindings: ['The assistant has no active dataset or market snapshot to analyze yet.'],
      evidence: ['No uploaded dataset is active in the current workspace.', 'No market snapshot is loaded in the current workspace.'],
      caveats: ['The EDA assistant does not generate open-ended market advice without a visible dataset or loaded market context.'],
      nextQuestions: ['Load a ZIP, county, or metro and ask for a summary.', 'Import a CSV and ask for outliers or data quality.'],
    },
  }
}

function renderDatasetContext(dataset: UploadedDatasetEdaProfile): string {
  const lines = [
    `- Dataset: ${dataset.fileName ?? 'imported dataset'}`,
    `- Type: ${dataset.datasetType}`,
    `- Rendering path: ${dataset.visualizationMode} (${dataset.mapabilityClassification})`,
    `- Rows: ${dataset.rowCount} total, ${dataset.sampleRowCount} sampled for EDA`,
    `- Columns: ${dataset.headers.join(', ')}`,
    `- Focus metric: ${dataset.focusMetric ?? 'none detected'}`,
    `- Summary stats: ${dataset.summaryStats.map((row) => `${row.label}=${row.value}`).join('; ')}`,
  ]

  if (dataset.primaryDistribution) {
    lines.push(
      `- Distribution: ${dataset.primaryDistribution.column} median=${formatNumber(dataset.primaryDistribution.median)}, min=${formatNumber(dataset.primaryDistribution.min)}, max=${formatNumber(dataset.primaryDistribution.max)}, stddev=${formatNumber(dataset.primaryDistribution.stddev)}`
    )
  }

  if (dataset.outliers && dataset.outliers.length > 0) {
    lines.push(`- Outliers: ${dataset.outliers.map((row) => `${row.label} (${formatNumber(row.value)})`).join('; ')}`)
  }

  if (dataset.trend) {
    lines.push(
      `- Trend: ${dataset.trend.valueColumn} ${dataset.trend.direction} from ${dataset.trend.startLabel} ${formatNumber(dataset.trend.startValue)} to ${dataset.trend.endLabel} ${formatNumber(dataset.trend.endValue)}`
    )
  }

  if (dataset.topCategories && dataset.topCategories.length > 0) {
    lines.push(`- Top categories: ${dataset.topCategories.map((row) => `${row.label} ${row.value}`).join('; ')}`)
  }

  if (dataset.dataQuality.warnings.length > 0) {
    lines.push(`- Data quality warnings: ${dataset.dataQuality.warnings.join(' | ')}`)
  }

  return lines.join('\n')
}

export function buildEdaContextString(prompt: string, context: MapContext | null | undefined): string {
  const { workspace, dataset, market } = chooseAnalysisSubject(prompt, context)
  const taskType = inferEdaTaskType(prompt, context)
  const metricKey = inferMetricKey(prompt, market)
  const datasetCatalog =
    workspace.uploadedDatasets.length > 1
      ? workspace.uploadedDatasets
          .map((row) => `${row.fileName ?? 'dataset'} [${row.visualizationMode}/${row.mapabilityClassification}]`)
          .join(' | ')
      : null

  return [
    `EDA TASK TYPE: ${taskType}`,
    `WORKSPACE FOCUS: ${workspace.focus}`,
    `ACTIVE GEOGRAPHY: ${workspace.geographyLabel ?? 'none'}`,
    `ACTIVE METRIC: ${workspace.activeMetric ?? 'none'}`,
    `ACTIVE LAYERS: ${workspace.activeLayerKeys.length > 0 ? workspace.activeLayerKeys.join(', ') : 'none'}`,
    market
      ? [
          'ACTIVE MARKET SNAPSHOT:',
          `- Label: ${market.label ?? 'unknown'}`,
          ...market.metrics.map((metric) => `- ${metric.label}: ${metric.formattedValue}${metric.note ? ` (${metric.note})` : ''}`),
          ...(market.notableFlags.length > 0 ? [`- Notable flags: ${market.notableFlags.join(' | ')}`] : []),
        ].join('\n')
      : 'ACTIVE MARKET SNAPSHOT: none',
    dataset ? ['SELECTED IMPORTED DATASET:', renderDatasetContext(dataset)].join('\n') : 'SELECTED IMPORTED DATASET: none',
    datasetCatalog ? `IMPORTED DATASET CATALOG: ${datasetCatalog}` : 'IMPORTED DATASET CATALOG: none',
    metricKey ? `METRIC EXPLANATION TARGET: ${METRIC_DEFINITIONS[metricKey].label}` : 'METRIC EXPLANATION TARGET: none',
    workspace.notes.length > 0 ? `WORKSPACE NOTES: ${workspace.notes.join(' | ')}` : 'WORKSPACE NOTES: none',
  ].join('\n\n')
}
