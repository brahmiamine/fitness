import { computeMetricBaseline } from './baselines'
import { compareWeekToDate } from './comparisons'
import { estimateStepDistanceForDay } from './stepDistance'
import { describeSourceDay, freshnessFactor } from './freshness'
import { GUIDANCE_LEVELS } from './guidanceLevels'
import { createGuidance } from './safetyPolicy'

/**
 * Activity and workout advisor (#19). Builds a personalized step goal and
 * workout-return decisions from steps, active time, workout history and the
 * week-to-date comparison. Steps remain the primary target; km is only
 * attached when the #16 distance estimator is ready and is learned from
 * step/distance pairs, never GPS.
 *
 * Catch-up is always progressive: a weekly deficit is spread over the
 * remaining days and bounded, so one day can never overcompensate.
 */
export const ACTIVITY_DEFAULTS = {
  workoutGapDays: 4,
  suggestionMinMinutes: 30,
  suggestionMaxMinutes: 45,
  maxDailyCatchUpSteps: 2000,
  minimumGoalSteps: 3000,
  goalRoundingSteps: 100,
  lowWeeklyActivityRatio: 0.8,
}

function isWorkoutDay(snapshot) {
  return (snapshot?.workouts || []).length > 0
}

export function daysSinceLastWorkout(snapshots, targetDay) {
  const byDay = new Map(snapshots.map((snapshot) => [snapshot.day, snapshot]))
  if (isWorkoutDay(byDay.get(targetDay))) {
    return { daysSince: 0, lastWorkoutDay: targetDay, hasWorkoutData: true, workout: byDay.get(targetDay).workouts.at(-1) }
  }
  const days = snapshots.map((snapshot) => snapshot.day).filter((day) => day < targetDay).sort()
  for (let index = days.length - 1; index >= 0; index -= 1) {
    const snapshot = byDay.get(days[index])
    if (isWorkoutDay(snapshot)) {
      const daysSince = Math.round((Date.parse(`${targetDay}T00:00:00Z`) - Date.parse(`${days[index]}T00:00:00Z`)) / 86_400_000)
      return { daysSince, lastWorkoutDay: days[index], hasWorkoutData: true, workout: snapshot.workouts.at(-1) }
    }
  }
  const hasWorkoutData = snapshots.some((snapshot) => isWorkoutDay(snapshot))
  return { daysSince: null, lastWorkoutDay: null, hasWorkoutData, workout: null }
}

function roundTo(value, step) {
  return Math.round(value / step) * step
}

function buildStepGoal(snapshots, targetDay, options) {
  const baseline = computeMetricBaseline(snapshots, targetDay, 'steps', options)
  const window = baseline.windows.rolling7.ready ? baseline.windows.rolling7 : baseline.windows.rolling28.ready ? baseline.windows.rolling28 : null
  if (!window || window.median == null) return { value: null, source: null, baseline: baseline.windows.rolling7 }
  const base = Math.max(options.minimumGoalSteps, roundTo(window.median, options.goalRoundingSteps))
  return { value: base, source: window === baseline.windows.rolling7 ? 'rolling7_baseline' : 'rolling28_baseline', baseline: window }
}

