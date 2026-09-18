import { describe, expect, it } from 'vitest'
import { buildDecisionSet, DECISION_STATUS, MAX_COMMITMENTS } from '../lib/advisor/arbitration'
import { GUIDANCE_LEVELS } from '../lib/advisor/guidanceLevels'

function candidate(overrides) {
  return {
    id: 'candidate',
    level: GUIDANCE_LEVELS.COMMITMENT,
    domain: 'activity',
    reason: 'motif',
    action: 'action',
    confidence: 0.6,
    metric: 'steps',
    target: null,
    ...overrides,
  }
}

const targetSnapshot = { day: '2026-06-15', freshness: { dayAgeDays: 0 } }

describe('buildDecisionSet', () => {
  it('never selects more than the maximum number of commitments, with safety first', () => {
    const decisions = buildDecisionSet({
      assessments: {
        safety: { candidates: [candidate({ id: 'safety-bp-recheck', level: GUIDANCE_LEVELS.RECHECK, domain: 'bloodPressure', action: 'Recontrôler la tension.' })] },
        recovery: { candidates: [candidate({ id: 'recovery-priority', domain: 'recovery', action: 'Privilégier la récupération.' })] },
        sleep: { candidates: [candidate({ id: 'sleep-priority', domain: 'sleep', action: 'Prioriser le sommeil.' })] },
        activity: {
          candidates: [
            candidate({ id: 'activity-step-goal', action: 'Atteindre 6 500 pas.' }),
            candidate({ id: 'activity-workout-due', action: 'Prévoir une séance.' }),
          ],
        },
      },
      targetSnapshot,
    })
    expect(decisions.commitments).toHaveLength(MAX_COMMITMENTS)
    expect(decisions.commitments[0].id).toBe('safety-bp-recheck')
    const selectedIds = decisions.commitments.map((item) => item.id)
    expect(selectedIds).not.toContain('activity-workout-due')
  })

  it('lets safety override optimization even when it is declared last', () => {
    const result = buildDecisionSet({
      assessments: {
        activity: { candidates: [candidate({ id: 'activity-step-goal' })] },
        optimization: { candidates: [candidate({ id: 'opt-info', level: GUIDANCE_LEVELS.INFO, action: 'Info.' })] },
        safety: { candidates: [candidate({ id: 'safety-spo2-recheck', level: GUIDANCE_LEVELS.RECHECK, domain: 'oxygen', action: 'Recontrôler la SpO₂.' })] },
      },
      targetSnapshot,
    })
    expect(result.commitments.some((item) => item.id === 'safety-spo2-recheck')).toBe(true)
    expect(result.commitments[0].priorityClass).toBe('safety')
  })

  it('defers a due workout when recovery blocks it', () => {
    const result = buildDecisionSet({
      assessments: {
        recovery: { candidates: [candidate({ id: 'recovery-priority', domain: 'recovery', action: 'Privilégier la récupération.' })] },
        activity: { candidates: [candidate({ id: 'activity-workout-deferred', action: 'Activité légère.', deferredBy: ['recovery-required'] })] },
      },
      targetSnapshot,
    })
    const workout = result.decisions.find((item) => item.id === 'activity-workout-deferred')
    expect(workout.status).toBe(DECISION_STATUS.DEFERRED_BY_SAFETY)
    expect(result.deferred.map((item) => item.id)).toContain('activity-workout-deferred')
    expect(result.commitments.map((item) => item.id)).not.toContain('activity-workout-deferred')
  })

  it('returns zero commitments on a normal day', () => {
    const result = buildDecisionSet({
      assessments: {
        recovery: { candidates: [candidate({ id: 'recovery-normal', level: GUIDANCE_LEVELS.INFO, domain: 'recovery', action: null })] },
        activity: { candidates: [candidate({ id: 'activity-no-extra', level: GUIDANCE_LEVELS.INFO, action: 'Aucun pas supplémentaire nécessaire.' })] },
      },
      targetSnapshot,
    })
    expect(result.commitments).toEqual([])
    expect(result.notNeeded.map((item) => item.id)).toEqual(expect.arrayContaining(['recovery-normal', 'activity-no-extra']))
  })

  it('merges duplicate decisions and stays deterministic for identical input', () => {
    const assessments = {
      activity: {
        candidates: [
          candidate({ id: 'a', action: 'Atteindre 6 500 pas.' }),
          candidate({ id: 'b', action: 'Atteindre 6 500 pas.' }),
        ],
      },
    }
    const first = buildDecisionSet({ assessments, targetSnapshot })
    const second = buildDecisionSet({ assessments, targetSnapshot })
    expect(first.decisions).toHaveLength(1)
    expect(first.decisions[0].merged).toBe(true)
    expect(second).toEqual(first)
  })
})
