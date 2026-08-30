import { median, percentile } from './format'

export const INTELLIGENCE_VERSION = '1.0.0'

export const INTELLIGENCE_METRICS = {
  steps: {
    label: 'Activité',
    shortLabel: 'Pas',
    unit: 'pas',
    field: 'steps',
    valid: (value) => Number.isFinite(value) && value >= 0,
    minimumChange: 0.25,
  },
  sleep: {
    label: 'Sommeil',
    shortLabel: 'Sommeil',
    unit: 'min',
    field: 'sleepMinutes',
    valid: (value) => Number.isFinite(value) && value > 0,
    minimumChange: 0.15,
  },
  heart: {
    label: 'Fréquence cardiaque moyenne',
    shortLabel: 'Cœur moyen',
    unit: 'bpm',
    field: 'heartAverage',
    valid: (value) => Number.isFinite(value) && value > 0,
    minimumChange: 0.1,
  },
  oxygen: {
    label: 'Saturation moyenne',
    shortLabel: 'SpO₂ moyenne',
    unit: '%',
    field: 'spo2Average',
    valid: (value) => Number.isFinite(value) && value > 0,
    minimumChange: 0.025,
  },
  stress: {
    label: 'Stress moyen',
    shortLabel: 'Stress moyen',
    unit: 'points',
    field: 'stressAverage',
    valid: (value) => Number.isFinite(value) && value >= 0,
    minimumChange: 0.25,
  },
  activeMinutes: {
    label: 'Temps actif',
    shortLabel: 'Temps actif',
    unit: 'min',
    field: 'activeMinutes',
    valid: (value) => Number.isFinite(value) && value >= 0,
    minimumChange: 0.25,
  },
}

const BASELINE_KEYS = ['steps', 'sleep', 'heart', 'oxygen', 'stress']

const CORRELATION_PAIRS = [
  { x: 'sleep', y: 'heart', label: 'Sommeil et cœur moyen' },
  { x: 'sleep', y: 'stress', label: 'Sommeil et stress' },
  { x: 'steps', y: 'stress', label: 'Activité et stress' },
  { x: 'steps', y: 'sleep', label: 'Activité et sommeil' },
  { x: 'activeMinutes', y: 'heart', label: 'Temps actif et cœur moyen' },
]

function timestamp(day) {
  const value = Date.parse(`${day}T00:00:00Z`)
  return Number.isFinite(value) ? value : 0
}

function qualityFor(row, fallback = 80) {
  const value = Number(row?.quality?.score)
  return Number.isFinite(value) ? Math.max(0, Math.min(100, value)) : fallback
}

function valueFor(row, metricKey) {
  const metric = INTELLIGENCE_METRICS[metricKey]
  const value = Number(row?.[metric.field])
  return metric.valid(value) ? value : null
}

function mean(values) {
  return values.length ? values.reduce((sum, value) => sum + value, 0) / values.length : 0
}

function standardDeviation(values, center = mean(values)) {
  if (values.length < 2) return 0
  return Math.sqrt(values.reduce((sum, value) => sum + (value - center) ** 2, 0) / values.length)
}

function robustStats(values) {
  const center = median(values)
  const deviations = values.map((value) => Math.abs(value - center))
  const mad = median(deviations)
  const q1 = percentile(values, 0.25)
  const q3 = percentile(values, 0.75)
  const fallbackScale = standardDeviation(values, center) || (q3 - q1) / 1.349 || Math.abs(center) * 0.05 || 1
  return {
    median: center,
    low: q1,
    high: q3,
    scale: mad > 0 ? mad * 1.4826 : fallbackScale,
  }
}

export function consolidateHistory(imports = [], currentDataset = null, currentSummary = null) {
  const byDay = new Map()
  let duplicateDays = 0
  const orderedImports = [...imports].sort((a, b) => String(a.importedAt || '').localeCompare(String(b.importedAt || '')))

  for (const item of orderedImports) {
    for (const row of item.days || []) {
      if (!row.day) continue
      if (byDay.has(row.day)) duplicateDays += 1
      byDay.set(row.day, {
        ...byDay.get(row.day),
        ...row,
        sourceImportId: item.id,
        sourceFileName: item.fileName,
        sourceImportedAt: item.importedAt,
        quality: row.quality || byDay.get(row.day)?.quality,
      })
    }
  }

  const selectedDay = currentDataset?.day || currentSummary?.day
  if (selectedDay && currentSummary) {
    byDay.set(selectedDay, {
      ...byDay.get(selectedDay),
      ...currentSummary,
      sourceImportId: currentDataset.id,
      sourceFileName: currentDataset.fileName,
      quality: currentDataset.days?.find((item) => item.day === selectedDay)?.quality,
    })
  }

  return {
    rows: [...byDay.values()].sort((a, b) => a.day.localeCompare(b.day)),
    duplicateDays,
    importCount: new Set([...byDay.values()].map((row) => row.sourceImportId).filter(Boolean)).size,
  }
}

