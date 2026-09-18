import { describe, expect, it } from 'vitest'
import { assessActivity, ACTIVITY_DEFAULTS, daysSinceLastWorkout } from '../lib/advisor/activityAdvisor'
import { GUIDANCE_LEVELS } from '../lib/advisor/guidanceLevels'

function addDays(day, offset) {
  const date = new Date(`${day}T00:00:00Z`)
  date.setUTCDate(date.getUTCDate() + offset)
  return date.toISOString().slice(0, 10)
}

function snapshot(day, { steps = 5000, workouts = [], distanceMeters = null, quality = 95, dayAgeDays = 0 } = {}) {
  return {
    day,
    activity: { steps, distanceMeters, activeMinutes: 0, intensiveMinutes: 0, minuteSteps: [], hourlySteps: new Array(24).fill(0), hasMinuteData: false },
    heart: { samples: 0 },
    sleep: { minutes: null, sessions: 0 },
    oxygen: { samples: 0 },
    stress: { samples: 0 },
    workouts,
    weight: null,
    quality: { score: quality },
    freshness: { dayAgeDays },
  }
}

const START = '2026-06-01' // Monday
const baseline = Array.from({ length: 14 }, (_, index) => snapshot(addDays(START, index), { steps: 5000 }))
const targetDay = addDays(START, 14)

describe('daysSinceLastWorkout', () => {
  it('counts days since the most recent workout', () => {
    const snapshots = [snapshot(addDays(targetDay, -4), { workouts: [{ duration: 1800 }] }), snapshot(addDays(targetDay, -1), {})]
    const result = daysSinceLastWorkout(snapshots, targetDay)
    expect(result.daysSince).toBe(4)
    expect(result.lastWorkoutDay).toBe(addDays(targetDay, -4))
  })

  it('reports zero when the target day itself has a workout', () => {
    const result = daysSinceLastWorkout([snapshot(targetDay, { workouts: [{ duration: 1200 }] })], targetDay)
    expect(result.daysSince).toBe(0)
  })

  it('reports missing workout data instead of inventing a gap', () => {
    const result = daysSinceLastWorkout([snapshot(targetDay, {})], targetDay)
    expect(result.hasWorkoutData).toBe(false)
    expect(result.daysSince).toBeNull()
  })
})

describe('assessActivity', () => {
  it('compares week-to-date against the same days of the previous week and spreads the gap', () => {
    const wednesday = addDays(START, 2)
    const snapshots = [
      ...[0, 1, 2].map((offset) => snapshot(addDays(START, offset), { steps: 1000 })),
      ...[0, 1, 2].map((offset) => snapshot(addDays(START, offset - 7), { steps: 2000 })),
    ]
    const result = assessActivity({ snapshots, targetDay: wednesday })
    expect(result.weekToDate.steps.periodA.value).toBe(3000)
    expect(result.weekToDate.steps.periodB.value).toBe(6000)
    expect(result.catchUp.deficitSteps).toBe(3000)
    expect(result.catchUp.remainingDays).toBe(5)
    expect(result.catchUp.dailyTopUpSteps).toBe(600)
    expect(result.catchUp.behind).toBe(true)
  })

  it('bounds catch-up so a single day can never overcompensate', () => {
    const wednesday = addDays(START, 2)
    const snapshots = [
      ...[0, 1, 2].map((offset) => snapshot(addDays(START, offset), { steps: 0 })),
      ...[0, 1, 2].map((offset) => snapshot(addDays(START, offset - 7), { steps: 8000 })),
    ]
    const result = assessActivity({ snapshots, targetDay: wednesday })
    expect(result.catchUp.deficitSteps).toBe(24000)
    expect(result.catchUp.dailyTopUpSteps).toBe(ACTIVITY_DEFAULTS.maxDailyCatchUpSteps)
    expect(result.catchUp.bounded).toBe(true)
  })

  it('produces a personalized step commitment with a km estimate only when the distance model is ready', () => {
    const history = Array.from({ length: 12 }, (_, index) => snapshot(addDays(START, index), { steps: 5000, distanceMeters: 3500 }))
    const result = assessActivity({ snapshots: [...history, snapshot(addDays(START, 12), { steps: 4000 })], targetDay: addDays(START, 12) })
    expect(result.distance.coefficient.ready).toBe(true)
    expect(result.distance.distanceMeters).toBeCloseTo(4000 * 0.7)
    const commitment = result.candidates.find((item) => item.id === 'activity-step-goal')
    expect(commitment.level).toBe(GUIDANCE_LEVELS.COMMITMENT)
    expect(commitment.target.distanceKm).toBeCloseTo(2.8)
    expect(JSON.stringify(commitment)).not.toMatch(/gps|latitude|longitude/i)
  })

  it('keeps steps-only (no km) until the distance model has enough history', () => {
    const result = assessActivity({ snapshots: [...baseline, snapshot(targetDay, { steps: 4000 })], targetDay })
    expect(result.distance.coefficient.ready).toBe(false)
    const commitment = result.candidates.find((item) => item.id === 'activity-step-goal')
    expect(commitment.target.distanceMeters).toBeNull()
    expect(commitment.target.distanceKm).toBeNull()
  })

  it('flags an explicit no-extra-activity state after a highly active day', () => {
    const result = assessActivity({ snapshots: [...baseline, snapshot(targetDay, { steps: 12000 })], targetDay })
    expect(result.highActivity).toBe(true)
    expect(result.candidates.some((item) => item.id === 'activity-no-extra')).toBe(true)
    expect(result.candidates.some((item) => item.level === GUIDANCE_LEVELS.COMMITMENT)).toBe(false)
  })

  it('detects a workout due after several inactive days and low weekly activity', () => {
    const history = Array.from({ length: 22 }, (_, index) => snapshot(addDays(START, index), { steps: 3000 }))
    history[0] = snapshot(addDays(START, 0), { steps: 3000, workouts: [{ duration: 1800 }] })
    const snapshots = [...history, snapshot(addDays(START, 22), { steps: 2000 }), snapshot(addDays(START, 23), { steps: 1500 })]
    const result = assessActivity({ snapshots, targetDay: addDays(START, 23) })
    expect(result.daysSinceLastWorkout).toBe(23)
    expect(result.workoutDue).toBe(true)
    expect(result.candidates.some((item) => item.id === 'activity-workout-due' && item.level === GUIDANCE_LEVELS.COMMITMENT)).toBe(true)
  })

  it('defers a due workout when a recovery/safety blocker is present', () => {
    const history = Array.from({ length: 15 }, (_, index) => snapshot(addDays(START, index), { steps: 2500, workouts: index === 7 ? [{ duration: 1800 }] : [] }))
    const result = assessActivity({ snapshots: history, targetDay: addDays(START, 14), blockers: [{ id: 'recovery-required', domain: 'recovery' }] })
    expect(result.workoutDue).toBe(true)
    expect(result.candidates.some((item) => item.level === GUIDANCE_LEVELS.COMMITMENT)).toBe(false)
    expect(result.candidates.some((item) => item.id === 'activity-workout-deferred')).toBe(true)
  })

  it('does not invent a goal before a personal baseline exists', () => {
    const result = assessActivity({ snapshots: [snapshot(START, { steps: 2000 })], targetDay: START })
    const goal = result.candidates.find((item) => item.id === 'activity-step-goal')
    expect(goal).toBeUndefined()
  })
})
