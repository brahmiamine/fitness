import { average } from '../format'
import { BASELINE_METRICS, computeMetricBaseline, deviationFromWindow, qualityPasses, requireMetric } from './baselines'

const DAY_MS = 86_400_000

function parseDay(day) {
  return Date.parse(`${day}T00:00:00Z`)
}

function shiftDay(day, offsetDays) {
  return new Date(parseDay(day) + offsetDays * DAY_MS).toISOString().slice(0, 10)
}

function weekdayOf(day) {
  return new Date(`${day}T12:00:00Z`).getUTCDay()
}

/** Consecutive calendar days, inclusive, oldest first. */
function dayRange(startDay, endDay) {
  const days = []
  for (let cursor = startDay; cursor <= endDay; cursor = shiftDay(cursor, 1)) days.push(cursor)
  return days
}

function aggregateOverDays(snapshots, days, metric, { qualityThreshold = 50 } = {}) {
  const byDay = new Map(snapshots.map((snapshot) => [snapshot.day, snapshot]))
  const values = []
  let qualityPassCount = 0
  let daysWithData = 0
  for (const day of days) {
    const snapshot = byDay.get(day)
    if (!snapshot) continue
    daysWithData += 1
    if (!qualityPasses(snapshot, qualityThreshold)) continue
    qualityPassCount += 1
    const value = metric.extract(snapshot)
    if (value != null && Number.isFinite(value)) values.push(value)
  }
  return {
    start: days[0],
    end: days.at(-1),
    daysRequested: days.length,
    daysWithData,
    samples: values.length,
    qualityCoverage: daysWithData ? qualityPassCount / daysWithData : 0,
    value: values.length ? (metric.aggregation === 'sum' ? values.reduce((sum, v) => sum + v, 0) : average(values)) : null,
  }
}

function relativeChange(periodA, periodB) {
  if (periodA.value == null || periodB.value == null) return null
  const absoluteChange = periodA.value - periodB.value
  const percentChange = periodB.value ? absoluteChange / Math.abs(periodB.value) : null
  return {
    absoluteChange,
    percentChange,
    direction: absoluteChange === 0 ? 'stable' : absoluteChange > 0 ? 'up' : 'down',
  }
}

function periodConfidence(periodA, periodB) {
  const coverage = Math.min(periodA.qualityCoverage, periodB.qualityCoverage)
  const completeness = Math.min(
    periodA.daysWithData / Math.max(1, periodA.daysRequested),
    periodB.daysWithData / Math.max(1, periodB.daysRequested),
  )
  return Math.round(coverage * completeness * 100) / 100
}

/**
 * Compares two equal-length, non-overlapping day windows for one metric.
 * Returns `comparable: false` (rather than throwing) when the windows
 * aren't the same length — callers build periods, this only judges them.
 */
function comparePeriods({ metricKey, type, periodADays, periodBDays, snapshots, options }) {
  const metric = requireMetric(metricKey)
  if (periodADays.length !== periodBDays.length || !periodADays.length) {
    return { type, metricKey, domain: metric.domain, comparable: false }
  }
  const periodA = aggregateOverDays(snapshots, periodADays, metric, options)
  const periodB = aggregateOverDays(snapshots, periodBDays, metric, options)
  const change = relativeChange(periodA, periodB)
  return {
    type,
    metricKey,
    domain: metric.domain,
    comparable: change != null,
    periodA,
    periodB,
    ...change,
    confidence: change ? periodConfidence(periodA, periodB) : 0,
  }
}

/** Today vs the single previous calendar day. */
export function compareTodayVsYesterday(snapshots, targetDay, metricKey, options) {
  return comparePeriods({
    metricKey,
    type: 'today_vs_yesterday',
    periodADays: [targetDay],
    periodBDays: [shiftDay(targetDay, -1)],
    snapshots,
    options,
  })
}

/** Last N days (ending yesterday) vs the previous, non-overlapping, N-day block. */
export function compareLastNDays(snapshots, targetDay, metricKey, windowDays, options) {
  const periodAEnd = shiftDay(targetDay, -1)
  const periodAStart = shiftDay(targetDay, -windowDays)
  const periodBEnd = shiftDay(periodAStart, -1)
  const periodBStart = shiftDay(periodBEnd, -(windowDays - 1))
  return comparePeriods({
    metricKey,
    type: `last${windowDays}_vs_previous${windowDays}`,
    periodADays: dayRange(periodAStart, periodAEnd),
    periodBDays: dayRange(periodBStart, periodBEnd),
    snapshots,
    options,
  })
}

/**
 * Week-to-date (from this week's Monday through targetDay) vs the *same*
 * weekday span one week earlier. Both periods always have identical
 * length, so a partial week is never compared against a full one.
 */
export function compareWeekToDate(snapshots, targetDay, metricKey, options) {
  const isoWeekday = weekdayOf(targetDay) === 0 ? 7 : weekdayOf(targetDay)
  const weekStart = shiftDay(targetDay, -(isoWeekday - 1))
  const periodADays = dayRange(weekStart, targetDay)
  const periodBDays = periodADays.map((day) => shiftDay(day, -7))
  return comparePeriods({
    metricKey,
    type: 'week_to_date_vs_previous_week',
    periodADays,
    periodBDays,
    snapshots,
    options,
  })
}

