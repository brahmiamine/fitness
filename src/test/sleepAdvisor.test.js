import { describe, expect, it } from 'vitest'
import { assessSleep } from '../lib/advisor/sleepAdvisor'
import { GUIDANCE_LEVELS } from '../lib/advisor/guidanceLevels'

function addDays(day, offset) {
  const date = new Date(`${day}T00:00:00Z`)
  date.setUTCDate(date.getUTCDate() + offset)
  return date.toISOString().slice(0, 10)
}

function snapshot(day, { minutes = 480, bedtimeMinutes = 1380, wakeMinutes = 420, sessions = 1, quality = 95, dayAgeDays = 0 } = {}) {
  return {
    day,
    activity: { steps: 5000, activeMinutes: 0, intensiveMinutes: 0 },
    heart: { samples: 0 },
    sleep: { minutes, sessions, bedtimeMinutes, wakeMinutes, window: minutes, hrAverage: 58, spo2Average: 97 },
    oxygen: { samples: 0 },
    stress: { samples: 0 },
    workouts: [],
    weight: null,
    quality: { score: quality },
    freshness: { dayAgeDays },
  }
}

const START = '2026-06-01'
const baseline = Array.from({ length: 14 }, (_, index) => snapshot(addDays(START, index), { minutes: 480 }))
const targetDay = addDays(START, 14)

describe('assessSleep', () => {
  it('produces no correction for a normal night', () => {
    const result = assessSleep({ snapshots: [...baseline, snapshot(targetDay, { minutes: 470 })], targetDay })
    expect(result.status).toBe('NORMAL')
    expect(result.consecutiveShortNights).toBe(0)
    expect(result.candidates.map((item) => item.id)).toEqual(['sleep-ok'])
  })

  it('turns one short night into bounded advice, not a commitment', () => {
    const result = assessSleep({ snapshots: [...baseline, snapshot(targetDay, { minutes: 300 })], targetDay })
    expect(result.status).toBe('SHORT_NIGHT')
    expect(result.consecutiveShortNights).toBe(1)
    const advice = result.candidates.find((item) => item.id === 'sleep-tonight')
    expect(advice.level).toBe(GUIDANCE_LEVELS.ADVICE)
    expect(result.candidates.some((item) => item.level === GUIDANCE_LEVELS.COMMITMENT)).toBe(false)
  })

  it('escalates three consecutive short nights to a sleep-priority commitment and recovery pressure', () => {
    const shortDays = [0, 1, 2].map((offset) => snapshot(addDays(START, 14 + offset), { minutes: 300 }))
    const result = assessSleep({ snapshots: [...baseline, ...shortDays], targetDay: addDays(START, 16) })
    expect(result.status).toBe('SLEEP_PRIORITY')
    expect(result.consecutiveShortNights).toBe(3)
    expect(result.recoveryPressure).toBe(true)
    const priority = result.candidates.find((item) => item.id === 'sleep-priority')
    expect(priority.level).toBe(GUIDANCE_LEVELS.COMMITMENT)
    expect(priority.evidenceId).toBe('inserm-sleep-duration')
    expect(priority.period.start).toBe(addDays(START, 14))
  })

  it('exposes an explainable target bedtime from wake time and personal duration', () => {
    const result = assessSleep({ snapshots: [...baseline, snapshot(targetDay, { minutes: 480, wakeMinutes: 420 })], targetDay })
    expect(result.targetBedtime.wakeMinute).toBe(420)
    expect(result.targetBedtime.desiredMinutes).toBe(480)
    expect(result.targetBedtime.targetMinute).toBe(420 - 480 + 1440)
    expect(result.targetBedtime.basis.source).toBe('personal_baseline')
  })

  it('detects a late-bedtime drift', () => {
    const older = [4, 5, 6].map((offset) => snapshot(addDays(START, offset), { minutes: 480, bedtimeMinutes: 1350 }))
    const recentBaseline = [0, 1, 2].map((offset) => snapshot(addDays(START, 12 + offset), { minutes: 480, bedtimeMinutes: 1350 }))
    const late = [0, 1, 2].map((offset) => snapshot(addDays(START, 15 + offset), { minutes: 480, bedtimeMinutes: 1410 }))
    const result = assessSleep({ snapshots: [...older, ...recentBaseline, ...late], targetDay: addDays(START, 17) })
    expect(result.bedtimeDriftMinutes).toBe(60)
    expect(result.candidates.some((item) => item.id === 'sleep-wind-down')).toBe(true)
  })

  it('flags irregular bedtimes', () => {
    const bedtimes = [100, 300, 500, 700, 900, 1100, 1300]
    const history = bedtimes.map((bedtimeMinutes, index) => snapshot(addDays(targetDay, -index), { minutes: 480, bedtimeMinutes }))
    const result = assessSleep({ snapshots: [...baseline, ...history], targetDay })
    expect(result.regularityMinutes).toBeGreaterThanOrEqual(60)
    expect(result.candidates.some((item) => item.id === 'sleep-regularity')).toBe(true)
  })

  it('suppresses strong advice when the day quality is low', () => {
    const shortDays = [0, 1, 2].map((offset) => snapshot(addDays(START, 14 + offset), { minutes: 300, quality: 30 }))
    const result = assessSleep({ snapshots: [...baseline, ...shortDays], targetDay: addDays(START, 16) })
    expect(result.status).toBe('LOW_QUALITY')
    expect(result.candidates.map((item) => item.id)).toEqual(['sleep-low-quality'])
    expect(result.recoveryPressure).toBe(true)
  })

  it('reports an insufficient state when no sleep was recorded', () => {
    const result = assessSleep({ snapshots: [...baseline, snapshot(targetDay, { minutes: 0, sessions: 0 })], targetDay })
    expect(result.status).toBe('INSUFFICIENT')
    expect(result.candidates.map((item) => item.id)).toEqual(['sleep-insufficient'])
  })
})
