import { describe, expect, it } from 'vitest'
import {
  buildComparisons,
  compareLastNDays,
  compareTodayVsYesterday,
  compareToPersonalBaseline,
  compareToWeekdayBaseline,
  compareWeekToDate,
  detectSustainedTrend,
  detectSustainedTrends,
  rankComparisons,
} from '../lib/advisor/comparisons'

function addDays(day, offset) {
  const date = new Date(`${day}T00:00:00Z`)
  date.setUTCDate(date.getUTCDate() + offset)
  return date.toISOString().slice(0, 10)
}

function snapshot(day, { steps = 0, heartAverage = null, heartSamples = 0, qualityScore = 95 } = {}) {
  return {
    day,
    activity: { steps, activeMinutes: 0, intensiveMinutes: 0 },
    heart: { average: heartAverage, samples: heartSamples },
    sleep: { minutes: null, sessions: 0 },
    oxygen: { average: null, samples: 0 },
    stress: { average: null, samples: 0 },
    workouts: [],
    weight: null,
    quality: { score: qualityScore },
  }
}

const START = '2026-06-01' // a Monday

describe('compareTodayVsYesterday', () => {
  it('compares the two most recent single days', () => {
    const snapshots = [snapshot(START, { steps: 4000 }), snapshot(addDays(START, 1), { steps: 6000 })]
    const result = compareTodayVsYesterday(snapshots, addDays(START, 1), 'steps')
    expect(result.comparable).toBe(true)
    expect(result.periodA.value).toBe(6000)
    expect(result.periodB.value).toBe(4000)
    expect(result.direction).toBe('up')
    expect(result.percentChange).toBeCloseTo(0.5)
  })

  it('is not comparable when yesterday has no data', () => {
    const snapshots = [snapshot(START, { steps: 4000 })]
    const result = compareTodayVsYesterday(snapshots, addDays(START, 5), 'steps')
    expect(result.comparable).toBe(false)
  })
})

describe('compareLastNDays', () => {
  it('compares two equal-length, non-overlapping, immediately-adjacent blocks', () => {
    const snapshots = Array.from({ length: 14 }, (_, index) => snapshot(addDays(START, index), { steps: (index + 1) * 1000 }))
    const targetDay = addDays(START, 14)
    const result = compareLastNDays(snapshots, targetDay, 'steps', 7)
    expect(result.periodA.start).toBe(addDays(START, 7))
    expect(result.periodA.end).toBe(addDays(START, 13))
    expect(result.periodB.start).toBe(addDays(START, 0))
    expect(result.periodB.end).toBe(addDays(START, 6))
    expect(result.periodA.value).toBe(77000)
    expect(result.periodB.value).toBe(28000)
    expect(result.percentChange).toBeCloseTo(1.75)
    expect(result.direction).toBe('up')
  })

  it('is not comparable with sparse history (previous block entirely missing)', () => {
    const snapshots = [snapshot(addDays(START, 10), { steps: 5000 })]
    const result = compareLastNDays(snapshots, addDays(START, 14), 'steps', 7)
    expect(result.comparable).toBe(false)
  })

  it('domain is carried from the metric registry', () => {
    const snapshots = [snapshot(START, { heartAverage: 60, heartSamples: 100 })]
    const result = compareLastNDays(snapshots, addDays(START, 1), 'heartAverage', 3)
    expect(result.domain).toBe('heart')
  })
})

describe('compareWeekToDate', () => {
  it('always compares two partial periods of identical length (never partial vs full)', () => {
    const wednesday = addDays(START, 2) // Monday + 2 = Wednesday
    const days = [START, addDays(START, 1), wednesday]
    const previousWeekDays = days.map((day) => addDays(day, -7))
    const snapshots = [
      ...days.map((day) => snapshot(day, { steps: 2000 })),
      ...previousWeekDays.map((day) => snapshot(day, { steps: 1000 })),
    ]
    const result = compareWeekToDate(snapshots, wednesday, 'steps')
    expect(result.periodA.daysRequested).toBe(3)
    expect(result.periodB.daysRequested).toBe(3)
    expect(result.periodA.start).toBe(START)
    expect(result.periodA.end).toBe(wednesday)
    expect(result.periodB.start).toBe(addDays(START, -7))
    expect(result.periodA.value).toBe(6000)
    expect(result.periodB.value).toBe(3000)
    expect(result.direction).toBe('up')
  })
})

