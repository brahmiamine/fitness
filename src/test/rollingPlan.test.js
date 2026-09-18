import { describe, expect, it } from 'vitest'
import { buildRollingPlan, detectPlanObjective, ROLLING_PLAN_DEFAULTS } from '../lib/advisor/rollingPlan'

const targetDay = '2026-06-15'

function normalAssessments(overrides = {}) {
  return {
    sleep: { status: 'NORMAL', consecutiveShortNights: 0, confidence: 0.8 },
    activity: { workoutDue: false, currentSteps: 6000, stepGoal: { base: 6000, value: 6000 }, confidence: 0.7 },
    recovery: { state: 'NORMAL', confidence: 0.8 },
    safety: { candidates: [] },
    ...overrides,
  }
}

describe('detectPlanObjective', () => {
  it('returns no objective when nothing is sustained', () => {
    expect(detectPlanObjective({ assessments: normalAssessments(), trends: [] })).toBeNull()
  })

  it('blocks any plan when a safety decision is active', () => {
    const objective = detectPlanObjective({ assessments: normalAssessments({ safety: { candidates: [{ id: 'x' }] } }), trends: [] })
    expect(objective.key).toBe('safety')
    expect(objective.blocked).toBe(true)
  })
})

describe('buildRollingPlan', () => {
  it('does not generate a plan without a sustained trend', () => {
    const plan = buildRollingPlan({ snapshots: [], targetDay, assessments: normalAssessments(), options: { trends: [] } })
    expect(plan.active).toBe(false)
    expect(plan.days).toEqual([])
  })

  it('suppresses an activity plan when safety is active', () => {
    const plan = buildRollingPlan({ snapshots: [], targetDay, assessments: normalAssessments({ safety: { candidates: [{ id: 'safety-spo2-recheck' }] } }), options: { trends: [] } })
    expect(plan.active).toBe(false)
    expect(plan.blockedBySafety).toBe(true)
  })

  it('builds a gradual sleep-recovery plan for repeated short nights', () => {
    const plan = buildRollingPlan({
      snapshots: [],
      targetDay,
      assessments: normalAssessments({
        sleep: { status: 'SLEEP_PRIORITY', consecutiveShortNights: 3, confidence: 0.7, baseline: { median: 480 }, targetBedtime: { bedtimeMinute: 1380, targetMinute: 1320 } },
      }),
      options: { trends: [] },
    })
    expect(plan.active).toBe(true)
    expect(plan.objective).toBe('sleep')
    expect(plan.days.length).toBeGreaterThanOrEqual(ROLLING_PLAN_DEFAULTS.minimumDays)
    expect(plan.days.length).toBeLessThanOrEqual(ROLLING_PLAN_DEFAULTS.maximumDays)
    expect(plan.days[0].relativeDay).toBe('demain')
    expect(plan.days[0].targets.bedtimeMinute).toBe(1365)
    expect(plan.days[1].targets.bedtimeMinute).toBe(1350)
  })

  it('ramps activity progressively and never compensates above the personal level', () => {
    const plan = buildRollingPlan({
      snapshots: [],
      targetDay,
      assessments: normalAssessments({ activity: { workoutDue: false, currentSteps: 3000, stepGoal: { base: 6000, value: 6000 }, confidence: 0.7 } }),
      options: { trends: [{ metricKey: 'steps', direction: 'low', duration: 4, confidence: 0.6 }] },
    })
    expect(plan.active).toBe(true)
    expect(plan.objective).toBe('activity')
    const steps = plan.days.map((day) => day.targets.steps)
    expect(steps.length).toBe(7)
    expect(steps[0]).toBeLessThan(steps.at(-1))
    expect(Math.max(...steps)).toBeLessThanOrEqual(6000)
  })

  it('builds a progressive workout-return plan', () => {
    const plan = buildRollingPlan({
      snapshots: [],
      targetDay,
      assessments: normalAssessments({ activity: { workoutDue: true, currentSteps: 2000, stepGoal: { base: 6000, value: 6000 }, confidence: 0.6 } }),
      options: { trends: [] },
    })
    expect(plan.objective).toBe('workout')
    expect(plan.days.map((day) => day.intent)).toEqual(['LIGHT_ACTIVITY', 'REST_OR_WALK', 'MODERATE_SESSION', 'REASSESS'])
  })

  it('builds a recovery plan when recovery is required', () => {
    const plan = buildRollingPlan({
      snapshots: [],
      targetDay,
      assessments: normalAssessments({ recovery: { state: 'RECOVERY_REQUIRED', confidence: 0.8 } }),
      options: { trends: [] },
    })
    expect(plan.objective).toBe('recovery')
    expect(plan.days[0].intent).toBe('RECOVERY')
  })

  it('uses the profile-based weight goal when its math inputs are available', () => {
    const plan = buildRollingPlan({
      snapshots: [],
      targetDay,
      assessments: normalAssessments(),
      healthMath: { weightGoal: { computable: true, direction: 'loss', rateKgPerWeek: 0.5, energyTargetKcal: 1900 } },
      options: { trends: [] },
    })
    expect(plan.objective).toBe('weight')
    expect(plan.days).toHaveLength(7)
    expect(plan.days[0].targets.energyKcal).toBe(1900)
  })

  it('updates the plan when new data arrives and removes it when the trend resolves', () => {
    const low = buildRollingPlan({ snapshots: [], targetDay, assessments: normalAssessments({ activity: { workoutDue: false, currentSteps: 3000, stepGoal: { base: 6000, value: 6000 }, confidence: 0.7 } }), options: { trends: [{ metricKey: 'steps', direction: 'low', duration: 4 }] } })
    const changed = buildRollingPlan({ snapshots: [], targetDay, assessments: normalAssessments({ activity: { workoutDue: false, currentSteps: 5000, stepGoal: { base: 6000, value: 6000 }, confidence: 0.7 } }), options: { trends: [{ metricKey: 'steps', direction: 'low', duration: 4 }] } })
    expect(changed.days[0].targets.steps).toBeGreaterThan(low.days[0].targets.steps)
    const resolved = buildRollingPlan({ snapshots: [], targetDay, assessments: normalAssessments(), options: { trends: [] } })
    expect(resolved.active).toBe(false)
    expect(resolved.days).toEqual([])
  })
})
