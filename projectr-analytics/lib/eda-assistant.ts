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
    patterns: [/\bcompare\b/i, /\bvs\b/i, /\bversus\b/i, /\bcounty\b/i, /\bmetro\b/i, /\bzip\b/i],
  },
  {
    taskType: 'compare_periods',
    patterns: [/\bperiod\b/i, /\bmonth\b/i, /\bquarter\b/i, /\byear\b/i, /\bbefore\b/i, /\bafter\b/i],
  },
  {
    taskType: 'explain_metric',
    patterns: [/\bwhat is\b/i, /\bexplain\b/i, /\bhow is\b/i, /\bmetric\b/i],
  },
]

function trimLines(lines: Array<string | null | undefined>, max = 4): string[] {
  return lines
    .map((line) => line?.trim())
    .filter((line): line is string => Boolean(line))
    .slice(0, max)
}

function formatNumber(value: number | null | undefined): string {
  if (value == null || !Number.isFinite(value)) return '—'
  return value.toLocaleString(undefined, {
    maximumFractionDigits: Math.abs(value) >= 100 ? 0 : 1,
  })
}

function safeContext(context: MapContext | null | undefined): WorkspaceEdaContext {
  return (
    context?.eda ?? {
      focus: 'empty',
      market: null,
      uploadedDatasets: [],
      uploadedDatasetCount: 0,
      notes: [],
    }
  )
}

function primaryDataset(workspace: WorkspaceEdaContext): UploadedDatasetEdaProfile | null {
  return workspace.uploadedDatasets[0] ?? null
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
  if (workspace.uploadedDatasetCount > 0) return 'summarize_dataset'
  return 'explain_metric'
}

function datasetEvidence(dataset: UploadedDatasetEdaProfile): string[] {
  const evidence = dataset.summaryStats.map((stat) => `${stat.label}: ${stat.value}${stat.note ? ` (${stat.note})` : ''}`)

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

function datasetFindings(taskType: EdaTaskType, dataset: UploadedDatasetEdaProfile): string[] {
  const findings: string[] = []

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

function datasetCaveats(dataset: UploadedDatasetEdaProfile, workspace: WorkspaceEdaContext): string[] {
  const lines = [
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

function marketFindings(taskType: EdaTaskType, market: MarketSnapshotEdaProfile): string[] {
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

  if (market.notableFlags.length > 0) findings.push(market.notableFlags[0])

  return trimLines(findings, 4)
}

function marketEvidence(market: MarketSnapshotEdaProfile): string[] {
  return market.metrics
    .slice(0, 6)
    .map((metric) => `${metric.label}: ${metric.formattedValue}${metric.note ? ` (${metric.note})` : ''}`)
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
  const workspace = safeContext(context)
  const taskType = inferEdaTaskType(prompt, context)
  const dataset = primaryDataset(workspace)
  const market = workspace.market
  const metricKey = inferMetricKey(prompt, market)

  if (taskType === 'explain_metric' && metricKey) {
    const trace = explainMetricTrace(metricKey)
    return {
      message: trace.keyFindings?.join(' ') ?? trace.summary,
      trace,
    }
  }

  if (dataset) {
    const findings = datasetFindings(taskType, dataset)
    const evidence = datasetEvidence(dataset)
    const caveats = datasetCaveats(dataset, workspace)
    const nextQuestions = trimLines([
      `Compare the top and bottom ${dataset.focusMetric ?? 'records'}.`,
      dataset.trend ? `Explain what changed around ${dataset.trend.endLabel}.` : null,
      dataset.dataQuality.sparseColumns.length > 0 ? 'Inspect the sparsest columns before drawing a hard conclusion.' : null,
    ], 3)

    return {
      message: findings.slice(0, 2).join(' '),
      trace: {
        summary: `${taskType.replace(/_/g, ' ')} · ${dataset.fileName ?? 'imported dataset'}`,
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
    const findings = marketFindings(taskType, market)
    const evidence = marketEvidence(market)
    const caveats = trimLines([
      taskType === 'compare_geographies'
        ? 'Only one geography is loaded in the current workspace, so this comparison is limited to the active market snapshot.'
        : null,
      'Current market context is a snapshot of loaded metrics, not a full cross-market benchmark set.',
      ...workspace.notes,
    ], 4)

    return {
      message: findings.slice(0, 2).join(' '),
      trace: {
        summary: `${taskType.replace(/_/g, ' ')} · ${market.label ?? 'market snapshot'}`,
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
  const workspace = safeContext(context)
  const taskType = inferEdaTaskType(prompt, context)
  const market = workspace.market
  const dataset = primaryDataset(workspace)
  const metricKey = inferMetricKey(prompt, market)

  return [
    `EDA TASK TYPE: ${taskType}`,
    `WORKSPACE FOCUS: ${workspace.focus}`,
    market
      ? [
          'ACTIVE MARKET SNAPSHOT:',
          `- Label: ${market.label ?? 'unknown'}`,
          ...market.metrics.map((metric) => `- ${metric.label}: ${metric.formattedValue}${metric.note ? ` (${metric.note})` : ''}`),
          ...(market.notableFlags.length > 0 ? [`- Notable flags: ${market.notableFlags.join(' | ')}`] : []),
        ].join('\n')
      : 'ACTIVE MARKET SNAPSHOT: none',
    dataset ? ['ACTIVE IMPORTED DATASET:', renderDatasetContext(dataset)].join('\n') : 'ACTIVE IMPORTED DATASET: none',
    metricKey ? `METRIC EXPLANATION TARGET: ${METRIC_DEFINITIONS[metricKey].label}` : 'METRIC EXPLANATION TARGET: none',
    workspace.notes.length > 0 ? `WORKSPACE NOTES: ${workspace.notes.join(' | ')}` : 'WORKSPACE NOTES: none',
  ].join('\n\n')
}
