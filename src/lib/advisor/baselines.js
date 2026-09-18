import { median, percentile } from '../format'

/**
 * Domain-agnostic personal baseline engine. Generalizes the median/MAD
 * approach already used by src/lib/intelligence.js so every future advisor
 * (#18-#21) reads baselines through one shared, tested API instead of
 * reimplementing robust statistics per domain.
 */
export const BASELINE_WINDOWS = {
  yesterday: { days: 1, minimumSamples: 1 },
  rolling3: { days: 3, minimumSamples: 2 },
  rolling7: { days: 7, minimumSamples: 4 },
  rolling28: { days: 28, minimumSamples: 14 },
  rolling90: { days: 90, minimumSamples: 30 },
}

const WEEKDAY_MINIMUM_SAMPLES = 4

function workoutMinutes(snapshot) {
  return (snapshot.workouts || []).reduce((sum, workout) => sum + (workout.duration || 0) / 60, 0)
}

/**
 * Each metric extracts a number from a DailyHealthSnapshot, or `null` when
 * that domain simply has no sample that day. Per the "missing values are
 * not zero" rule, sensor-derived metrics (heart/oxygen/stress/sleep) return
 * `null` rather than 0 when their sample count is 0; count-like activity
 * metrics (steps, workouts) legitimately can be 0 on a real rest day.
 */
export const BASELINE_METRICS = {
  steps: { label: 'Pas', extract: (s) => s.activity.steps },
  activeMinutes: { label: 'Minutes actives', extract: (s) => s.activity.activeMinutes },
  intensiveMinutes: { label: 'Minutes intensives', extract: (s) => s.activity.intensiveMinutes },
  sleepMinutes: { label: 'Sommeil', extract: (s) => (s.sleep.sessions > 0 ? s.sleep.minutes : null) },
  heartAverage: { label: 'Cœur moyen', extract: (s) => (s.heart.samples > 0 ? s.heart.average : null) },
  spo2Average: { label: 'SpO₂ moyenne', extract: (s) => (s.oxygen.samples > 0 ? s.oxygen.average : null) },
  stressAverage: { label: 'Stress moyen', extract: (s) => (s.stress.samples > 0 ? s.stress.average : null) },
  workoutMinutes: { label: 'Minutes de séance', extract: workoutMinutes },
  workoutCount: { label: 'Séances', extract: (s) => (s.workouts || []).length },
  weightKg: { label: 'Poids', extract: (s) => s.weight?.valueKg ?? null },
}

export function requireMetric(metricKey) {
  const metric = BASELINE_METRICS[metricKey]
  if (!metric) throw new Error(`Métrique de référentiel personnel inconnue : "${metricKey}".`)
  return metric
}

function dayIndex(day) {
  const value = Date.parse(`${day}T00:00:00Z`)
  return Number.isFinite(value) ? Math.round(value / 86_400_000) : null
}

function daysBefore(snapshots, targetDay) {
  return snapshots.filter((snapshot) => snapshot.day < targetDay)
}

function qualityPasses(snapshot, qualityThreshold) {
  const score = snapshot.quality?.score
  return score == null || score >= qualityThreshold
}

function robustStats(values) {
  if (!values.length) return null
  const center = median(values)
  const q1 = percentile(values, 0.25)
  const q3 = percentile(values, 0.75)
  const mad = median(values.map((value) => Math.abs(value - center)))
  const fallbackScale = (q3 - q1) / 1.349 || Math.abs(center) * 0.05 || 1
  return {
    median: center,
    q1,
    q3,
    scale: mad > 0 ? mad * 1.4826 : fallbackScale,
    minimum: Math.min(...values),
    maximum: Math.max(...values),
  }
}

function buildWindowStats(snapshots, targetDay, metric, windowDef, { qualityThreshold = 50 } = {}) {
  const targetIndex = dayIndex(targetDay)
  const values = daysBefore(snapshots, targetDay)
    .filter((snapshot) => {
      if (!windowDef.days) return true
      const index = dayIndex(snapshot.day)
      return index != null && targetIndex != null && targetIndex - index <= windowDef.days
    })
    .filter((snapshot) => qualityPasses(snapshot, qualityThreshold))
    .map((snapshot) => metric.extract(snapshot))
    .filter((value) => value != null && Number.isFinite(value))

  const stats = robustStats(values)
  return {
    windowDays: windowDef.days,
    sampleCount: values.length,
    ready: values.length >= windowDef.minimumSamples,
    ...(stats || { median: null, q1: null, q3: null, scale: null, minimum: null, maximum: null }),
  }
}

function buildWeekdayStats(snapshots, targetDay, metric, { qualityThreshold = 50 } = {}) {
  const targetWeekday = new Date(`${targetDay}T12:00:00Z`).getUTCDay()
  const values = daysBefore(snapshots, targetDay)
    .filter((snapshot) => new Date(`${snapshot.day}T12:00:00Z`).getUTCDay() === targetWeekday)
    .filter((snapshot) => qualityPasses(snapshot, qualityThreshold))
    .map((snapshot) => metric.extract(snapshot))
    .filter((value) => value != null && Number.isFinite(value))

  const stats = robustStats(values)
  return {
    weekday: targetWeekday,
    sampleCount: values.length,
    ready: values.length >= WEEKDAY_MINIMUM_SAMPLES,
    ...(stats || { median: null, q1: null, q3: null, scale: null, minimum: null, maximum: null }),
  }
}

/**
 * A baseline is only "personal" once it clears its window's minimum sample
 * requirement; callers must check `.ready` (or `.windows.rolling7.ready`,
 * etc.) before phrasing anything as learned personal behavior.
 */
export function computeMetricBaseline(snapshots, targetDay, metricKey, options = {}) {
  const metric = requireMetric(metricKey)
  const target = snapshots.find((snapshot) => snapshot.day === targetDay)
  const windows = Object.fromEntries(
    Object.entries(BASELINE_WINDOWS).map(([key, definition]) => [
      key,
      buildWindowStats(snapshots, targetDay, metric, definition, options),
    ]),
  )
  return {
    metricKey,
    label: metric.label,
    day: targetDay,
    currentValue: target ? metric.extract(target) : null,
    windows,
    weekday: buildWeekdayStats(snapshots, targetDay, metric, options),
  }
}

export function buildPersonalBaselines(snapshots, targetDay, metricKeys = Object.keys(BASELINE_METRICS), options = {}) {
  return Object.fromEntries(metricKeys.map((key) => [key, computeMetricBaseline(snapshots, targetDay, key, options)]))
}

/**
 * Robust deviation of `value` from a window's distribution — a modified
 * z-score using MAD-based scale instead of standard deviation, so a single
 * extreme day can't distort the reference the way a plain mean/SD would.
 * Returns null when the window isn't ready or has no spread information.
 */
export function deviationFromWindow(value, window) {
  if (value == null || !window?.ready || window.median == null || !window.scale) return null
  const percent = window.median ? (value - window.median) / Math.abs(window.median) : 0
  const robustScore = (value - window.median) / window.scale
  return { percent, robustScore, direction: value >= window.median ? 'high' : 'low' }
}
