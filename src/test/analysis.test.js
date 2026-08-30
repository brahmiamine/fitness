import { describe, expect, it } from 'vitest'
import { buildInsights, preferredHeartSeries, summarizeDay } from '../lib/analysis'
import { formatDuration, localDateKey } from '../lib/format'

const dataset = {
  days: [{ day: '2026-08-30', steps: 11421, calories: 752, distance: 7658, activeMinutes: 122 }],
  sleep: [
    { day: '2026-08-30', light: 117, deep: 110, rem: 55, awake: 5, total: 287 },
    { day: '2026-08-30', light: 20, deep: 0, rem: 0, awake: 0, total: 20 },
  ],
  heart: [
    { day: '2026-08-30', dateTime: 1000, tz: 7200, value: 53, type: 0 },
    { day: '2026-08-30', dateTime: 2000, tz: 7200, value: 165, type: 0 },
    { day: '2026-08-30', dateTime: 2500, tz: 7200, value: 120, type: 3 },
  ],
  spo2: [
    { day: '2026-08-30', value: 95 },
    { day: '2026-08-30', value: 99 },
  ],
  stress: [
    { day: '2026-08-30', value: 12 },
    { day: '2026-08-30', value: 48 },
  ],
  records: [
    { day: '2026-08-30', dateTime: 2000, steps: 80 },
  ],
}

describe('fitness summaries', () => {
  it('totals every sleep session without counting awake minutes', () => {
    const summary = summarizeDay(dataset, '2026-08-30')
    expect(summary.sleepMinutes).toBe(302)
    expect(summary.sleepWindow).toBe(307)
  })

  it('uses periodic heart samples instead of dense live samples', () => {
    expect(preferredHeartSeries(dataset.heart)).toHaveLength(2)
    expect(summarizeDay(dataset, '2026-08-30').heartAverage).toBe(109)
  })

  it('contextualizes a peak when steps exist nearby', () => {
    const insights = buildInsights(summarizeDay(dataset, '2026-08-30'))
    expect(insights.find((item) => item.id === 'heart-peak')?.title).toContain('mouvement')
  })
})

describe('formatting', () => {
  it('formats durations in French', () => {
    expect(formatDuration(302)).toBe('5 h 02')
  })

  it('applies the stored timezone to day keys', () => {
    expect(localDateKey(Date.UTC(2026, 7, 29, 23, 30), 7200)).toBe('2026-08-30')
  })
})
