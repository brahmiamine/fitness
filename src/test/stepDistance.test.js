import { describe, expect, it } from 'vitest'
import {
  DEFAULT_MINIMUM_SAMPLES,
  estimateDistanceFromSteps,
  estimateStepDistanceForDay,
  learnPersonalStepDistanceCoefficient,
} from '../lib/advisor/stepDistance'

function addDays(day, offset) {
  const date = new Date(`${day}T00:00:00Z`)
  date.setUTCDate(date.getUTCDate() + offset)
  return date.toISOString().slice(0, 10)
}

function daySnapshot(day, { steps = 6000, distanceMeters = 4500, qualityScore = 95, gps = undefined } = {}) {
  return {
    day,
    activity: { steps, distanceMeters },
    quality: { score: qualityScore },
    ...(gps ? { gps } : {}),
  }
}

const START = '2026-06-01'

describe('learnPersonalStepDistanceCoefficient', () => {
  it('is not ready with fewer than the minimum sample count', () => {
    const snapshots = Array.from({ length: DEFAULT_MINIMUM_SAMPLES - 1 }, (_, i) => daySnapshot(addDays(START, i)))
    const coefficient = learnPersonalStepDistanceCoefficient(snapshots, addDays(START, DEFAULT_MINIMUM_SAMPLES))
    expect(coefficient.ready).toBe(false)
    expect(coefficient.coefficientMetersPerStep).toBeNull()
  })

  it('learns the personal median meters-per-step once enough reliable days exist', () => {
    const snapshots = Array.from({ length: 20 }, (_, i) => daySnapshot(addDays(START, i), { steps: 6000, distanceMeters: 4500 }))
    const coefficient = learnPersonalStepDistanceCoefficient(snapshots, addDays(START, 20))
    expect(coefficient.ready).toBe(true)
    expect(coefficient.coefficientMetersPerStep).toBeCloseTo(0.75)
    expect(coefficient.sampleCount).toBe(20)
  })

  it('is resistant to a single outlier day (median, not mean)', () => {
    const snapshots = Array.from({ length: 19 }, (_, i) => daySnapshot(addDays(START, i), { steps: 6000, distanceMeters: 4500 }))
    snapshots.push(daySnapshot(addDays(START, 19), { steps: 6000, distanceMeters: 11400 })) // ratio 1.9, still "plausible"
    const coefficient = learnPersonalStepDistanceCoefficient(snapshots, addDays(START, 20))
    expect(coefficient.coefficientMetersPerStep).toBeCloseTo(0.75, 1)
  })

  it('rejects physiologically implausible ratios as corrupted rows, not as the estimate', () => {
    const good = Array.from({ length: 20 }, (_, i) => daySnapshot(addDays(START, i), { steps: 6000, distanceMeters: 4500 }))
    const corrupted = daySnapshot(addDays(START, 20), { steps: 6000, distanceMeters: 30000 }) // ratio 5 m/step
    const coefficient = learnPersonalStepDistanceCoefficient([...good, corrupted], addDays(START, 21))
    expect(coefficient.sampleCount).toBe(20)
  })

  it('excludes low-quality days from the learned coefficient', () => {
    const good = Array.from({ length: 10 }, (_, i) => daySnapshot(addDays(START, i), { steps: 6000, distanceMeters: 4500, qualityScore: 95 }))
    const bad = Array.from({ length: 10 }, (_, i) => daySnapshot(addDays(START, i + 10), { steps: 6000, distanceMeters: 9000, qualityScore: 5 }))
    const coefficient = learnPersonalStepDistanceCoefficient([...good, ...bad], addDays(START, 20))
    expect(coefficient.sampleCount).toBe(10)
    expect(coefficient.coefficientMetersPerStep).toBeCloseTo(0.75)
  })

  it('excludes days with too few steps to give a stable ratio', () => {
    const snapshots = Array.from({ length: 20 }, (_, i) => daySnapshot(addDays(START, i), { steps: 100, distanceMeters: 400 }))
    const coefficient = learnPersonalStepDistanceCoefficient(snapshots, addDays(START, 20))
    expect(coefficient.ready).toBe(false)
    expect(coefficient.sampleCount).toBe(0)
  })

  it('never reads GPS data even when present on the snapshot', () => {
    const snapshots = Array.from({ length: 20 }, (_, i) =>
      daySnapshot(addDays(START, i), { steps: 6000, distanceMeters: 4500, gps: [{ latitude: 48.8, longitude: 2.3 }] }),
    )
    const coefficient = learnPersonalStepDistanceCoefficient(snapshots, addDays(START, 20))
    expect(coefficient.coefficientMetersPerStep).toBeCloseTo(0.75)
  })

  it('excludes the target day itself from its own coefficient (no leakage)', () => {
    const history = Array.from({ length: 15 }, (_, i) => daySnapshot(addDays(START, i), { steps: 6000, distanceMeters: 4500 }))
    const targetDay = addDays(START, 15)
    const target = daySnapshot(targetDay, { steps: 6000, distanceMeters: 30000 }) // wildly different, should not pollute its own baseline
    const coefficient = learnPersonalStepDistanceCoefficient([...history, target], targetDay)
    expect(coefficient.sampleCount).toBe(15)
    expect(coefficient.coefficientMetersPerStep).toBeCloseTo(0.75)
  })

  it('is deterministic for identical input', () => {
    const snapshots = Array.from({ length: 20 }, (_, i) => daySnapshot(addDays(START, i), { steps: 6000, distanceMeters: 4500 }))
    const a = learnPersonalStepDistanceCoefficient(snapshots, addDays(START, 20))
    const b = learnPersonalStepDistanceCoefficient(snapshots, addDays(START, 20))
    expect(a).toEqual(b)
  })
})

describe('estimateDistanceFromSteps', () => {
  it('returns null (steps-only) when the coefficient is not ready', () => {
    expect(estimateDistanceFromSteps(6000, { ready: false })).toBeNull()
  })

  it('applies the learned coefficient once ready', () => {
    expect(estimateDistanceFromSteps(6000, { ready: true, coefficientMetersPerStep: 0.75 })).toBeCloseTo(4500)
  })
})

describe('estimateStepDistanceForDay', () => {
  it('hides the km estimate for an under-sampled history but still reports steps', () => {
    const snapshots = [daySnapshot(START, { steps: 8000 })]
    const result = estimateStepDistanceForDay(snapshots, START)
    expect(result.steps).toBe(8000)
    expect(result.distanceMeters).toBeNull()
    expect(result.coefficient.ready).toBe(false)
  })

  it('estimates distance for the target day from its own step count once ready', () => {
    const history = Array.from({ length: 20 }, (_, i) => daySnapshot(addDays(START, i), { steps: 6000, distanceMeters: 4500 }))
    const targetDay = addDays(START, 20)
    const target = daySnapshot(targetDay, { steps: 8000, distanceMeters: 0 })
    const result = estimateStepDistanceForDay([...history, target], targetDay)
    expect(result.steps).toBe(8000)
    expect(result.distanceMeters).toBeCloseTo(6000)
  })
})
