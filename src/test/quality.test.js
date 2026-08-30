import { describe, expect, it } from 'vitest'
import { buildQualityReport } from '../lib/quality'

describe('data quality report', () => {
  it('detects invalid and overlapping sleep intervals', () => {
    const dataset = {
      days: [{ day: '2026-08-30' }],
      sleepIntervals: [
        { day: '2026-08-30', start: 100, end: 200, tz: 7200 },
        { day: '2026-08-30', start: 150, end: 250, tz: 7200 },
        { day: '2026-08-30', start: 300, end: 299, tz: 3600 },
      ],
      heart: [], spo2: [], stress: [], records: [], sleep: [], weights: [], bloodPressure: [], bloodGlucose: [],
      metadata: { compatibility: { addedColumns: [] } },
    }
    const report = buildQualityReport(dataset)
    expect(report.checks.find((item) => item.id === 'sleep-negative').count).toBe(1)
    expect(report.checks.find((item) => item.id === 'sleep-overlap').count).toBe(1)
    expect(report.days[0].quality.level).not.toBe('high')
  })

  it('reports a clean technical range without fabricating medical conclusions', () => {
    const dataset = {
      days: [{ day: '2026-08-30' }],
      heart: [{ day: '2026-08-30', dateTime: 1, type: 0, value: 70, tz: 7200 }],
      spo2: [{ day: '2026-08-30', dateTime: 2, type: 0, value: 98, tz: 7200 }],
      stress: [{ day: '2026-08-30', dateTime: 3, type: 0, value: 20, tz: 7200 }],
      records: [], sleep: [], sleepIntervals: [], weights: [], bloodPressure: [], bloodGlucose: [],
      metadata: { compatibility: { addedColumns: [] } },
    }
    const report = buildQualityReport(dataset)
    expect(report.checks.filter((item) => item.status === 'error')).toHaveLength(0)
    expect(report.days[0].quality.score).toBeGreaterThanOrEqual(90)
  })
})
