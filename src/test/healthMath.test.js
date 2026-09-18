import { describe, expect, it } from 'vitest'
import {
  buildHealthMath,
  computeBmi,
  computeBmr,
  computeEnergyNeed,
  modelWeightGoal,
  modelWeightTrend,
  PROGRESSIVE_RATE_DEFAULTS,
} from '../lib/advisor/healthMath'

function addDays(day, offset) {
  const date = new Date(`${day}T00:00:00Z`)
  date.setUTCDate(date.getUTCDate() + offset)
  return date.toISOString().slice(0, 10)
}

function snapshot(day, kg) {
  return { day, weight: Number.isFinite(kg) ? { valueKg: kg, measuredAt: Date.parse(`${day}T12:00:00Z`) } : null }
}

const START = '2026-06-01'

describe('computeBmi', () => {
  it('returns an explicit missing height state instead of guessing', () => {
    const result = computeBmi({ weightKg: 82 })
    expect(result.computable).toBe(false)
    expect(result.missingInput).toBe('height')
    expect(result.value).toBeNull()
  })

  it('computes BMI in kg/m² with WHO category boundaries', () => {
    expect(computeBmi({ heightCm: 180, weightKg: 80 }).value).toBe(24.7)
    expect(computeBmi({ heightCm: 180, weightKg: 80 }).category).toBe('corpulence_normale')
    expect(computeBmi({ heightCm: 180, weightKg: 81 }).category).toBe('surpoids')
    expect(computeBmi({ heightCm: 180, weightKg: 81 }).formula.units).toBe('kg/m²')
  })

  it('reports a missing weight when height is present', () => {
    expect(computeBmi({ heightCm: 180 }).missingInput).toBe('weight')
  })
})

describe('computeBmr / computeEnergyNeed', () => {
  it('applies the documented Mifflin-St Jeor equation per sex', () => {
    expect(computeBmr({ sex: 'male', age: 30, heightCm: 180, weightKg: 80 }).value).toBe(1780)
    expect(computeBmr({ sex: 'female', age: 30, heightCm: 180, weightKg: 80 }).value).toBe(1614)
  })

  it('is non-computable without height', () => {
    const result = computeBmr({ sex: 'male', age: 30, weightKg: 80 })
    expect(result.computable).toBe(false)
    expect(result.missingInputs).toContain('height')
  })

  it('labels the energy output as an estimate with a documented factor', () => {
    const need = computeEnergyNeed({ bmr: 1780, activityLevel: 'moderate' })
    expect(need.value).toBe(Math.round(1780 * 1.55))
    expect(need.formula.source).toMatch(/activité/i)
    const assumed = computeEnergyNeed({ bmr: 1780 })
    expect(assumed.assumption).toBe('activityLevel_non_renseigne_sedentaire_suppose')
    expect(assumed.confidence).toBeLessThan(0.7)
  })
})

describe('modelWeightTrend', () => {
  const irregular = [
    [0, 82], [3, 81.6], [10, 81.1], [20, 80.4], [27, 80],
  ].map(([offset, kg]) => snapshot(addDays(START, offset), kg))

  it('handles irregularly spaced measurements with a robust slope', () => {
    const trend = modelWeightTrend(irregular, addDays(START, 27))
    expect(trend.ready).toBe(true)
    expect(trend.direction).toBe('down')
    expect(trend.rateKgPerWeek).toBeLessThan(0)
    expect(trend.sampleCount).toBe(5)
    expect(trend.formula.id).toBe('weight-trend-least-squares')
  })

  it('returns a non-ready state when measurements are too few or too close', () => {
    expect(modelWeightTrend([snapshot(START, 82)], START).reason).toBe('insufficient_measurements')
    const close = [snapshot(START, 82), snapshot(addDays(START, 1), 81.8)]
    expect(modelWeightTrend(close, addDays(START, 1)).reason).toBe('insufficient_span')
  })
})

describe('modelWeightGoal', () => {
  const trend = { ready: true, latestKg: 82, startKg: 84, rateKgPerWeek: -0.4 }

  it('uses the profile target, never a hardcoded value', () => {
    const goal = modelWeightGoal({ profileContext: { targetWeightKg: 70, weightKg: 82 }, trend, tdee: 2400 })
    expect(goal.targetWeightKg).toBe(70)
    expect(goal.remainingKg).toBe(12)
    expect(goal.direction).toBe('loss')
  })

  it('bounds the modeled rate to a progressive range and labels energy as an estimate', () => {
    const aggressive = modelWeightGoal({ profileContext: { targetWeightKg: 75, weightKg: 82 }, trend: { ...trend, rateKgPerWeek: -3 }, tdee: 2400 })
    expect(aggressive.rateKgPerWeek).toBeLessThanOrEqual(PROGRESSIVE_RATE_DEFAULTS.maximumKgPerWeek)
    expect(aggressive.rateKgPerWeek).toBeGreaterThanOrEqual(PROGRESSIVE_RATE_DEFAULTS.minimumKgPerWeek)
    expect(aggressive.isEstimate).toBe(true)
    expect(aggressive.energyTargetKcal).toBeLessThan(2400)
    expect(aggressive.formula.id).toBe('energy-target-niddk')
  })

  it('returns maintenance with no energy delta when at target', () => {
    const goal = modelWeightGoal({ profileContext: { targetWeightKg: 82, weightKg: 82 }, trend: { ...trend, latestKg: 82 }, tdee: 2400 })
    expect(goal.direction).toBe('maintain')
    expect(goal.energyTargetKcal).toBe(2400)
    expect(goal.progressRatio).toBe(1)
  })

  it('is non-computable without a target weight', () => {
    const goal = modelWeightGoal({ profileContext: { weightKg: 82 }, trend, tdee: 2400 })
    expect(goal.computable).toBe(false)
    expect(goal.missingInput).toBe('targetWeightKg')
  })
})

describe('buildHealthMath', () => {
  it('returns a non-computable BMI/BMR until height is provided, and the goal once it is', () => {
    const withoutHeight = buildHealthMath({ profileContext: { sex: 'male', age: 30, weightKg: 82, targetWeightKg: 75 }, snapshots: [], targetDay: START })
    expect(withoutHeight.bmi.missingInput).toBe('height')
    expect(withoutHeight.bmr.missingInput).toBe('height')
    expect(withoutHeight.weightGoal.targetWeightKg).toBe(75)
    const withHeight = buildHealthMath({
      profileContext: { sex: 'male', age: 30, heightCm: 180, weightKg: 82, targetWeightKg: 75, activityLevel: 'light' },
      snapshots: [snapshot(START, 82), snapshot(addDays(START, 20), 82)],
      targetDay: addDays(START, 20),
    })
    expect(withHeight.bmi.computable).toBe(true)
    expect(withHeight.bmr.computable).toBe(true)
    expect(withHeight.energyNeed.computable).toBe(true)
    expect(withHeight.version).toBe('1.0.0')
  })
})
