import { detectSustainedTrends } from './comparisons'

/**
 * Adaptive 3–7 day rolling plan (#26). A plan is generated only when a
 * sustained trend or a multi-day objective justifies it, has one main
 * intent per day, uses bounded progressive targets (never one-day
 * compensation), is recalculated on every import and disappears as soon as
 * the trend resolves.
 *
 * Safety/recovery blockers override planned activity: an active higher-risk
 * safety decision suppresses the activity portion of the plan.
 */
export const ROLLING_PLAN_DEFAULTS = {
  minimumDays: 3,
  maximumDays: 7,
  maximumBedtimeShiftPerDay: 15,
  maximumStepRampRatio: 0.25,
}

const DAY_MS = 86_400_000

function shiftDay(day, offset) {
  return new Date(Date.parse(`${day}T00:00:00Z`) + offset * DAY_MS).toISOString().slice(0, 10)
}

function circularDifference(value, reference) {
  let difference = value - reference
  if (difference > 720) difference -= 1440
  if (difference < -720) difference += 1440
  return difference
}

function clampDays(days, settings) {
  return Math.max(settings.minimumDays, Math.min(settings.maximumDays, days))
}

export function detectPlanObjective({ assessments = {}, trends = [], healthMath = null } = {}) {
  const sleepTrend = trends.find((trend) => trend.metricKey === 'sleepMinutes' && trend.direction === 'low')
  const activityTrend = trends.find((trend) => trend.metricKey === 'steps' && trend.direction === 'low')
  const safetyActive = (assessments.safety?.candidates || []).length > 0

  if (safetyActive) {
    return { key: 'safety', blocked: true, reason: 'Une mesure de sécurité doit être recontrôlée avant tout plan d’activité.', triggers: ['safety'] }
  }
  if (assessments.recovery?.state === 'RECOVERY_REQUIRED') {
    return { key: 'recovery', blocked: false, reason: 'Récupération requise : retour progressif à l’activité.', triggers: ['recovery_required'] }
  }
  if ((assessments.sleep?.consecutiveShortNights || 0) >= 3 || sleepTrend) {
    return { key: 'sleep', blocked: false, reason: 'Plusieurs nuits courtes consécutives : plan de récupération du sommeil.', triggers: ['sustained_short_sleep'] }
  }
  if (activityTrend) {
    return { key: 'activity', blocked: false, reason: 'Activité en baisse durable : reprise progressive.', triggers: ['activity_decline'] }
  }
  if (assessments.activity?.workoutDue) {
    return { key: 'workout', blocked: false, reason: 'Plusieurs jours sans séance avec une semaine peu active : retour progressif.', triggers: ['workout_return'] }
  }
  const goal = healthMath?.weightGoal
  if (goal?.computable && goal.direction !== 'maintain') {
    return { key: 'weight', blocked: false, reason: 'Objectif de poids avec les données de calcul disponibles : plan énergétique progressif.', triggers: ['weight_goal'] }
  }
  return null
}

function baseDay(date, intent, reason, confidence, targets, conditions, reassessment, index) {
  return {
    offset: index + 1,
    date,
    relativeDay: index === 0 ? 'demain' : `J+${index + 1}`,
    intent,
    targets,
    conditions,
    reason,
    confidence,
    reassessment,
  }
}

function buildSleepPlan(targetDay, assessments, settings) {
  const sleep = assessments.sleep || {}
  const nights = clampDays((sleep.consecutiveShortNights || 3) + 1, settings)
  const currentBedtime = sleep.targetBedtime?.bedtimeMinute ?? null
  const targetBedtime = sleep.targetBedtime?.targetMinute ?? null
  const days = []
  let cursorBedtime = currentBedtime
  for (let index = 0; index < nights; index += 1) {
    if (currentBedtime != null && targetBedtime != null) {
      const difference = circularDifference(targetBedtime, currentBedtime)
      const shift = Math.sign(difference) * Math.min(settings.maximumBedtimeShiftPerDay, Math.abs(difference))
      cursorBedtime = ((currentBedtime + shift * (index + 1)) % 1440 + 1440) % 1440
    }
    days.push(
      baseDay(
        shiftDay(targetDay, index + 1),
        'SLEEP_RECOVERY',
        'Rattraper progressivement la dette de sommeil sans décaler brutalement l’horaire.',
        sleep.confidence ?? 0.6,
        { bedtimeMinute: cursorBedtime },
        [{ id: 'sleep-duration', metric: 'sleepMinutes', operator: '>=', value: sleep.baseline?.median ? Math.round(sleep.baseline.median * 0.9) : null }],
        'Reprendre une nuit normale pendant 2 jours de suite.',
        index,
      ),
    )
  }
  return { nights, days }
}