export function assessActivity({ snapshots, targetDay, options = {}, blockers = [], stepDistanceOptions = {} } = {}) {
  const settings = { ...ACTIVITY_DEFAULTS, ...options }
  const byDay = new Map(snapshots.map((snapshot) => [snapshot.day, snapshot]))
  const target = byDay.get(targetDay) || null
  const currentSteps = target?.activity?.steps ?? null
  const baseline = computeMetricBaseline(snapshots, targetDay, 'steps', options)
  const window = baseline.windows.rolling7
  const highActivity = window.ready && currentSteps != null && currentSteps >= window.q3
  const goal = buildStepGoal(snapshots, targetDay, settings)
  const goalMet = goal.value != null && currentSteps != null && currentSteps >= goal.value

  const weekSteps = compareWeekToDate(snapshots, targetDay, 'steps', options)
  const weekActive = compareWeekToDate(snapshots, targetDay, 'activeMinutes', options)
  const weekWorkout = compareWeekToDate(snapshots, targetDay, 'workoutMinutes', options)
  const isoWeekday = new Date(`${targetDay}T12:00:00Z`).getUTCDay() || 7
  const remainingDays = 8 - isoWeekday
  const deficit = weekSteps.comparable && weekSteps.periodB.value != null && weekSteps.periodA.value != null
    ? Math.max(0, weekSteps.periodB.value - weekSteps.periodA.value)
    : 0
  const progressiveTopUp = deficit && remainingDays > 0 ? Math.min(deficit / remainingDays, settings.maxDailyCatchUpSteps) : 0
  const catchUp = {
    deficitSteps: Math.round(deficit),
    remainingDays,
    dailyTopUpSteps: Math.round(progressiveTopUp),
    bounded: progressiveTopUp < deficit / Math.max(1, remainingDays),
    behind: weekSteps.comparable && weekSteps.direction === 'down',
  }
  const effectiveGoal = goal.value != null ? roundTo(goal.value + progressiveTopUp, settings.goalRoundingSteps) : null

  const workout = daysSinceLastWorkout(snapshots, targetDay)
  const lowWeeklyActivity = weekSteps.comparable && weekSteps.periodA.value != null && weekSteps.periodB.value
    ? weekSteps.periodA.value < weekSteps.periodB.value * settings.lowWeeklyActivityRatio
    : false
  const workoutDue =
    workout.hasWorkoutData &&
    workout.daysSince != null &&
    workout.daysSince >= settings.workoutGapDays &&
    (lowWeeklyActivity || (weekWorkout.comparable && weekWorkout.direction === 'down'))
  const blocker = blockers.filter(Boolean)
  const blocked = blocker.length > 0

  const distance = estimateStepDistanceForDay(snapshots, targetDay, stepDistanceOptions)
  const confidence = Math.round(Math.min(1, (window.sampleCount / 14) * 0.7 + (target ? 0.3 : 0)) * freshnessFactor(target) * 100) / 100
  const sourceDay = targetDay
  const phrase = describeSourceDay(target)
  const candidates = []

  if (effectiveGoal != null && !goalMet && !highActivity && !blocked) {
    candidates.push({
      ...createGuidance({
        id: 'activity-step-goal',
        level: GUIDANCE_LEVELS.COMMITMENT,
        reason: `Votre objectif personnel de pas est fixé à partir de votre médiane des 7 derniers jours (${effectiveGoal - Math.round(progressiveTopUp)} pas)${catchUp.behind ? `, avec un rattrapage progressif de ${Math.round(progressiveTopUp)} pas/jour` : ''}.`,
        action: `Atteindre environ ${effectiveGoal} pas ${phrase}.`,
        evidenceId: 'who-activity-2020',
        confidence,
        sourceDay,
        domain: 'activity',
      }),
      metric: 'steps',
      mandatory: true,
      target: {
        kind: 'steps',
        value: effectiveGoal,
        minutes: null,
        distanceMeters: distance.distanceMeters,
        distanceKm: distance.distanceMeters != null ? Math.round((distance.distanceMeters / 1000) * 100) / 100 : null,
      },
    })
  }

  if (workoutDue && !blocked) {
    candidates.push({
      ...createGuidance({
        id: 'activity-workout-due',
        level: GUIDANCE_LEVELS.COMMITMENT,
        reason: `${workout.daysSince} jours se sont écoulés depuis votre dernière séance, avec une activité hebdomadaire sous votre semaine de référence.`,
        action: `Prévoir ${settings.suggestionMinMinutes} à ${settings.suggestionMaxMinutes} minutes d’activité d’intensité modérée ${phrase}.`,
        evidenceId: 'who-activity-2020',
        confidence,
        sourceDay,
        domain: 'activity',
      }),
      metric: 'workout',
      mandatory: true,
      target: { kind: 'workout', minMinutes: settings.suggestionMinMinutes, maxMinutes: settings.suggestionMaxMinutes },
    })
  }

  if (workoutDue && blocked) {
    candidates.push({
      ...createGuidance({
        id: 'activity-workout-deferred',
        level: GUIDANCE_LEVELS.ADVICE,
        reason: 'Une séance semble due, mais votre récupération actuelle ne soutient pas une activité soutenue.',
        action: 'Privilégier une activité légère et réévaluer la séance quand la récupération revient dans votre repère.',
        evidenceId: 'who-activity-2020',
        confidence,
        sourceDay,
        domain: 'activity',
      }),
      metric: 'workout',
      mandatory: false,
      deferredBy: blocker.map((item) => item.id),
      target: null,
    })
  }

  if ((highActivity || goalMet) && !workoutDue) {
    candidates.push(
      createGuidance({
        id: 'activity-no-extra',
        level: GUIDANCE_LEVELS.INFO,
        reason: highActivity
          ? 'Votre activité dépasse déjà le haut de votre intervalle personnel habituel.'
          : 'Votre objectif de pas personnel est déjà atteint.',
        action: 'Aucun mouvement supplémentaire n’est nécessaire uniquement pour atteindre un chiffre.',
        confidence,
        sourceDay,
        domain: 'activity',
      }),
    )
  }

  if (!candidates.length) {
    candidates.push(
      createGuidance({
        id: 'activity-no-data',
        level: GUIDANCE_LEVELS.INFO,
        reason: 'Assez d’historique n’est pas encore disponible pour fixer un objectif de pas personnel.',
        action: null,
        confidence,
        sourceDay,
        domain: 'activity',
      }),
    )
  }

  return {
    day: targetDay,
    currentSteps,
    stepGoal: { value: effectiveGoal, base: goal.value, source: goal.source, baseline: goal.baseline },
    goalMet,
    highActivity,
    daysSinceLastWorkout: workout.daysSince,
    lastWorkoutDay: workout.lastWorkoutDay,
    hasWorkoutData: workout.hasWorkoutData,
    workoutDue,
    lowWeeklyActivity,
    weekToDate: {
      steps: weekSteps,
      activeMinutes: weekActive,
      workoutMinutes: weekWorkout,
    },
    catchUp,
    distance,
    blockers: blocker.map((item) => item.id),
    blocked,
    confidence,
    candidates,
  }
}