describe('compareToPersonalBaseline / compareToWeekdayBaseline', () => {
  it('flags a value well above the rolling-7 baseline', () => {
    const snapshots = Array.from({ length: 10 }, (_, index) => snapshot(addDays(START, index), { steps: 5000 }))
    snapshots.push(snapshot(addDays(START, 10), { steps: 9000 }))
    const result = compareToPersonalBaseline(snapshots, addDays(START, 10), 'steps')
    expect(result.comparable).toBe(true)
    expect(result.direction).toBe('high')
  })

  it('is not comparable before the baseline window is ready', () => {
    const snapshots = [snapshot(START, { steps: 5000 })]
    const result = compareToPersonalBaseline(snapshots, addDays(START, 1), 'steps')
    expect(result.comparable).toBe(false)
  })

  it('compares against the same-weekday historical baseline', () => {
    const mondays = [START, addDays(START, 7), addDays(START, 14), addDays(START, 21)]
    const snapshots = mondays.map((day) => snapshot(day, { steps: 8000 }))
    const targetDay = addDays(START, 28)
    snapshots.push(snapshot(targetDay, { steps: 8100 }))
    const result = compareToWeekdayBaseline(snapshots, targetDay, 'steps')
    expect(result.comparable).toBe(true)
  })
})

describe('rankComparisons', () => {
  it('drops non-comparable entries and ranks by magnitude x confidence', () => {
    const comparisons = [
      { comparable: false },
      { comparable: true, percentChange: 0.1, confidence: 0.9 },
      { comparable: true, percentChange: 0.8, confidence: 0.9 },
      { comparable: true, percentChange: 0.5, confidence: 0.1 },
    ]
    const ranked = rankComparisons(comparisons, 2)
    expect(ranked).toHaveLength(2)
    expect(ranked[0].percentChange).toBe(0.8)
  })
})

describe('detectSustainedTrend', () => {
  it('does not call one isolated deviating day a trend', () => {
    const baselineDays = Array.from({ length: 10 }, (_, index) => snapshot(addDays(START, index), { steps: 5000 }))
    const spikeDay = snapshot(addDays(START, 10), { steps: 9000 })
    const trend = detectSustainedTrend([...baselineDays, spikeDay], addDays(START, 10), 'steps')
    expect(trend).toBeNull()
  })

  it('reports a sustained upward trend spanning several consecutive days', () => {
    const baselineDays = Array.from({ length: 10 }, (_, index) => snapshot(addDays(START, index), { steps: 5000 }))
    const highDays = [10, 11, 12].map((offset) => snapshot(addDays(START, offset), { steps: 9000 }))
    const targetDay = addDays(START, 12)
    const trend = detectSustainedTrend([...baselineDays, ...highDays], targetDay, 'steps')
    expect(trend).not.toBeNull()
    expect(trend.direction).toBe('high')
    expect(trend.duration).toBeGreaterThanOrEqual(3)
    expect(trend.period.end).toBe(targetDay)
    expect(trend.domain).toBe('activity')
  })

  it('also surfaces a sustained favorable (downward) trend, not just unfavorable ones', () => {
    const baselineDays = Array.from({ length: 10 }, (_, index) => snapshot(addDays(START, index), { steps: 8000 }))
    const lowDays = [10, 11, 12].map((offset) => snapshot(addDays(START, offset), { steps: 3000 }))
    const targetDay = addDays(START, 12)
    const trend = detectSustainedTrend([...baselineDays, ...lowDays], targetDay, 'steps')
    expect(trend).not.toBeNull()
    expect(trend.direction).toBe('low')
  })

  it('detectSustainedTrends filters out metrics with no trend', () => {
    const baselineDays = Array.from({ length: 10 }, (_, index) => snapshot(addDays(START, index), { steps: 5000 }))
    const targetDay = addDays(START, 10)
    const trends = detectSustainedTrends([...baselineDays, snapshot(targetDay, { steps: 5050 })], targetDay, ['steps'])
    expect(trends).toEqual([])
  })
})

describe('buildComparisons', () => {
  it('builds every comparison type for the requested metrics', () => {
    const snapshots = Array.from({ length: 40 }, (_, index) => snapshot(addDays(START, index), { steps: 5000 + index }))
    const targetDay = addDays(START, 40)
    const comparisons = buildComparisons(snapshots, targetDay, ['steps'])
    const types = comparisons.map((c) => c.type)
    expect(types).toEqual(
      expect.arrayContaining([
        'today_vs_yesterday',
        'last3_vs_previous3',
        'last7_vs_previous7',
        'week_to_date_vs_previous_week',
        'last28_vs_previous28',
        'current_vs_baseline_rolling7',
        'current_vs_weekday_baseline',
      ]),
    )
  })
})
