import { BASELINE_METRICS } from './baselines'
import { rankComparisons } from './comparisons'
import { buildDailyAdvice } from './dailyAdvice'
import { buildDecisionSet } from './arbitration'
import { GUIDANCE_LEVELS } from './guidanceLevels'

/**
 * Today + Tomorrow decision planner (#25). Wraps the arbitration result and
 * the daily advice into the main advisor output, and builds a *conditional*
 * tomorrow: new sleep/recovery data can change the decision, so tomorrow is
 * expressed as explicit conditions with if/else branches rather than a
 * fixed prescription.
 *
 * NXK is imported data: every output exposes the latest import freshness so
 * the UI never implies live monitoring when the data is stale.
 */
export const PLAN_STATES = {
  SEEK_MEDICAL_ADVICE: 'SEEK_MEDICAL_ADVICE',
  SAFETY_RECHECK: 'SAFETY_RECHECK',
  RECOVERY_REQUIRED: 'RECOVERY_REQUIRED',
  SLEEP_PRIORITY: 'SLEEP_PRIORITY',
  MOVEMENT_PRIORITY: 'MOVEMENT_PRIORITY',
  ACTIVITY_DUE: 'ACTIVITY_DUE',
  NORMAL: 'NORMAL',
}

const STATE_LABELS = {
  SEEK_MEDICAL_ADVICE: 'Avis médical recommandé',
  SAFETY_RECHECK: 'Mesure à recontrôler',
  RECOVERY_REQUIRED: 'Récupération prioritaire',
  SLEEP_PRIORITY: 'Sommeil prioritaire',
  MOVEMENT_PRIORITY: 'Mouvement à répartir',
  ACTIVITY_DUE: 'Séance due',
  NORMAL: 'Journée dans vos repères',
}

const DAY_MS = 86_400_000

function shiftDay(day, offset) {
  return new Date(Date.parse(`${day}T00:00:00Z`) + offset * DAY_MS).toISOString().slice(0, 10)
}

function todayState(assessments, decisionSet, sedentary) {
  if (decisionSet.safety.some((decision) => decision.actionClass === GUIDANCE_LEVELS.SEEK_MEDICAL_ADVICE)) return PLAN_STATES.SEEK_MEDICAL_ADVICE
  if (decisionSet.safety.length) return PLAN_STATES.SAFETY_RECHECK
  if (assessments.recovery?.state === 'RECOVERY_REQUIRED') return PLAN_STATES.RECOVERY_REQUIRED
  if (assessments.sleep?.status === 'SLEEP_PRIORITY') return PLAN_STATES.SLEEP_PRIORITY
  if (assessments.activity?.workoutDue) return PLAN_STATES.ACTIVITY_DUE
  if (sedentary && (sedentary.longestBlockMinutes >= 120 || sedentary.poorDistribution)) return PLAN_STATES.MOVEMENT_PRIORITY
  return PLAN_STATES.NORMAL
}

function averageConfidence(items) {
  const values = items.map((item) => item?.confidence).filter((value) => Number.isFinite(value))
  if (!values.length) return null
  return Math.round((values.reduce((sum, value) => sum + value, 0) / values.length) * 100) / 100
}

function comparisonSummary(comparisons) {
  return rankComparisons(comparisons, 3).map((comparison) => ({
    metricKey: comparison.metricKey,
    label: BASELINE_METRICS[comparison.metricKey]?.label || comparison.metricKey,
    direction: comparison.direction,
    percentChange: comparison.percentChange,
    period: comparison.periodA,
    confidence: comparison.confidence,
  }))
}

