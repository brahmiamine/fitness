import { describe, expect, it } from 'vitest'
import { buildDailyPlan, PLAN_STATES } from '../lib/advisor/planner'
import { GUIDANCE_LEVELS } from '../lib/advisor/guidanceLevels'

const targetSnapshot = { day: '2026-06-15', freshness: { dayAgeDays: 2, importedAt: '2026-06-17T08:00:00.000Z' } }

function candidate(overrides) {
  return {
    id: 'candidate',
    level: GUIDANCE_LEVELS.COMMITMENT,
    domain: 'activity',
    reason: 'motif',
    action: 'action',
    confidence: 0.7,
    metric: 'steps',
    target: null,
    ...overrides,
  }
}

function assessments(overrides = {}) {
  return {
    recovery: { state: 'ACTIVE_READY', confidence: 0.8, candidates: [candidate({ id: 'recovery-active-ready', level: GUIDANCE_LEVELS.INFO, domain: 'recovery', action: null })] },
    sleep: { status: 'NORMAL', confidence: 0.8, candidates: [candidate({ id: 'sleep-ok', level: GUIDANCE_LEVELS.INFO, domain: 'sleep', action: null })] },
    activity: { workoutDue: false, stepGoal: { value: 6500 }, confidence: 0.7, candidates: [candidate({ id: 'activity-step-goal', action: 'Atteindre environ 6 500 pas.' })] },
    sedentary: { longestBlockMinutes: 30, poorDistribution: false, confidence: 0.6, candidates: [candidate({ id: 'sedentary-ok', level: GUIDANCE_LEVELS.INFO, domain: 'activity', action: null })] },
    safety: { candidates: [] },
    ...overrides,
  }
}

describe('buildDailyPlan', () => {
  it('returns a normal state with distinct priority actions and advice', () => {
    const plan = buildDailyPlan({ assessments: assessments(), comparisons: [], targetSnapshot })
    expect(plan.today.state.code).toBe(PLAN_STATES.NORMAL)
    expect(plan.today.commitments).toHaveLength(1)
    expect(plan.today.advice).toBeDefined()
    expect(plan.today.commitments).not.toBe(plan.today.advice)
  })

  it('exposes freshness on today and tomorrow and a conditional tomorrow', () => {
    const plan = buildDailyPlan({ assessments: assessments(), comparisons: [], targetSnapshot })
    expect(plan.today.freshness.dayAgeDays).toBe(2)
    expect(plan.tomorrow.freshness.dayAgeDays).toBe(2)
    expect(plan.tomorrow.state.conditional).toBe(true)
    expect(plan.tomorrow.conditions.length).toBeGreaterThan(0)
    expect(plan.tomorrow.branches.ifMet).toBeDefined()
    expect(plan.tomorrow.branches.else).toBeDefined()
    expect(plan.tomorrow.date).toBe('2026-06-16')
  })

  it('prioritizes sleep and conditions tomorrow on sleep recovery', () => {
    const plan = buildDailyPlan({
      assessments: assessments({
        sleep: { status: 'SLEEP_PRIORITY', confidence: 0.8, candidates: [candidate({ id: 'sleep-priority', domain: 'sleep', action: 'Prioriser le sommeil.' })] },
        recovery: { state: 'NORMAL', confidence: 0.7, candidates: [] },
      }),
      comparisons: [],
      targetSnapshot,
    })
    expect(plan.today.state.code).toBe(PLAN_STATES.SLEEP_PRIORITY)
    expect(plan.tomorrow.conditions.map((condition) => condition.id)).toContain('sleep-recovers')
    expect(plan.tomorrow.branches.else.intent).toBe('RECOVERY_LIGHT')
  })

  it('prioritizes movement when a long sedentary block is detected', () => {
    const plan = buildDailyPlan({
      assessments: assessments({ sedentary: { longestBlockMinutes: 200, poorDistribution: false, confidence: 0.7, candidates: [] } }),
      comparisons: [],
      targetSnapshot,
    })
    expect(plan.today.state.code).toBe(PLAN_STATES.MOVEMENT_PRIORITY)
  })

  it('prioritizes recovery over activity', () => {
    const plan = buildDailyPlan({
      assessments: assessments({
        recovery: { state: 'RECOVERY_REQUIRED', confidence: 0.8, candidates: [candidate({ id: 'recovery-priority', domain: 'recovery', action: 'Privilégier la récupération.' })] },
        activity: { workoutDue: true, stepGoal: { value: 6500 }, confidence: 0.7, candidates: [candidate({ id: 'activity-workout-due', action: 'Prévoir une séance.' })] },
      }),
      comparisons: [],
      targetSnapshot,
    })
    expect(plan.today.state.code).toBe(PLAN_STATES.RECOVERY_REQUIRED)
    expect(plan.today.commitments.map((item) => item.id)).toContain('recovery-priority')
  })

  it('escalates safety states and makes tomorrow depend on the recheck', () => {
    const recheck = buildDailyPlan({
      assessments: assessments({ safety: { candidates: [candidate({ id: 'safety-spo2-recheck', level: GUIDANCE_LEVELS.RECHECK, domain: 'oxygen', action: 'Recontrôler la SpO₂.' })] } }),
      comparisons: [],
      targetSnapshot,
    })
    expect(recheck.today.state.code).toBe(PLAN_STATES.SAFETY_RECHECK)
    expect(recheck.tomorrow.conditions.map((condition) => condition.id)).toContain('recheck-stable')

    const urgent = buildDailyPlan({
      assessments: assessments({ safety: { candidates: [candidate({ id: 'safety-bp-medical', level: GUIDANCE_LEVELS.SEEK_MEDICAL_ADVICE, domain: 'bloodPressure', action: 'Demander un avis.' })] } }),
      comparisons: [],
      targetSnapshot,
    })
    expect(urgent.today.state.code).toBe(PLAN_STATES.SEEK_MEDICAL_ADVICE)
    expect(urgent.today.commitments[0].priorityClass).toBe('safety')
  })

  it('ranks comparisons for the "what changed" section', () => {
    const comparison = { metricKey: 'steps', type: 'week_to_date_vs_previous_week', comparable: true, confidence: 0.9, percentChange: -0.4, direction: 'down', periodA: { start: '2026-06-09', end: '2026-06-15', value: 6000 }, periodB: { value: 10000 } }
    const plan = buildDailyPlan({ assessments: assessments(), comparisons: [comparison], targetSnapshot })
    expect(plan.today.comparisons[0].label).toBe('Pas')
    expect(plan.today.comparisons[0].direction).toBe('down')
  })
})
