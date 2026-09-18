import { describe, expect, it } from 'vitest'
import {
  BASELINE_METRICS,
  buildPersonalBaselines,
  computeMetricBaseline,
  deviationFromWindow,
  requireMetric,
} from '../lib/advisor/baselines'

function addDays(day, offset) {
  const date = new Date(`${day}T00:00:00Z`)
  date.setUTCDate(date.getUTCDate() + offset)
  return date.toISOString().slice(0, 10)
}

function snapshot(day, { steps = 0, heartAverage = null, heartSamples = 0, sleepMinutes = null, sleepSessions = 0, qualityScore = 90, weightKg = null, workouts = [] } = {}) {
  return {
    day,
    activity: { steps, activeMinutes: 0, intensiveMinutes: 0 },
    heart: { average: heartAverage, samples: heartSamples },
    sleep: { minutes: sleepMinutes, sessions: sleepSessions },
    oxygen: { average: null, samples: 0 },
    stress: { average: null, samples: 0 },
    workouts,
    weight: weightKg != null ? { valueKg: weightKg } : null,
    quality: { score: qualityScore },
  }
}

const START = '2026-06-01'

describe('personal baseline engine', () => {
  it('exposes a domain-agnostic API across every registered metric', () => {
    const snapshots = Array.from({ length: 10 }, (_, index) =>
      snapshot(addDays(START, index), { steps: 5000 + index * 100, heartAverage: 60, heartSamples: 100 }),
    )
    const targetDay = addDays(START, 10)
    for (const metricKey of Object.keys(BASELINE_METRICS)) {
      const baseline = computeMetricBaseline(snapshots, targetDay, metricKey)
      expect(baseline.metricKey).toBe(metricKey)
      expect(baseline.windows.rolling7).toBeDefined()
    }
  })

  it('throws on an unknown metric key', () => {
    expect(() => requireMetric('not-a-metric')).toThrow(/inconnue/i)
  })

  it('treats missing sensor samples as null, never as zero', () => {
    const snapshots = [snapshot(START, { heartAverage: null, heartSamples: 0 })]
    const baseline = computeMetricBaseline(snapshots, addDays(START, 1), 'heartAverage')
    expect(baseline.windows.rolling7.sampleCount).toBe(0)
    expect(baseline.windows.rolling7.ready).toBe(false)
  })

  it('does not call a window "ready" (personal) before its minimum sample count', () => {
    const snapshots = [snapshot(START, { steps: 4000 }), snapshot(addDays(START, 1), { steps: 5000 })]
    const targetDay = addDays(START, 2)
    const baseline = computeMetricBaseline(snapshots, targetDay, 'steps')
    expect(baseline.windows.rolling7.sampleCount).toBe(2)
    expect(baseline.windows.rolling7.ready).toBe(false)
    expect(baseline.windows.rolling3.ready).toBe(true)
  })

  it('excludes low-quality days from the baseline instead of letting them pollute it', () => {
    const snapshots = [
      snapshot(addDays(START, 0), { steps: 5000, qualityScore: 95 }),
      snapshot(addDays(START, 1), { steps: 5200, qualityScore: 92 }),
      snapshot(addDays(START, 2), { steps: 90000, qualityScore: 10 }),
      snapshot(addDays(START, 3), { steps: 5100, qualityScore: 94 }),
    ]
    const targetDay = addDays(START, 4)
    const baseline = computeMetricBaseline(snapshots, targetDay, 'steps')
    expect(baseline.windows.rolling7.sampleCount).toBe(3)
    expect(baseline.windows.rolling7.median).toBeLessThan(6000)
  })

  it('is resistant to a single outlier day (median/MAD, not mean/SD)', () => {
    const values = [5000, 5100, 4900, 5050, 50000]
    const snapshots = values.map((steps, index) => snapshot(addDays(START, index), { steps, qualityScore: 95 }))
    const targetDay = addDays(START, values.length)
    const baseline = computeMetricBaseline(snapshots, targetDay, 'steps')
    expect(baseline.windows.rolling7.median).toBeLessThan(5200)
  })

  it('only counts days strictly before the target day within each rolling window', () => {
    const snapshots = [
      snapshot(addDays(START, 0), { steps: 1000 }),
      snapshot(addDays(START, 1), { steps: 2000 }),
      snapshot(addDays(START, 2), { steps: 3000 }),
      snapshot(addDays(START, 3), { steps: 4000 }),
      snapshot(addDays(START, 4), { steps: 5000 }),
    ]
    const targetDay = addDays(START, 4)
    const baseline = computeMetricBaseline(snapshots, targetDay, 'steps')
    // rolling3 window = up to 3 days back from target, excluding target itself
    expect(baseline.windows.rolling3.sampleCount).toBe(3)
    expect(baseline.currentValue).toBe(5000)
  })

  it('builds a same-weekday baseline once enough historical occurrences exist', () => {
    // Build 5 consecutive Mondays plus filler days in between.
    const mondays = ['2026-06-01', '2026-06-08', '2026-06-15', '2026-06-22', '2026-06-29']
    expect(new Date(`${mondays[0]}T12:00:00Z`).getUTCDay()).toBe(1)
    const snapshots = mondays.slice(0, 4).map((day) => snapshot(day, { steps: 8000, qualityScore: 95 }))
    const targetDay = mondays[4]
    const baseline = computeMetricBaseline(snapshots, targetDay, 'steps')
    expect(baseline.weekday.weekday).toBe(1)
    expect(baseline.weekday.sampleCount).toBe(4)
    expect(baseline.weekday.ready).toBe(true)
    expect(baseline.weekday.median).toBe(8000)
  })

  it('does not mark the weekday baseline ready with too few historical occurrences', () => {
    const snapshots = ['2026-06-01', '2026-06-08'].map((day) => snapshot(day, { steps: 8000 }))
    const baseline = computeMetricBaseline(snapshots, '2026-06-15', 'steps')
    expect(baseline.weekday.ready).toBe(false)
  })

  it('sums workout minutes across the day rather than requiring a dedicated field', () => {
    const snapshots = [snapshot(START, { workouts: [{ duration: 1800 }, { duration: 600 }] })]
    const baseline = computeMetricBaseline(snapshots, addDays(START, 1), 'workoutMinutes')
    expect(baseline.windows.rolling7.median).toBe(40)
  })

  it('buildPersonalBaselines returns every requested metric keyed by metricKey', () => {
    const snapshots = [snapshot(START, { steps: 6000 })]
    const baselines = buildPersonalBaselines(snapshots, addDays(START, 1), ['steps', 'sleepMinutes'])
    expect(Object.keys(baselines)).toEqual(['steps', 'sleepMinutes'])
  })

  it('computes a robust deviation score relative to a ready window', () => {
    const snapshots = Array.from({ length: 10 }, (_, index) => snapshot(addDays(START, index), { steps: 5000, qualityScore: 95 }))
    const targetDay = addDays(START, 10)
    const baseline = computeMetricBaseline(snapshots, targetDay, 'steps')
    const deviation = deviationFromWindow(9000, baseline.windows.rolling7)
    expect(deviation.direction).toBe('high')
    expect(deviation.robustScore).toBeGreaterThan(0)
  })

  it('returns null deviation when the window is not ready', () => {
    const snapshots = [snapshot(START, { steps: 5000 })]
    const baseline = computeMetricBaseline(snapshots, addDays(START, 1), 'steps')
    expect(deviationFromWindow(9000, baseline.windows.rolling28)).toBeNull()
  })
})
