import { describe, expect, it } from 'vitest'
import { buildLocalIntelligence, consolidateHistory } from '../lib/intelligence'

function dayKey(offset) {
  return new Date(Date.UTC(2026, 0, 1 + offset)).toISOString().slice(0, 10)
}

function historyRow(offset, overrides = {}) {
  return {
    day: dayKey(offset),
    steps: 10000 + offset * 20,
    sleepMinutes: 450 + offset,
    heartAverage: 65 + offset * 0.05,
    spo2Average: 97,
    stressAverage: 30 + offset * 0.1,
    activeMinutes: 80 + offset,
    quality: { score: 95 },
    ...overrides,
  }
}

describe('local intelligence', () => {
  it('consolidates several backups and keeps the newest value for duplicate days', () => {
    const imports = [
      { id: 'new', importedAt: '2026-02-02T10:00:00Z', days: [historyRow(0, { steps: 12000 })] },
      { id: 'old', importedAt: '2026-02-01T10:00:00Z', days: [historyRow(0, { steps: 8000 })] },
    ]
    const result = consolidateHistory(imports)
    expect(result.rows).toHaveLength(1)
    expect(result.rows[0].steps).toBe(12000)
    expect(result.duplicateDays).toBe(1)
  })

  it('does not invent personal alerts when history is insufficient', () => {
    const days = [historyRow(0), historyRow(1)]
    const dataset = { id: 'one', importedAt: '2026-01-02T12:00:00Z', days, metadata: { quality: { score: 90 } } }
    const report = buildLocalIntelligence({ dataset, day: dayKey(1), imports: [dataset], currentSummary: days[1] })
    expect(report.readiness.personal).toBe(1)
    expect(report.signals).toEqual([])
    expect(report.confidence.level).toBe('low')
    expect(report.narrative).toContain('apprentissage')
  })

  it('detects a large personal variation with an explainable baseline', () => {
    const days = Array.from({ length: 16 }, (_, index) => historyRow(index))
    days.push(historyRow(16, { steps: 1800 }))
    const dataset = { id: 'history', importedAt: '2026-01-18T12:00:00Z', days, metadata: { quality: { score: 95 } } }
    const report = buildLocalIntelligence({ dataset, day: dayKey(16), imports: [dataset], currentSummary: days.at(-1) })
    const signal = report.signals.find((item) => item.metricKey === 'steps')
    expect(signal).toBeDefined()
    expect(signal.direction).toBe('low')
    expect(signal.samples).toBe(16)
    expect(signal.baseline).toBeGreaterThan(10000)
  })

  it('builds correlations and cautious projections only after enough days', () => {
    const days = Array.from({ length: 36 }, (_, index) => historyRow(index, {
      steps: 5000 + index * 180,
      stressAverage: 65 - index * 0.8,
    }))
    const dataset = { id: 'long', importedAt: '2026-02-06T12:00:00Z', days, metadata: { quality: { score: 96 } } }
    const report = buildLocalIntelligence({ dataset, day: dayKey(35), imports: [dataset], rangeDays: 0, currentSummary: days.at(-1) })
    expect(report.correlations.some((item) => item.x === 'steps' && item.y === 'stress')).toBe(true)
    expect(report.forecasts.map((item) => item.metricKey)).toContain('steps')
    expect(report.forecasts.every((item) => item.samples >= 14)).toBe(true)
  })
})