function tomorrowFor(state, { assessments, activity }) {
  const recoveryLike = state === PLAN_STATES.RECOVERY_REQUIRED || state === PLAN_STATES.SLEEP_PRIORITY
  const safety = state === PLAN_STATES.SEEK_MEDICAL_ADVICE || state === PLAN_STATES.SAFETY_RECHECK
  const conditions = recoveryLike
    ? [
        { id: 'sleep-recovers', metric: 'sleepMinutes', label: 'Sommeil revenu dans votre repère personnel' },
        { id: 'stress-normalizes', metric: 'stressAverage', label: 'Stress revenu dans votre repère personnel' },
      ]
    : safety
      ? [{ id: 'recheck-stable', metric: 'safety', label: 'Mesure recontrôlée dans votre repère' }]
      : [{ id: 'sleep-maintained', metric: 'sleepMinutes', label: 'Sommeil maintenu dans votre repère personnel' }]

  if (recoveryLike) {
    return {
      conditional: true,
      conditions,
      branches: {
        ifMet: { intent: 'ACTIVITY_NORMAL', title: 'Activité normale possible', actions: activity?.stepGoal?.value ? [`Objectif d’environ ${activity.stepGoal.value} pas`] : [] },
        else: { intent: 'RECOVERY_LIGHT', title: 'Récupération et mouvement léger', actions: ['Activité légère', 'Réévaluer demain'] },
      },
      reassessment: 'Réévaluation automatique à chaque nouvel import.',
    }
  }
  if (safety) {
    return {
      conditional: true,
      conditions,
      branches: {
        ifMet: { intent: 'NORMAL', title: 'Reprendre le fonctionnement habituel', actions: [] },
        else: { intent: 'RECHECK', title: 'Recontrôler et demander un avis si la répétition se confirme', actions: ['Recontrôler dans les mêmes conditions'] },
      },
      reassessment: 'Réévaluation automatique à chaque nouvel import.',
    }
  }
  return {
    conditional: true,
    conditions,
    branches: {
      ifMet: { intent: 'ACTIVITY_NORMAL', title: 'Poursuivre la journée type', actions: activity?.stepGoal?.value ? [`Objectif d’environ ${activity.stepGoal.value} pas`] : [] },
      else: { intent: 'RECOVERY_LIGHT', title: 'Ralentir et réévaluer', actions: ['Activité légère'] },
    },
    reassessment: 'Réévaluation automatique à chaque nouvel import.',
  }
}

/**
 * @param {object} input
 * @param {object} input.assessments  { sedentary, sleep, activity, recovery, safety }
 * @param {Array} input.comparisons   Output of buildComparisons (#15).
 * @param {object} input.targetSnapshot Snapshot for the target day (freshness).
 */
export function buildDailyPlan({ assessments = {}, comparisons = [], targetSnapshot = null, generatedAt = null } = {}) {
  const decisionSet = buildDecisionSet({ assessments, targetSnapshot, generatedAt })
  const advice = buildDailyAdvice({ assessments, comparisons, targetSnapshot })
  const sedentary = assessments.sedentary || null
  const state = todayState(assessments, decisionSet, sedentary)
  const freshness = targetSnapshot?.freshness ?? null

  const today = {
    date: targetSnapshot?.day ?? null,
    state: { code: state, label: STATE_LABELS[state], conditional: false },
    commitments: decisionSet.commitments.map(({ _mandatory, ...decision }) => decision),
    advice: advice.items,
    rechecks: decisionSet.safety,
    comparisons: comparisonSummary(comparisons),
    deferred: decisionSet.deferred,
    rationale: decisionSet.commitments.map((decision) => decision.reasons[0]).filter(Boolean),
    confidence: averageConfidence([...decisionSet.commitments, ...advice.items, assessments.recovery, assessments.sleep]),
    freshness,
  }

  const tomorrow = {
    date: today.date ? shiftDay(today.date, 1) : null,
    state: { code: state, label: `${STATE_LABELS[state]} — conditionnel`, conditional: true },
    ...tomorrowFor(state, { assessments, activity: assessments.activity }),
    rationale: `Dépend de l’évolution du sommeil et de la récupération par rapport à ${today.date || 'la dernière journée'}.`,
    confidence: today.confidence,
    freshness,
  }

  return { today, tomorrow, decisionSet, advice, generatedAt }
}