function buildActivityPlan(targetDay, assessments, settings) {
  const activity = assessments.activity || {}
  const length = clampDays(7, settings)
  const current = activity.currentSteps ?? null
  const target = activity.stepGoal?.base ?? activity.stepGoal?.value ?? null
  const days = []
  for (let index = 0; index < length; index += 1) {
    const fraction = length > 1 ? (index + 1) / length : 1
    let stepTarget = null
    if (current != null && target != null) {
      const raw = current + (target - current) * fraction
      const bounded = Math.min(target, Math.max(current, raw))
      stepTarget = Math.round(bounded / 100) * 100
    }
    days.push(
      baseDay(
        shiftDay(targetDay, index + 1),
        'ACTIVITY_RAMP',
        'Remonter progressivement vers votre niveau d’activité personnel, sans rattrapage sur une seule journée.',
        activity.confidence ?? 0.6,
        { steps: stepTarget },
        [{ id: 'steps-target', metric: 'steps', operator: '>=', value: stepTarget }],
        'Réévaluer si l’activité revient dans votre intervalle personnel.',
        index,
      ),
    )
  }
  return { length, days }
}

function buildWorkoutPlan(targetDay, assessments, settings) {
  const length = clampDays(4, settings)
  const intents = ['LIGHT_ACTIVITY', 'REST_OR_WALK', 'MODERATE_SESSION', 'REASSESS']
  const activity = assessments.activity || {}
  const days = intents.map((intent, index) =>
    baseDay(
      shiftDay(targetDay, index + 1),
      intent,
      'Retour progressif aux séances après plusieurs jours sans entraînement.',
      activity.confidence ?? 0.6,
      { minutes: intent === 'MODERATE_SESSION' ? 30 : intent === 'LIGHT_ACTIVITY' ? 20 : null },
      [{ id: 'no-soreness', metric: 'recovery', operator: '==', value: 'NORMAL' }],
      'Passer à l’étape suivante seulement si la récupération reste dans votre repère.',
      index,
    ),
  )
  return { length, days }
}

function buildRecoveryPlan(targetDay, assessments, settings) {
  const length = clampDays(4, settings)
  const intents = ['RECOVERY', 'LIGHT_MOVEMENT', 'LIGHT_MOVEMENT', 'REASSESS']
  const recovery = assessments.recovery || {}
  const days = intents.map((intent, index) =>
    baseDay(
      shiftDay(targetDay, index + 1),
      intent,
      'Retour graduel après une récupération défavorable.',
      recovery.confidence ?? 0.6,
      { intensity: intent === 'RECOVERY' ? 'none' : 'light' },
      [{ id: 'recovery-normal', metric: 'recovery', operator: '==', value: 'NORMAL' }],
      'Réévaluer chaque matin avec les nouvelles données.',
      index,
    ),
  )
  return { length, days }
}

function buildWeightPlan(targetDay, assessments, settings, healthMath) {
  const goal = healthMath.weightGoal
  const length = clampDays(7, settings)
  const days = Array.from({ length }, (_, index) =>
    baseDay(
      shiftDay(targetDay, index + 1),
      'ENERGY_TARGET',
      `Viser une variation progressive d’environ ${goal.rateKgPerWeek} kg/semaine.`,
      0.6,
      { energyKcal: goal.energyTargetKcal, rateKgPerWeek: goal.rateKgPerWeek },
      [{ id: 'weight-trend', metric: 'weightKg', operator: goal.direction === 'loss' ? '<=' : '>=', value: null }],
      'Ajuster si la tendance de poids s’écarte du rythme modéré.',
      index,
    ),
  )
  return { length, days }
}

export function buildRollingPlan({ snapshots = [], targetDay, assessments = {}, healthMath = null, options = {} } = {}) {
  const settings = { ...ROLLING_PLAN_DEFAULTS, ...options }
  const trends = options.trends || detectSustainedTrends(snapshots, targetDay)
  const objective = detectPlanObjective({ assessments, trends, healthMath })
  if (!objective) {
    return { active: false, objective: null, days: [], reason: 'Aucune tendance durable ne justifie un plan roulant.', confidence: null, reassessment: null, triggers: [] }
  }
  if (objective.blocked) {
    return { active: false, objective: objective.key, blockedBySafety: true, days: [], reason: objective.reason, confidence: null, reassessment: null, triggers: objective.triggers }
  }

  let built
  if (objective.key === 'sleep') built = buildSleepPlan(targetDay, assessments, settings)
  else if (objective.key === 'activity') built = buildActivityPlan(targetDay, assessments, settings)
  else if (objective.key === 'workout') built = buildWorkoutPlan(targetDay, assessments, settings)
  else if (objective.key === 'recovery') built = buildRecoveryPlan(targetDay, assessments, settings)
  else built = buildWeightPlan(targetDay, assessments, settings, healthMath)

  const confidence = built.days.length ? Math.round((built.days.reduce((sum, day) => sum + (day.confidence || 0), 0) / built.days.length) * 100) / 100 : null
  return {
    active: true,
    objective: objective.key,
    blockedBySafety: false,
    reason: objective.reason,
    days: built.days,
    confidence,
    reassessment: 'Plan recalculé à chaque nouvel import ; il disparaît si la tendance se résout.',
    triggers: objective.triggers,
  }
}
