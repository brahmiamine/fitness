import { describe, expect, it } from 'vitest'
import { buildDailyHealthSnapshot } from '../lib/dailyHealthSnapshot'

const DAY = '2026-09-18'

function baseChunk(overrides = {}) {
  return {
    records: [],
    heart: [],
    spo2: [],
    stress: [],
    sleep: [],
    sleepIntervals: [],
    workouts: [],
    weights: [],
    bloodPressure: [],
    bloodGlucose: [],
    ...overrides,
  }
}

describe('buildDailyHealthSnapshot', () => {
  it('aggregates every domain deterministically for a full day', () => {
    const dayMeta = { day: DAY, steps: 8120, calories: 1900, activeMinutes: 54, intensiveMinutes: 12, pai: 6, paiEarned: 6, distance: 6100, quality: { score: 92, level: 'high', missingDomains: [], anomalies: [] } }
    const chunk = baseChunk({
      heart: [
        { day: DAY, dateTime: 10, type: 0, value: 60 },
        { day: DAY, dateTime: 20, type: 0, value: 140 },
      ],
      records: [{ day: DAY, dateTime: 20, steps: 40 }],
      spo2: [{ day: DAY, dateTime: 10, value: 96 }],
      stress: [{ day: DAY, dateTime: 10, value: 22 }],
      sleep: [{ day: DAY, total: 420, light: 200, deep: 150, rem: 50 }],
      sleepIntervals: [{ day: DAY, start: 1, end: 2 }],
      workouts: [{ day: DAY, type: 1, duration: 1800, steps: 3000 }],
      weights: [
        { dateTime: 100, value: 82.4 },
        { dateTime: 500, value: 81.9 },
      ],
      bloodPressure: [{ dateTime: 300, systolic: 128, diastolic: 82 }],
      bloodGlucose: [{ dateTime: 300, valueMgDl: 98 }],
    })

    const snapshot = buildDailyHealthSnapshot({
      day: DAY,
      dayMeta,
      chunk,
      source: { importId: 'import-1', fileName: 'backup.nxk', importedAt: '2026-09-18T12:00:00.000Z' },
      reminders: [{ label: 'Pesée', enabled: true }, { label: 'Ancien rappel', enabled: false }],
    })

    expect(snapshot.day).toBe(DAY)
    expect(snapshot.activity).toMatchObject({ steps: 8120, calories: 1900, distanceMeters: 6100, activeMinutes: 54 })
    expect(snapshot.heart.maximum).toBe(140)
    expect(snapshot.heart.peak).toMatchObject({ value: 140, stepsAround: 40 })
    expect(snapshot.sleep.minutes).toBe(400)
    expect(snapshot.oxygen.samples).toBe(1)
    expect(snapshot.workouts).toHaveLength(1)
    expect(snapshot.weight).toMatchObject({ valueKg: 81.9 })
    expect(snapshot.bloodPressure).toMatchObject({ systolic: 128, diastolic: 82 })
    expect(snapshot.bloodGlucose).toMatchObject({ valueMgDl: 98 })
    expect(snapshot.quality.score).toBe(92)
    expect(snapshot.completeness.ratio).toBeGreaterThan(0)
    expect(snapshot.completeness.missing).not.toContain('heart')
    expect(snapshot.freshness.importedAt).toBe('2026-09-18T12:00:00.000Z')
    expect(snapshot.remindersConfigured).toEqual([{ label: 'Pesée', enabled: true }])
  })

  it('supports a partial backup: missing domains show up as missing, not as zeros pretending to be measured', () => {
    const snapshot = buildDailyHealthSnapshot({
      day: DAY,
      dayMeta: { day: DAY, steps: 500 },
      chunk: baseChunk(),
      source: { importId: 'import-2', fileName: 'partial.nxk', importedAt: '2026-09-01T00:00:00.000Z' },
    })

    expect(snapshot.activity.steps).toBe(500)
    expect(snapshot.heart.samples).toBe(0)
    expect(snapshot.weight).toBeNull()
    expect(snapshot.bloodPressure).toBeNull()
    expect(snapshot.completeness.missing).toEqual(
      expect.arrayContaining(['heart', 'spo2', 'stress', 'sleep', 'workouts', 'weights', 'bloodPressure', 'bloodGlucose']),
    )
  })

  it('exposes a compact sparse minute-level movement trace for the advisors', () => {
    const chunk = baseChunk({
      records: [
        { day: DAY, dateTime: 60 * 60 * 8 * 1000, tz: 0, steps: 20 },
        { day: DAY, dateTime: 60 * 60 * 8 * 1000 + 60_000, tz: 0, steps: 5 },
        { day: DAY, dateTime: 60 * 60 * 9 * 1000, tz: 0, steps: 0 },
      ],
    })
    const snapshot = buildDailyHealthSnapshot({ day: DAY, dayMeta: { day: DAY, steps: 25 }, chunk })
    expect(snapshot.activity.minuteSteps).toEqual([
      [480, 20],
      [481, 5],
    ])
    expect(snapshot.activity.hourlySteps[8]).toBe(25)
    expect(snapshot.activity.hasMinuteData).toBe(true)
  })

  it('never reads GPS data even if present on the chunk', () => {
    const chunk = baseChunk()
    chunk.gps = [{ day: DAY, latitude: 48.8, longitude: 2.3 }]
    const snapshot = buildDailyHealthSnapshot({
      day: DAY,
      dayMeta: { day: DAY, steps: 100 },
      chunk,
      source: { importId: 'import-3', fileName: 'x.nxk', importedAt: '2026-09-01T00:00:00.000Z' },
    })
    expect(JSON.stringify(snapshot)).not.toContain('latitude')
  })
})
