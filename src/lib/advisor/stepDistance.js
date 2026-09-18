import { median, percentile } from '../format'
import { qualityPasses } from './baselines'

/**
 * Estimates walking distance from step count alone. GPS/gpsPrivate are
 * never read here — DailyHealthSnapshot (#12) already never exposes them,
 * so this module structurally cannot depend on them. The watch's own
 * per-day `distance` field is itself computed by the watch from its
 * accelerometer/step model (not GPS), so it is safe to use as the ground
 * truth to LEARN a personal meters-per-step ratio; the ratio is then the
 * only thing reapplied to future step counts. Step count remains the
 * primary target everywhere else in the app — this only produces a
 * secondary, clearly-labeled distance estimate.
 */

export const DEFAULT_MINIMUM_SAMPLES = 10
const DEFAULT_QUALITY_THRESHOLD = 50
const MINIMUM_STEPS_FOR_RATIO = 500
// Sanity bounds to reject corrupted/parsing-error rows, not a stride default:
// no real adult or child stride falls outside this range.
const PLAUSIBLE_METERS_PER_STEP = { min: 0.2, max: 2 }

function dailyRatios(snapshots, { qualityThreshold = DEFAULT_QUALITY_THRESHOLD } = {}) {
  const ratios = []
  for (const snapshot of snapshots) {
    const steps = snapshot.activity?.steps
    const distanceMeters = snapshot.activity?.distanceMeters
    if (!Number.isFinite(steps) || steps < MINIMUM_STEPS_FOR_RATIO) continue
    if (!Number.isFinite(distanceMeters) || distanceMeters <= 0) continue
    if (!qualityPasses(snapshot, qualityThreshold)) continue
    const ratio = distanceMeters / steps
    if (ratio < PLAUSIBLE_METERS_PER_STEP.min || ratio > PLAUSIBLE_METERS_PER_STEP.max) continue
    ratios.push(ratio)
  }
  return ratios
}

/**
 * Learns the personal meters-per-step coefficient from every reliable day
 * strictly before `targetDay` (so a day's own distance estimate never
 * leaks into the coefficient used to produce it).
 */
export function learnPersonalStepDistanceCoefficient(snapshots, targetDay, options = {}) {
  const { minimumSamples = DEFAULT_MINIMUM_SAMPLES } = options
  const history = targetDay ? snapshots.filter((snapshot) => snapshot.day < targetDay) : snapshots
  const ratios = dailyRatios(history, options)

  if (ratios.length < minimumSamples) {
    return {
      ready: false,
      coefficientMetersPerStep: null,
      sampleCount: ratios.length,
      minimumSamples,
      confidence: 0,
    }
  }

  const coefficient = median(ratios)
  const q1 = percentile(ratios, 0.25)
  const q3 = percentile(ratios, 0.75)
  const deviations = ratios.map((ratio) => Math.abs(ratio - coefficient))
  const mad = median(deviations)
  const spread = mad > 0 ? mad * 1.4826 : (q3 - q1) / 1.349 || 0
  const relativeSpread = coefficient ? spread / coefficient : 1
  const confidence = Math.max(0, Math.min(1, Math.min(1, ratios.length / (minimumSamples * 2)) * (1 - Math.min(1, relativeSpread))))

  return {
    ready: true,
    coefficientMetersPerStep: coefficient,
    spreadMetersPerStep: spread,
    sampleCount: ratios.length,
    minimumSamples,
    confidence,
  }
}

/**
 * Estimates distance for a step count using an already-learned
 * coefficient. Returns null (never a guessed value) when the coefficient
 * isn't ready yet — callers must fall back to showing steps only.
 */
export function estimateDistanceFromSteps(steps, coefficient) {
  if (!coefficient?.ready || !Number.isFinite(steps) || steps < 0) return null
  return steps * coefficient.coefficientMetersPerStep
}

/**
 * Convenience wrapper for one day: learns the coefficient from history
 * before `targetDay`, then estimates that day's distance from its own
 * step count. `distanceMeters` stays null (steps-only) until the
 * coefficient has enough reliable history.
 */
export function estimateStepDistanceForDay(snapshots, targetDay, options = {}) {
  const target = snapshots.find((snapshot) => snapshot.day === targetDay)
  const steps = target?.activity?.steps ?? null
  const coefficient = learnPersonalStepDistanceCoefficient(snapshots, targetDay, options)
  return {
    day: targetDay,
    steps,
    distanceMeters: steps != null ? estimateDistanceFromSteps(steps, coefficient) : null,
    coefficient,
  }
}
