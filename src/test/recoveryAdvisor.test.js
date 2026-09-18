import { describe, expect, it } from 'vitest'
import { assessRecovery, RECOVERY_STATES } from '../lib/advisor/recoveryAdvisor'
import { assessActivity } from '../lib/advisor/activityAdvisor'

function addDays(day, offset) {
  const date = new Date(`${day}T00:00:00Z`)
  date.setUTCDate(date.getUTCDate() + offset)
  return date.toISOString().slice(0, 10)
}

function snapshot(day, { stress = 20, heart = 60, steps = 5000, quality = 95, workouts = [] } = {}) {
  return {
    day,
    activity: { steps, activeMinutes: 0, intensiveMinutes: 0, minuteSteps: [], hourlySteps: new Array(24).fill(0), hasMinuteData: false },
    heart: { average: heart, samples: 100 },
    sleep: { minutes: null, sessions: 0 },
    oxygen: { samples: 0 },
    stress: { average: stress, samples: 100 },
    workouts,
    weight: null,
    quality: { score: quality },
    freshness: { dayAgeDays: 0 },
  }
}

const START = '2026-06-01'
const targetDay = addDays(START, 10)
const calmHistory = Array.from({ length: 10 }, (_, index) => snapshot(addDays(START, index)))

const poorSleep = { status: 'SLEEP_PRIORITY', recoveryPressure: true, minutes: 300, deviation: { robustScore: -2.2 }, baseline: { median: 480 } }
const normalSleep = { status: 'NORMAL', recoveryPressure: false, minutes: 480, deviation: { robustScore: 0.1 }, baseline: { median: 480 } }

describe('assessRecovery', () => {
  it('requires recovery when several signals are unfavorable and exposes a blocker', () => {
    const target = snapshot(targetDay, { stress: 80, heart: 90 })
    const result = assessRecovery({ snapshots: [...calmHistory, target], targetDay, sleepAssessment: poorSleep })
    expect(result.state).toBe(RECOVERY_STATES.REQUIRED)
    expect(result.blockers).toHaveLength(1)
    expect(result.blockers[0].id).toBe('recovery-required')
    const ids = result.reasons.map((reason) => reason.signal)
    expect(ids).toEqual(expect.arrayContaining(['sleep', 'stress', 'heart']))
  })

  it('can override workout urgency through its blocker', () => {
    const history = Array.from({ length: 15 }, (_, index) => snapshot(addDays(START, index), { steps: 2500, workouts: index === 7 ? [{ duration: 1800 }] : [] }))
    const recovery = assessRecovery({ snapshots: [...calmHistory, snapshot(targetDay, { stress: 80, heart: 90 })], targetDay, sleepAssessment: poorSleep })
    const activity = assessActivity({ snapshots: history, targetDay: addDays(START, 14), blockers: recovery.blockers })
    expect(activity.workoutDue).toBe(true)
    expect(activity.candidates.some((item) => item.id === 'activity-workout-deferred')).toBe(true)
    expect(activity.candidates.some((item) => item.id === 'activity-workout-due')).toBe(false)
  })

  it('reports a single light signal as RECOVERY_LOW with only advice', () => {
    const target = snapshot(targetDay, { stress: 60 })
    const result = assessRecovery({ snapshots: [...calmHistory, target], targetDay, sleepAssessment: normalSleep })
    expect(result.state).toBe(RECOVERY_STATES.LOW)
    expect(result.blockers).toHaveLength(0)
    expect(result.candidates.some((item) => item.id === 'recovery-light')).toBe(true)
    expect(result.reasons[0].signal).toBe('stress')
  })

  it('recognizes a good recovery state without calling it medical clearance', () => {
    const result = assessRecovery({ snapshots: [...calmHistory, snapshot(targetDay)], targetDay, sleepAssessment: normalSleep })
    expect(result.state).toBe(RECOVERY_STATES.ACTIVE_READY)
    const candidate = result.candidates.find((item) => item.id === 'recovery-active-ready')
    expect(candidate.action).toMatch(/pas un feu vert médical/i)
  })

  it('lowers confidence and suppresses the state when data quality is poor', () => {
    const low = assessRecovery({ snapshots: [...calmHistory, snapshot(targetDay, { stress: 80, heart: 90, quality: 30 })], targetDay, sleepAssessment: poorSleep })
    const high = assessRecovery({ snapshots: [...calmHistory, snapshot(targetDay, { stress: 80, heart: 90 })], targetDay, sleepAssessment: poorSleep })
    expect(low.state).toBe(RECOVERY_STATES.NORMAL)
    expect(low.confidence).toBeLessThan(high.confidence)
  })

  it('requires recovery when poor sleep combines with a high recent load', () => {
    const activityAssessment = { highActivity: true, weekToDate: { workoutMinutes: { comparable: false } } }
    const result = assessRecovery({ snapshots: [...calmHistory, snapshot(targetDay)], targetDay, sleepAssessment: poorSleep, activityAssessment })
    expect(result.state).toBe(RECOVERY_STATES.REQUIRED)
  })
})