function pearson(rows, xKey, yKey) {
  const pairs = rows
    .map((row) => [valueFor(row, xKey), valueFor(row, yKey)])
    .filter(([x, y]) => x != null && y != null)
  if (pairs.length < 2) return { coefficient: 0, samples: pairs.length }
  const xMean = mean(pairs.map(([x]) => x))
  const yMean = mean(pairs.map(([, y]) => y))
  let numerator = 0
  let xSquare = 0
  let ySquare = 0
  for (const [x, y] of pairs) {
    const xDelta = x - xMean
    const yDelta = y - yMean
    numerator += xDelta * yDelta
    xSquare += xDelta ** 2
    ySquare += yDelta ** 2
  }
  const denominator = Math.sqrt(xSquare * ySquare)
  return { coefficient: denominator ? numerator / denominator : 0, samples: pairs.length }
}

function buildCorrelations(rows) {
  return CORRELATION_PAIRS.map((pair) => {
    const result = pearson(rows, pair.x, pair.y)
    const magnitude = Math.abs(result.coefficient)
    return {
      ...pair,
      ...result,
      direction: result.coefficient >= 0 ? 'same' : 'opposite',
      strength: magnitude >= 0.7 ? 'forte' : magnitude >= 0.45 ? 'modérée' : 'faible',
    }
  })
    .filter((item) => item.samples >= 10 && Math.abs(item.coefficient) >= 0.3)
    .sort((a, b) => Math.abs(b.coefficient) - Math.abs(a.coefficient))
    .slice(0, 3)
}

function linearProjection(rows, metricKey) {
  const points = rows
    .map((row) => ({ x: timestamp(row.day) / 86_400_000, y: valueFor(row, metricKey) }))
    .filter((point) => point.x && point.y != null)
    .slice(-60)
  if (points.length < 14) return null
  const xMean = mean(points.map((point) => point.x))
  const yMean = mean(points.map((point) => point.y))
  const denominator = points.reduce((sum, point) => sum + (point.x - xMean) ** 2, 0)
  if (!denominator) return null
  const slope = points.reduce((sum, point) => sum + (point.x - xMean) * (point.y - yMean), 0) / denominator
  const intercept = yMean - slope * xMean
  const residuals = points.map((point) => Math.abs(point.y - (intercept + slope * point.x)))
  const error = median(residuals)
  const projected = Math.max(0, intercept + slope * (points.at(-1).x + 7))
  const weeklyChange = slope * 7
  const relativeChange = yMean ? weeklyChange / yMean : 0
  return {
    metricKey,
    samples: points.length,
    projected,
    low: Math.max(0, projected - error * 1.5),
    high: projected + error * 1.5,
    weeklyChange,
    trend: Math.abs(relativeChange) < 0.05 ? 'stable' : weeklyChange > 0 ? 'up' : 'down',
  }
}

function buildForecasts(rows) {
  return ['steps', 'sleep'].map((metricKey) => linearProjection(rows, metricKey)).filter(Boolean)
}

function signalText(metricKey, direction, current, center, percent) {
  const deltaText = `${Math.abs(Math.round(percent * 100))} % ${direction === 'high' ? 'au-dessus' : 'au-dessous'}`
  if (metricKey === 'heart') return `La moyenne cardiaque est ${deltaText} de votre valeur habituelle. Vérifiez le mouvement, le sommeil et la qualité des mesures avant d’interpréter cet écart.`
  if (metricKey === 'oxygen') return `La moyenne SpO₂ est ${deltaText} de votre profil. Recontrôlez la mesure au repos si l’écart se répète.`
  if (metricKey === 'sleep') return `Le sommeil détecté est ${deltaText} de votre médiane. Vérifiez que la sauvegarde contient bien toute la nuit.`
  if (metricKey === 'stress') return `Le score de stress est ${deltaText} de votre niveau habituel. Regardez surtout si cette variation persiste plusieurs jours.`
  return `L’activité est ${deltaText} de votre médiane personnelle. Une seule journée ne définit pas une tendance.`
}

function buildBaselines(current, previousRows) {
  return BASELINE_KEYS.map((metricKey) => {
    const metric = INTELLIGENCE_METRICS[metricKey]
    const currentValue = valueFor(current, metricKey)
    const values = previousRows.map((row) => valueFor(row, metricKey)).filter((value) => value != null)
    const stats = values.length ? robustStats(values) : null
    const percent = stats && stats.median ? (currentValue - stats.median) / Math.abs(stats.median) : 0
    const robustScore = stats && currentValue != null ? (currentValue - stats.median) / stats.scale : 0
    return {
      metricKey,
      ...metric,
      current: currentValue,
      samples: values.length,
      median: stats?.median ?? null,
      low: stats?.low ?? null,
      high: stats?.high ?? null,
      percent,
      robustScore,
      ready: values.length >= 7 && currentValue != null,
    }
  })
}

