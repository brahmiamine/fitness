import { describe, expect, it } from 'vitest'
import { buildDailyAdvice, FORBIDDEN_ADVICE_TOPICS } from '../lib/advisor/dailyAdvice'
import { GUIDANCE_LEVELS } from '../lib/advisor/guidanceLevels'

const targetSnapshot = { day: '2026-06-15', freshness: { dayAgeDays: 0 } }

function adviceCandidate(overrides = {}) {
  return {
    id: 'sedentary-distribution',
    level: GUIDANCE_LEVELS.ADVICE,
    domain: 'activity',
    reason: '60 % de vos pas sont concentrés sur une seule heure.',
    action: 'Répartir le mouvement sur davantage d’heures.',
    evidenceId: 'who-activity-2020',
    confidence: 0.6,
    sourceDay: '2026-06-15',
    metric: 'steps',
    ...overrides,
  }
}

function weekComparison(metricKey, { percentChange, value = 1000 }) {
  return {
    metricKey,
    type: 'week_to_date_vs_previous_week',
    comparable: true,
    confidence: 0.8,
    percentChange,
    periodA: { start: '2026-06-09', end: '2026-06-15', value },
    periodB: { value: value / (1 + percentChange) },
  }
}

describe('buildDailyAdvice', () => {
  it('keeps every item data-grounded with a reason and source metrics', () => {
    const result = buildDailyAdvice({
      assessments: { sedentary: { candidates: [adviceCandidate()] } },
      comparisons: [weekComparison('steps', { percentChange: -0.4 })],
      targetSnapshot,
    })
    expect(result.items.length).toBeGreaterThanOrEqual(2)
    for (const item of result.items) {
      expect(item.reason).toBeTruthy()
      expect(item.message).toBeTruthy()
      expect(Array.isArray(item.sourceMetrics)).toBe(true)
      expect(item.sourceMetrics.length).toBeGreaterThan(0)
    }
  })

  it('never emits generic wellness filler', () => {
    const result = buildDailyAdvice({
      assessments: {
        sedentary: {
          candidates: [
            adviceCandidate(),
            adviceCandidate({ id: 'filler', action: 'Buvez de l’eau et prenez des protéines pour récupérer.', reason: 'Conseil général.' }),
          ],
        },
      },
      comparisons: [],
      targetSnapshot,
    })
    expect(result.items.some((item) => item.id === 'filler')).toBe(false)
    for (const item of result.items) {
      for (const pattern of FORBIDDEN_ADVICE_TOPICS) expect(pattern.test(`${item.message} ${item.reason}`)).toBe(false)
    }
  })

  it('merges duplicate advice from different domains into one item', () => {
    const duplicate = adviceCandidate({ id: 'duplicate', domain: 'activity' })
    const result = buildDailyAdvice({
      assessments: { sedentary: { candidates: [adviceCandidate()] }, activity: { candidates: [duplicate] } },
      comparisons: [],
      targetSnapshot,
    })
    const matching = result.items.filter((item) => item.message === 'Répartir le mouvement sur davantage d’heures.')
    expect(matching).toHaveLength(1)
    expect(result.mergedCount).toBe(1)
  })

  it('supports a positive reassurance item when recovery allows it', () => {
    const result = buildDailyAdvice({
      assessments: {
        recovery: {
          candidates: [{ id: 'recovery-active-ready', level: GUIDANCE_LEVELS.INFO, domain: 'recovery', reason: 'Tout est dans vos repères.', action: 'Une activité normale est possible.', confidence: 0.8, sourceDay: '2026-06-15' }],
        },
      },
      comparisons: [],
      targetSnapshot,
    })
    const reassurance = result.items.find((item) => item.id === 'recovery-active-ready')
    expect(reassurance.kind).toBe('reassurance')
  })

  it('changes advice when the input context changes', () => {
    const down = buildDailyAdvice({ assessments: {}, comparisons: [weekComparison('steps', { percentChange: -0.5 })], targetSnapshot })
    const up = buildDailyAdvice({ assessments: {}, comparisons: [weekComparison('steps', { percentChange: 0.5 })], targetSnapshot })
    expect(down.items[0].message).not.toBe(up.items[0].message)
    expect(down.items[0].message).toMatch(/au-dessous/)
    expect(up.items[0].message).toMatch(/au-dessus/)
  })
})