/** Current value against the rolling-7-day personal baseline (#14). */
export function compareToPersonalBaseline(snapshots, targetDay, metricKey, windowKey = 'rolling7', options) {
  const metric = requireMetric(metricKey)
  const baseline = computeMetricBaseline(snapshots, targetDay, metricKey, options)
  const window = baseline.windows[windowKey]
  const deviation = deviationFromWindow(baseline.currentValue, window)
  return {
    type: `current_vs_baseline_${windowKey}`,
    metricKey,
    domain: metric.domain,
    comparable: deviation != null,
    currentValue: baseline.currentValue,
    baseline: window,
    ...deviation,
    confidence: deviation ? Math.min(1, window.sampleCount / 14) : 0,
  }
}

/** Current value against the historical same-weekday baseline (#14). */
export function compareToWeekdayBaseline(snapshots, targetDay, metricKey, options) {
  const metric = requireMetric(metricKey)
  const baseline = computeMetricBaseline(snapshots, targetDay, metricKey, options)
  const deviation = deviationFromWindow(baseline.currentValue, baseline.weekday)
  return {
    type: 'current_vs_weekday_baseline',
    metricKey,
    domain: metric.domain,
    comparable: deviation != null,
    currentValue: baseline.currentValue,
    baseline: baseline.weekday,
    ...deviation,
    confidence: deviation ? Math.min(1, baseline.weekday.sampleCount / 8) : 0,
  }
}

/** Every comparison listed in the issue, for one metric. */
export function buildMetricComparisons(snapshots, targetDay, metricKey, options) {
  return [
    compareTodayVsYesterday(snapshots, targetDay, metricKey, options),
    compareLastNDays(snapshots, targetDay, metricKey, 3, options),
    compareLastNDays(snapshots, targetDay, metricKey, 7, options),
    compareWeekToDate(snapshots, targetDay, metricKey, options),
    compareLastNDays(snapshots, targetDay, metricKey, 28, options),
    compareToPersonalBaseline(snapshots, targetDay, metricKey, 'rolling7', options),
    compareToWeekdayBaseline(snapshots, targetDay, metricKey, options),
  ]
}

export function buildComparisons(snapshots, targetDay, metricKeys = Object.keys(BASELINE_METRICS), options) {
  return metricKeys.flatMap((metricKey) => buildMetricComparisons(snapshots, targetDay, metricKey, options))
}

function comparisonSignificance(comparison) {
  if (!comparison.comparable) return 0
  const magnitude = Math.abs(comparison.percentChange ?? comparison.robustScore ?? 0)
  return magnitude * (comparison.confidence ?? 0)
}

/**
 * Ranks every comparable comparison by decision relevance
 * (magnitude x confidence) and returns the most relevant ones first.
 */
export function rankComparisons(comparisons, limit = 5) {
  return [...comparisons]
    .filter((comparison) => comparison.comparable)
    .sort((a, b) => comparisonSignificance(b) - comparisonSignificance(a))
    .slice(0, limit)
}

const DEFAULT_TREND_LOOKBACK_DAYS = 14
const DEFAULT_TREND_ROBUST_SCORE_THRESHOLD = 1.3

/**
 * Walks backward day by day from targetDay, re-deriving the metric's
 * rolling-7 baseline *as of each day* (so the trend can never include the
 * days it is itself measured against), and counts how many most-recent
 * consecutive days sit on the same side of that baseline. A trend needs at
 * least `minConsecutiveDays` (default 3) — one isolated value is never a
 * trend, but a persistent one is reported whether it is favorable or not.
 */
export function detectSustainedTrend(snapshots, targetDay, metricKey, options = {}) {
  const { minConsecutiveDays = 3, robustScoreThreshold = DEFAULT_TREND_ROBUST_SCORE_THRESHOLD, lookbackDays = DEFAULT_TREND_LOOKBACK_DAYS } = options
  const metric = requireMetric(metricKey)
  const byDay = new Map(snapshots.map((snapshot) => [snapshot.day, snapshot]))

  let direction = null
  let duration = 0
  let firstDay = targetDay
  let lastRobustScore = 0
  const qualityScores = []

  for (let back = 0; back < lookbackDays; back += 1) {
    const day = shiftDay(targetDay, -back)
    const snapshot = byDay.get(day)
    if (!snapshot) break
    const value = metric.extract(snapshot)
    if (value == null) break
    const baseline = computeMetricBaseline(snapshots, day, metricKey, options)
    const deviation = deviationFromWindow(value, baseline.windows.rolling7)
    if (!deviation || Math.abs(deviation.robustScore) < robustScoreThreshold) break
    if (direction && deviation.direction !== direction) break
    direction = deviation.direction
    lastRobustScore = deviation.robustScore
    duration += 1
    firstDay = day
    qualityScores.push(snapshot.quality?.score ?? 100)
  }

  if (duration < minConsecutiveDays) return null

  return {
    metricKey,
    domain: metric.domain,
    direction,
    magnitude: lastRobustScore,
    duration,
    period: { start: firstDay, end: targetDay },
    samples: duration,
    qualityCoverage: qualityScores.length ? average(qualityScores) / 100 : 0,
    confidence: Math.min(1, (duration / lookbackDays) * (qualityScores.length ? average(qualityScores) / 100 : 0) * 2),
  }
}

export function detectSustainedTrends(snapshots, targetDay, metricKeys = Object.keys(BASELINE_METRICS), options) {
  return metricKeys
    .map((metricKey) => detectSustainedTrend(snapshots, targetDay, metricKey, options))
    .filter(Boolean)
}