function buildSignals(baselines, currentQuality) {
  if (currentQuality < 60) return []
  return baselines
    .filter((item) => item.ready)
    .filter((item) => Math.abs(item.robustScore) >= 2 && Math.abs(item.percent) >= item.minimumChange)
    .map((item) => {
      const direction = item.current >= item.median ? 'high' : 'low'
      return {
        id: `personal-${item.metricKey}`,
        metricKey: item.metricKey,
        level: Math.abs(item.robustScore) >= 3 ? 'attention' : 'watch',
        direction,
        title: `Variation inhabituelle — ${item.shortLabel}`,
        text: signalText(item.metricKey, direction, item.current, item.median, item.percent),
        current: item.current,
        baseline: item.median,
        samples: item.samples,
        score: item.robustScore,
      }
    })
    .sort((a, b) => Math.abs(b.score) - Math.abs(a.score))
}

function buildConfidence(rows, current, baselines, currentQuality) {
  const priorDays = rows.filter((row) => row.day < current.day).length
  const historyScore = Math.min(100, priorDays / 30 * 100)
  const completeness = BASELINE_KEYS.filter((key) => valueFor(current, key) != null).length / BASELINE_KEYS.length * 100
  const dated = rows.map((row) => timestamp(row.day)).filter(Boolean).sort((a, b) => a - b)
  const span = dated.length > 1 ? Math.max(1, Math.round((dated.at(-1) - dated[0]) / 86_400_000) + 1) : 1
  const regularity = dated.length > 1 ? Math.min(100, dated.length / span * 100) : 0
  const baselineCoverage = baselines.filter((item) => item.ready).length / BASELINE_KEYS.length * 100
  let score = Math.round(currentQuality * 0.4 + historyScore * 0.25 + completeness * 0.15 + regularity * 0.1 + baselineCoverage * 0.1)
  if (priorDays < 7) score = Math.min(score, 49)
  else if (priorDays < 14) score = Math.min(score, 69)
  return {
    score,
    level: score >= 80 ? 'high' : score >= 55 ? 'medium' : 'low',
    currentQuality: Math.round(currentQuality),
    historyScore: Math.round(historyScore),
    completeness: Math.round(completeness),
    regularity: Math.round(regularity),
    priorDays,
  }
}

function buildNarrative({ confidence, signals, correlations, forecasts }) {
  if (confidence.priorDays < 7) {
    const remaining = 7 - confidence.priorDays
    return `Le profil personnel est en apprentissage. Il manque encore ${remaining} journée${remaining > 1 ? 's' : ''} antérieure${remaining > 1 ? 's' : ''} pour détecter des variations par rapport à vos habitudes.`
  }
  if (confidence.currentQuality < 60) {
    return 'La qualité de la journée est trop faible pour produire des alertes personnelles fiables. Corrigez ou réimportez les données avant de les interpréter.'
  }
  if (signals.length) {
    return `${signals.length} variation${signals.length > 1 ? 's' : ''} personnelle${signals.length > 1 ? 's' : ''} ressort${signals.length > 1 ? 'ent' : ''} aujourd’hui. Chaque résultat est comparé à votre médiane et accompagné de son contexte.`
  }
  if (correlations.length || forecasts.length) {
    return 'Aucune variation personnelle importante ne ressort aujourd’hui. Les tendances ci-dessous décrivent l’historique sans établir de cause ni de diagnostic.'
  }
  return 'Le profil personnel est disponible, mais l’historique ne contient pas encore assez de mesures comparables pour les corrélations et les projections.'
}

export function buildLocalIntelligence({ dataset, day, imports = [], rangeDays = 30, currentSummary }) {
  const consolidated = consolidateHistory(imports.length ? imports : [dataset], dataset, currentSummary)
  const selectedTimestamp = timestamp(day)
  const earliest = rangeDays ? selectedTimestamp - rangeDays * 86_400_000 : 0
  const rows = consolidated.rows.filter((row) => row.day <= day && (!earliest || timestamp(row.day) >= earliest))
  const current = rows.find((row) => row.day === day) || { day, ...currentSummary }
  const previousRows = rows.filter((row) => row.day < day && qualityFor(row, dataset.metadata?.quality?.score || 80) >= 50)
  const currentQuality = qualityFor(current, dataset.metadata?.quality?.score || 80)
  const analyticRows = rows.filter((row) => qualityFor(row, dataset.metadata?.quality?.score || 80) >= 50)
  const baselines = buildBaselines(current, previousRows)
  const signals = buildSignals(baselines, currentQuality)
  const correlations = buildCorrelations(analyticRows)
  const forecasts = buildForecasts(analyticRows)
  const confidence = buildConfidence(rows, current, baselines, currentQuality)
  const readiness = {
    personal: Math.min(7, confidence.priorDays),
    personalTarget: 7,
    correlations: Math.min(10, analyticRows.length),
    correlationsTarget: 10,
    forecasts: Math.min(14, analyticRows.length),
    forecastsTarget: 14,
  }

  return {
    version: INTELLIGENCE_VERSION,
    rangeDays,
    day,
    rows,
    current,
    baselines,
    signals,
    correlations,
    forecasts,
    confidence,
    readiness,
    narrative: buildNarrative({ confidence, signals, correlations, forecasts }),
    sources: {
      days: rows.length,
      imports: consolidated.importCount,
      duplicateDays: consolidated.duplicateDays,
    },
  }
}
