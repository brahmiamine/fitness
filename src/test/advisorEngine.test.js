import { describe, expect, it } from 'vitest'
import { buildAdvisorResult } from '../lib/advisor/engine'
import { addDays, buildTimeline } from './advisorFixtures'

const START = '2026-06-01'
const PROFILE = { sex: 'male', age: 34, heightCm: 180, weightKg: 82, targetWeightKg: 75, activityLevel: 'light' }
const PROFILE_NO_GOAL = { sex: 'male', age: 34, heightCm: 180, weightKg: 82, activityLevel: 'light' }

function normalTimeline(days = 30) {
  return buildTimeline(START, days, (index) => ({ steps: index === days - 1 ? 5000 : 6000 }))
}

describe('buildAdvisorResult', () => {
  it('composes every engine and returns a coherent plan', () => {
    const snapshots = normalTimeline()
    const targetDay = snapshots.at(-1).day
    const result = buildAdvisorResult({ snapshots, targetDay, profileContext: PROFILE, generatedAt: '2026-06-30T12:00:00.000Z' })

    expect(result.plan.today.commitments.length).toBeLessThanOrEqual(3)
    expect(result.plan.today.state.code).toBeTruthy()
    expect(result.plan.tomorrow.conditions.length).toBeGreaterThan(0)
    expect(result.advice.items.length).toBeGreaterThan(0)
    expect(result.healthMath.bmi.computable).toBe(true)
    expect(result.healthMath.weightGoal.computable).toBe(true)
    expect(result.assessments.recovery.state).toBeTruthy()
  })

  it('is deterministic for identical input', () => {
    const snapshots = normalTimeline()
    const targetDay = snapshots.at(-1).day
    const first = buildAdvisorResult({ snapshots, targetDay, profileContext: PROFILE, generatedAt: 'fixed' })
    const second = buildAdvisorResult({ snapshots, targetDay, profileContext: PROFILE, generatedAt: 'fixed' })
    expect(JSON.stringify(first.plan)).toBe(JSON.stringify(second.plan))
    expect(JSON.stringify(first.rollingPlan)).toBe(JSON.stringify(second.rollingPlan))
  })

  it('defers demanding activity when recovery blocks it', () => {
    const snapshots = buildTimeline(START, 30, (index) => {
      if (index >= 28) return { sleepMinutes: 280, stress: 100, heart: 120, steps: 2500 }
      if (index >= 25) return { sleepMinutes: 280, stress: 20, heart: 60, steps: 3000 }
      return { sleepMinutes: 480, stress: 20, heart: 60, steps: 4000 }
    })
    const targetDay = snapshots.at(-1).day
    const result = buildAdvisorResult({ snapshots, targetDay, profileContext: PROFILE })
    expect(result.assessments.recovery.state).toBe('RECOVERY_REQUIRED')
    expect(result.assessments.activity.blocked).toBe(true)
    expect(result.plan.today.state.code).toBe('RECOVERY_REQUIRED')
  })

  it('keeps BMI/BMR non-computable without height and never guesses it', () => {
    const snapshots = normalTimeline()
    const result = buildAdvisorResult({ snapshots, targetDay: snapshots.at(-1).day, profileContext: { sex: 'male', age: 34, weightKg: 82 } })
    expect(result.healthMath.bmi.missingInput).toBe('height')
    expect(result.healthMath.bmr.missingInput).toBe('height')
  })

  it('does not read GPS anywhere in its output', () => {
    const snapshots = normalTimeline()
    const result = buildAdvisorResult({ snapshots, targetDay: snapshots.at(-1).day, profileContext: PROFILE })
    expect(JSON.stringify(result.plan)).not.toMatch(/latitude|longitude|gpsprivate/i)
  })

  it('recomputes and removes the rolling plan as new data arrives', () => {
    const debt = buildTimeline(START, 30, (index) => ({ sleepMinutes: index >= 27 ? 280 : 480 }))
    const debtResult = buildAdvisorResult({ snapshots: debt, targetDay: addDays(START, 29), profileContext: PROFILE_NO_GOAL })
    const recovered = buildTimeline(START, 30, () => ({ sleepMinutes: 480 }))
    const recoveredResult = buildAdvisorResult({ snapshots: recovered, targetDay: addDays(START, 29), profileContext: PROFILE_NO_GOAL })
    expect(debtResult.rollingPlan.active).toBe(true)
    expect(recoveredResult.rollingPlan.active).toBe(false)
    expect(JSON.stringify(debtResult.rollingPlan)).not.toBe(JSON.stringify(recoveredResult.rollingPlan))
  })
})
