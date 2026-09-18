import { describe, expect, it } from 'vitest'
import { detectSedentaryBlocks, SEDENTARY_DEFAULTS, assessSedentary } from '../lib/advisor/sedentary'
import { GUIDANCE_LEVELS } from '../lib/advisor/guidanceLevels'

function addDays(day, offset) {
  const date = new Date(`${day}T00:00:00Z`)
  date.setUTCDate(date.getUTCDate() + offset)
  return date.toISOString().slice(0, 10)
}

function hourlyFrom(minuteSteps) {
  const hourly = new Array(24).fill(0)
  for (const [minute, steps] of minuteSteps) hourly[Math.floor(minute / 60)] += steps
  return hourly
}

function snapshot(day, { steps = 0, minuteSteps = [], quality = 95, dayAgeDays = 0 } = {}) {
  const sorted = [...minuteSteps].sort((a, b) => a[0] - b[0])
  return {
    day,
    activity: { steps, activeMinutes: 0, intensiveMinutes: 0, minuteSteps: sorted, hourlySteps: hourlyFrom(sorted), hasMinuteData: sorted.length > 0 },
    heart: { samples: 0 },
    sleep: { minutes: null, sessions: 0 },
    oxygen: { samples: 0 },
    stress: { samples: 0 },
    workouts: [],
    weight: null,
    quality: { score: quality },
    freshness: { dayAgeDays },
  }
}

const START = '2026-06-01'
// A "normal moving" day: one active minute every half hour, 8:00 -> 22:00.
const NORMAL_MINUTES = Array.from({ length: 29 }, (_, index) => [480 + index * 30, 50])

describe('detectSedentaryBlocks', () => {
  it('flags a prolonged low-movement gap between active minutes', () => {
    const result = detectSedentaryBlocks([[480, 10], [600, 10], [900, 10]], { blockMinutes: 120 })
    expect(result.hasData).toBe(true)
    expect(result.longestBlockMinutes).toBe(299)
    expect(result.blocks).toHaveLength(1)
  })

  it('ignores short gaps', () => {
    const result = detectSedentaryBlocks([[480, 10], [520, 10], [560, 10]], { blockMinutes: 120 })
    expect(result.blocks).toHaveLength(0)
  })
})

describe('assessSedentary', () => {
  const baselineDays = Array.from({ length: 7 }, (_, index) => snapshot(addDays(START, index), { steps: 5000, minuteSteps: NORMAL_MINUTES }))
  const targetDay = addDays(START, 7)

  it('generates a bounded movement commitment for a long sedentary block, citing WHO evidence', () => {
    const target = snapshot(targetDay, { steps: 3000, minuteSteps: [[480, 10], [720, 10], [1320, 10]] })
    const result = assessSedentary({ snapshots: [...baselineDays, target], targetDay })
    const block = result.candidates.find((item) => item.id === 'sedentary-break')
    expect(block).toBeTruthy()
    expect(block.level).toBe(GUIDANCE_LEVELS.COMMITMENT)
    expect(block.evidenceId).toBe('who-activity-2020')
    expect(block.sourceDay).toBe(targetDay)
    expect(block.confidence).toBeGreaterThan(0)
  })

  it('distinguishes poor distribution from low total activity without asking for a long block', () => {
    // Steps happen almost only during one afternoon hour, but no >= 120 min gap.
    const concentrated = Array.from({ length: 12 }, (_, index) => [900 + index * 2, 300])
    const target = snapshot(targetDay, { steps: 3600, minuteSteps: concentrated })
    const result = assessSedentary({ snapshots: [...baselineDays, target], targetDay })
    expect(result.poorDistribution).toBe(true)
    expect(result.candidates.some((item) => item.id === 'sedentary-distribution')).toBe(true)
    expect(result.candidates.some((item) => item.id === 'sedentary-break')).toBe(false)
  })

  it('never asks for extra movement when activity is already above the personal high range', () => {
    const target = snapshot(targetDay, { steps: 12000, minuteSteps: [[480, 10], [900, 10], [1320, 10]] })
    const result = assessSedentary({ snapshots: [...baselineDays, target], targetDay })
    expect(result.highActivity).toBe(true)
    expect(result.candidates.some((item) => item.id === 'sedentary-break')).toBe(false)
    expect(result.candidates.some((item) => item.id === 'sedentary-not-needed')).toBe(true)
  })

  it('lowers confidence and present-tense phrasing when the import is stale', () => {
    const fresh = assessSedentary({ snapshots: [...baselineDays, snapshot(targetDay, { steps: 3000, minuteSteps: [[480, 10], [900, 10]], dayAgeDays: 0 })], targetDay })
    const stale = assessSedentary({ snapshots: [...baselineDays, snapshot(targetDay, { steps: 3000, minuteSteps: [[480, 10], [900, 10]], dayAgeDays: 10 })], targetDay })
    expect(stale.confidence).toBeLessThan(fresh.confidence)
    const staleBlock = stale.candidates.find((item) => item.id === 'sedentary-break')
    expect(staleBlock.action).not.toMatch(/aujourd’hui/)
  })

  it('suppresses strong decisions when no minute-level data exists', () => {
    const target = snapshot(targetDay, { steps: 3000, minuteSteps: [] })
    const result = assessSedentary({ snapshots: [...baselineDays, target], targetDay })
    expect(result.hasData).toBe(false)
    expect(result.candidates.map((item) => item.id)).toEqual(['sedentary-insufficient'])
  })

  it('uses the documented default block threshold', () => {
    expect(SEDENTARY_DEFAULTS.blockMinutes).toBe(120)
  })
})
