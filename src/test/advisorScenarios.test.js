import { describe, expect, it } from 'vitest'
import { buildAdvisorResult } from '../lib/advisor/engine'
import { assessActivity } from '../lib/advisor/activityAdvisor'
import { assessSedentary } from '../lib/advisor/sedentary'
import { assessSleep } from '../lib/advisor/sleepAdvisor'
import { assessSafety } from '../lib/advisor/safetyAdvisor'
import { modelWeightGoal } from '../lib/advisor/healthMath'
import { GUIDANCE_LEVELS } from '../lib/advisor/guidanceLevels'
import { buildDailyHealthSnapshot } from '../lib/dailyHealthSnapshot'
import { pickFreshestImport } from '../lib/healthTimeline'
import { addDays, buildTimeline, daySnapshot } from './advisorFixtures'

const START = '2026-06-01'
const PROFILE = { sex: 'male', age: 34, heightCm: 180, weightKg: 82, targetWeightKg: 75, activityLevel: 'light' }
const NO_GOAL = { sex: 'male', age: 34, heightCm: 180, weightKg: 82, activityLevel: 'light' }

function last(snapshots) {
  return snapshots.at(-1).day
}

describe('#28 advisor scenarios', () => {
  it('1. a normal week produces no unnecessary commitments', () => {
    const snapshots = buildTimeline(START, 30, () => ({ steps: 6000 }))
    const result = buildAdvisorResult({ snapshots, targetDay: last(snapshots), profileContext: NO_GOAL })
    expect(result.plan.today.commitments).toEqual([])
    expect(result.plan.today.state.code).toBe('NORMAL')
  })

  it('2. one short night yields bounded sleep advice, not a commitment', () => {
    const baseline = buildTimeline(START, 20, () => ({ sleepMinutes: 480 }))
    const target = daySnapshot(addDays(START, 20), { sleepMinutes: 300 })
    const sleep = assessSleep({ snapshots: [...baseline, target], targetDay: addDays(START, 20) })
    expect(sleep.status).toBe('SHORT_NIGHT')
    expect(sleep.candidates.some((c) => c.id === 'sleep-tonight' && c.level === GUIDANCE_LEVELS.ADVICE)).toBe(true)
    expect(sleep.candidates.some((c) => c.level === GUIDANCE_LEVELS.COMMITMENT)).toBe(false)
  })

  it('3. three short nights escalate to sleep priority and a rolling plan', () => {
    const snapshots = buildTimeline(START, 30, (index) => ({ steps: index >= 27 ? 5000 : 6000, sleepMinutes: index >= 27 ? 280 : 480 }))
    const result = buildAdvisorResult({ snapshots, targetDay: last(snapshots), profileContext: NO_GOAL })
    expect(result.plan.today.state.code).toBe('SLEEP_PRIORITY')
    expect(result.plan.today.commitments.some((c) => c.id === 'sleep-priority')).toBe(true)
    expect(result.rollingPlan.active).toBe(true)
    expect(result.rollingPlan.objective).toBe('sleep')
  })

  it('4. good sleep with a long sedentary block becomes movement priority', () => {
    const snapshots = buildTimeline(START, 30, (index) => (index === 29
      ? { sleepMinutes: 480, steps: 3000, minuteSteps: [[480, 10], [900, 10], [1400, 10]] }
      : { sleepMinutes: 480, steps: 5000 }))
    const result = buildAdvisorResult({ snapshots, targetDay: last(snapshots), profileContext: NO_GOAL })
    expect(result.plan.today.state.code).toBe('MOVEMENT_PRIORITY')
  })

  it('5. several days without a workout and a low weekly activity flag a workout due', () => {
    const snapshots = buildTimeline(START, 30, (index) => ({
      steps: index >= 28 ? 1000 : index === 21 || index === 22 ? 3000 : 2000,
      workouts: index === 0 ? [{ duration: 1800, type: 1, steps: 3000, heartAverage: 120, title: '' }] : [],
    }))
    const result = buildAdvisorResult({ snapshots, targetDay: last(snapshots), profileContext: NO_GOAL })
    expect(result.assessments.activity.daysSinceLastWorkout).toBe(29)
    expect(result.assessments.activity.workoutDue).toBe(true)
    expect(result.assessments.activity.lowWeeklyActivity).toBe(true)
  })

  it('6. a due workout is deferred when recovery is poor', () => {
    const snapshots = buildTimeline(START, 30, (index) => {
      if (index >= 28) return { steps: 1000, sleepMinutes: 280, stress: 100, heart: 120, workouts: [] }
      return { steps: index === 21 || index === 22 ? 3000 : 2000, workouts: index === 0 ? [{ duration: 1800, type: 1 }] : [] }
    })
    const result = buildAdvisorResult({ snapshots, targetDay: last(snapshots), profileContext: NO_GOAL })
    expect(result.assessments.recovery.state).toBe('RECOVERY_REQUIRED')
    expect(result.assessments.activity.workoutDue).toBe(true)
    expect(result.assessments.activity.blocked).toBe(true)
    expect(result.assessments.activity.candidates.some((c) => c.id === 'activity-workout-deferred')).toBe(true)
  })

  it('7. prolonged low-movement blocks generate sedentary movement advice', () => {
    const baseline = buildTimeline(START, 10, () => ({ steps: 5000 }))
    const target = daySnapshot(addDays(START, 10), { steps: 3000, minuteSteps: [[480, 10], [700, 10], [1400, 10]] })
    const result = assessSedentary({ snapshots: [...baseline, target], targetDay: addDays(START, 10) })
    expect(result.longestBlockMinutes).toBeGreaterThanOrEqual(120)
    expect(result.candidates.some((c) => c.id === 'sedentary-break')).toBe(true)
  })

  it('8. a very active day never forces extra steps', () => {
    const snapshots = buildTimeline(START, 30, (index) => ({ steps: index === 29 ? 14000 : 6000 }))
    const result = buildAdvisorResult({ snapshots, targetDay: last(snapshots), profileContext: NO_GOAL })
    expect(result.assessments.activity.highActivity).toBe(true)
    expect(result.plan.today.commitments.some((c) => c.metric === 'steps')).toBe(false)
    expect(result.assessments.activity.candidates.some((c) => c.id === 'activity-no-extra')).toBe(true)
  })

  it('9. week-to-date below the same days last week is compared correctly and bounded', () => {
    const wednesday = addDays(START, 2)
    const snapshots = [
      ...[0, 1, 2].map((offset) => daySnapshot(addDays(START, offset), { steps: 1000 })),
      ...[0, 1, 2].map((offset) => daySnapshot(addDays(START, offset - 7), { steps: 2000 })),
    ]
    const result = assessActivity({ snapshots, targetDay: wednesday })
    expect(result.weekToDate.steps.periodA.value).toBe(3000)
    expect(result.weekToDate.steps.periodB.value).toBe(6000)
    expect(result.catchUp.dailyTopUpSteps).toBeLessThanOrEqual(2000)
  })

  it('10/11. the distance estimator adds km when ready and stays steps-only otherwise', () => {
    const history = Array.from({ length: 12 }, (_, index) => daySnapshot(addDays(START, index), { steps: 5000, distanceMeters: 3500 }))
    const ready = assessActivity({ snapshots: [...history, daySnapshot(addDays(START, 12), { steps: 4000, distanceMeters: 2800 })], targetDay: addDays(START, 12) })
    expect(ready.distance.coefficient.ready).toBe(true)
    expect(ready.candidates.find((c) => c.id === 'activity-step-goal').target.distanceKm).toBeCloseTo(2.8)

    const notReady = assessActivity({ snapshots: [...buildTimeline(START, 12, () => ({ steps: 5000, distanceMeters: null })), daySnapshot(addDays(START, 12), { steps: 4000 })], targetDay: addDays(START, 12) })
    expect(notReady.distance.coefficient.ready).toBe(false)
    expect(notReady.candidates.find((c) => c.id === 'activity-step-goal').target.distanceKm).toBeNull()
  })

  it('12/13. SpO2 distinguishes a single value from repeated context without any diagnosis', () => {
    const single = assessSafety({ snapshots: [daySnapshot(addDays(START, 1), { spo2: 91, spo2Samples: 20 })], targetDay: addDays(START, 1) })
    expect(single.candidates.find((c) => c.domain === 'oxygen').level).toBe(GUIDANCE_LEVELS.RECHECK)
    const repeated = assessSafety({
      snapshots: [daySnapshot(START, { spo2: 90 }), daySnapshot(addDays(START, 1), { spo2: 91 })],
      targetDay: addDays(START, 1),
    })
    expect(repeated.candidates.find((c) => c.domain === 'oxygen').level).toBe(GUIDANCE_LEVELS.MONITOR)
    for (const candidate of repeated.candidates) {
      expect(`${candidate.reason} ${candidate.action}`).not.toMatch(/diagnosti|dose|insuline|traitement/i)
    }
  })

  it('14. poor data quality suppresses strong decisions', () => {
    const snapshots = buildTimeline(START, 30, (index) => (index >= 27 ? { sleepMinutes: 280, quality: index === 29 ? 30 : 95 } : { sleepMinutes: 480 }))
    const result = buildAdvisorResult({ snapshots, targetDay: last(snapshots), profileContext: NO_GOAL })
    expect(result.assessments.sleep.status).toBe('LOW_QUALITY')
    expect(result.assessments.recovery.state).toBe('NORMAL')
    expect(result.plan.today.commitments.some((c) => c.id === 'sleep-priority')).toBe(false)
  })

  it('15. a partial backup degrades gracefully instead of failing', () => {
    const partial = buildDailyHealthSnapshot({
      day: START,
      dayMeta: { day: START, steps: 4000 },
      chunk: { records: [], heart: [], spo2: [], stress: [], sleep: [], sleepIntervals: [], workouts: [], weights: [], bloodPressure: [], bloodGlucose: [] },
      source: { importId: 'partial', fileName: 'partial.nxk', importedAt: '2026-06-02T00:00:00.000Z' },
    })
    expect(partial.completeness.missing.length).toBeGreaterThan(0)
    const snapshots = buildTimeline(START, 12, () => ({ sleepMinutes: 480, heartSamples: 0, stressSamples: 0, spo2Samples: 0 }))
    snapshots.push(partial)
    const result = buildAdvisorResult({ snapshots, targetDay: START, profileContext: NO_GOAL })
    expect(result.plan.today.state.code).toBeTruthy()
    expect(result.plan.today.confidence === null || result.plan.today.confidence >= 0).toBe(true)
  })

  it('16. duplicate days resolve to the freshest backup provenance', () => {
    const freshest = pickFreshestImport([
      { id: 'old', importedAt: '2026-06-01T00:00:00.000Z' },
      { id: 'new', importedAt: '2026-06-10T00:00:00.000Z' },
    ])
    expect(freshest.id).toBe('new')
  })

  it('17. missing height keeps BMI/BMR unavailable and never guesses', () => {
    const snapshots = buildTimeline(START, 30, () => ({}))
    const result = buildAdvisorResult({ snapshots, targetDay: last(snapshots), profileContext: { sex: 'male', age: 34, weightKg: 82 } })
    expect(result.healthMath.bmi.computable).toBe(false)
    expect(result.healthMath.bmi.missingInput).toBe('height')
    expect(result.healthMath.bmr.computable).toBe(false)
  })

  it('18. the 82 kg to 75 kg goal comes from the profile, not the algorithm', () => {
    const trend = { ready: true, latestKg: 82, startKg: 82, rateKgPerWeek: -0.4 }
    const goal = modelWeightGoal({ profileContext: PROFILE, trend, tdee: 2400 })
    expect(goal.targetWeightKg).toBe(75)
    const other = modelWeightGoal({ profileContext: { ...PROFILE, targetWeightKg: 70 }, trend, tdee: 2400 })
    expect(other.targetWeightKg).toBe(70)
  })

  it('19. a resolved trend removes the rolling plan', () => {
    const debt = buildTimeline(START, 30, (index) => ({ sleepMinutes: index >= 27 ? 280 : 480 }))
    const active = buildAdvisorResult({ snapshots: debt, targetDay: addDays(START, 29), profileContext: NO_GOAL })
    const recovered = buildTimeline(START, 30, () => ({ sleepMinutes: 480 }))
    const resolved = buildAdvisorResult({ snapshots: recovered, targetDay: addDays(START, 29), profileContext: NO_GOAL })
    expect(active.rollingPlan.active).toBe(true)
    expect(resolved.rollingPlan.active).toBe(false)
    expect(resolved.rollingPlan.days).toEqual([])
  })

  it('20. identical input produces a stable semantic output', () => {
    const snapshots = buildTimeline(START, 30, () => ({}))
    const targetDay = last(snapshots)
    const first = buildAdvisorResult({ snapshots, targetDay, profileContext: PROFILE, generatedAt: 'fixed' })
    const second = buildAdvisorResult({ snapshots, targetDay, profileContext: PROFILE, generatedAt: 'fixed' })
    expect(JSON.stringify(first.plan.today)).toBe(JSON.stringify(second.plan.today))
    expect(JSON.stringify(first.rollingPlan)).toBe(JSON.stringify(second.rollingPlan))
    expect(JSON.stringify(first.advice)).toBe(JSON.stringify(second.advice))
  })
})
