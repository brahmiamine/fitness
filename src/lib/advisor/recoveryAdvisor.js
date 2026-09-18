import { computeMetricBaseline, deviationFromWindow } from './baselines'
import { freshnessFactor } from './freshness'
import { GUIDANCE_LEVELS } from './guidanceLevels'
import { createGuidance } from './safetyPolicy'

/**
 * Cardiovascular context and recovery advisor (#20). Combines the sleep
 * advisor result, the personal stress/heart baselines and the recent
 * activity load into one deterministic recovery state consumed by the
 * decision engine.
 *
 * Safety wording: this module never claims to measure a "resting" heart
 * rate (the data does not establish a true resting context), never makes a
 * cardiovascular diagnosis, and a good state is never phrased as medical
 * clearance to train.
 */
export const RECOVERY_STATES = {
  REQUIRED: 'RECOVERY_REQUIRED',
  LOW: 'RECOVERY_LOW',
  NORMAL: 'NORMAL',
  ACTIVE_READY: 'ACTIVE_READY',
}

export const RECOVERY_DEFAULTS = { signalThreshold: 1.5, lowQualityScore: 50 }

function evaluateSignal(snapshots, targetDay, metricKey, { threshold }, options) {
  const baseline = computeMetricBaseline(snapshots, targetDay, metricKey, options)
  const window = baseline.windows.rolling7
  const deviation = deviationFromWindow(baseline.currentValue, window)
  return {
    ready: window.ready,
    value: baseline.currentValue,
    median: window.median,
    robustScore: deviation?.robustScore ?? null,
    strong: Boolean(window.ready && deviation && deviation.robustScore >= threshold),
  }
}

export function assessRecovery({ snapshots, targetDay, sleepAssessment = null, activityAssessment = null, options = {} } = {}) {
  const settings = { ...RECOVERY_DEFAULTS, ...options }
  const target = snapshots.find((snapshot) => snapshot.day === targetDay) || null
  const quality = target?.quality?.score ?? null
  const lowQuality = quality != null && quality < settings.lowQualityScore

  const stress = evaluateSignal(snapshots, targetDay, 'stressAverage', { threshold: settings.signalThreshold }, options)
  const heart = evaluateSignal(snapshots, targetDay, 'heartAverage', { threshold: settings.signalThreshold }, options)
  const sleepPoor = Boolean(
    sleepAssessment && (sleepAssessment.status === 'SLEEP_PRIORITY' || (sleepAssessment.deviation?.robustScore ?? 0) <= -settings.signalThreshold),
  )
  const sleepStrong = Boolean(
    sleepAssessment && (sleepAssessment.recoveryPressure || (sleepAssessment.deviation?.robustScore ?? 0) <= -settings.signalThreshold || sleepAssessment.status === 'SLEEP_PRIORITY'),
  )
  const loadHigh = Boolean(
    activityAssessment?.highActivity ||
      (activityAssessment?.weekToDate?.workoutMinutes?.comparable && activityAssessment.weekToDate.workoutMinutes.direction === 'up'),
  )

  const strongSignals = [
    sleepStrong && { id: 'sleep', detail: 'sommeil sous votre repère personnel' },
    stress.strong && { id: 'stress', detail: 'stress au-dessus de votre repère personnel' },
    heart.strong && { id: 'heart', detail: 'fréquence cardiaque moyenne au-dessus de votre repère personnel' },
  ].filter(Boolean)

  const reasons = []
  if (sleepStrong) reasons.push({ signal: 'sleep', value: sleepAssessment?.minutes ?? null, baseline: sleepAssessment?.baseline?.median ?? null, robustScore: sleepAssessment?.deviation?.robustScore ?? null })
  if (stress.strong) reasons.push({ signal: 'stress', value: stress.value, baseline: stress.median, robustScore: stress.robustScore })
  if (heart.strong) reasons.push({ signal: 'heart', value: heart.value, baseline: heart.median, robustScore: heart.robustScore })
  if (loadHigh) reasons.push({ signal: 'load', value: null, baseline: null, robustScore: null })

  let state = RECOVERY_STATES.NORMAL
  const hasMultiSignal = strongSignals.length >= 2
  if (lowQuality) {
    state = RECOVERY_STATES.NORMAL
  } else if (hasMultiSignal || (sleepStrong && loadHigh)) {
    state = RECOVERY_STATES.REQUIRED
  } else if (strongSignals.length >= 1) {
    state = RECOVERY_STATES.LOW
  } else if (!loadHigh && sleepAssessment?.status === 'NORMAL') {
    state = RECOVERY_STATES.ACTIVE_READY
  }

  const signalCount = strongSignals.length
  const confidence = Math.round(
    Math.min(1, 0.3 + signalCount * 0.2 + (sleepAssessment ? 0.2 : 0) + (target ? 0.2 : 0)) * freshnessFactor(target) * (lowQuality ? 0.5 : 1) * 100,
  ) / 100

  const blockers = state === RECOVERY_STATES.REQUIRED
    ? [{ id: 'recovery-required', domain: 'recovery', level: GUIDANCE_LEVELS.COMMITMENT, reason: 'Plusieurs signaux de récupération sont défavorables.' }]
    : []
  const sourceDay = targetDay
  const candidates = []

  if (state === RECOVERY_STATES.REQUIRED) {
    candidates.push({
      ...createGuidance({
        id: 'recovery-priority',
        level: GUIDANCE_LEVELS.COMMITMENT,
        reason: `Votre récupération est défavorable : ${strongSignals.map((signal) => signal.detail).join(', ')}.`,
        action: 'Privilégier une journée plus calme, éviter les efforts intenses et réévaluer demain.',
        confidence,
        sourceDay,
        domain: 'recovery',
      }),
      metric: 'recovery',
      mandatory: true,
      priorityClass: 'recovery',
      target: null,
    })
  } else if (state === RECOVERY_STATES.LOW) {
    candidates.push({
      ...createGuidance({
        id: 'recovery-light',
        level: GUIDANCE_LEVELS.ADVICE,
        reason: `Un signal de récupération est défavorable : ${strongSignals[0]?.detail || 'récupération partielle'}.`,
        action: 'Choisir une activité légère plutôt qu’intense et réévaluer demain.',
        confidence,
        sourceDay,
        domain: 'recovery',
      }),
      metric: 'recovery',
      mandatory: false,
      priorityClass: 'recovery',
      target: null,
    })
  } else if (state === RECOVERY_STATES.ACTIVE_READY) {
    candidates.push(
      createGuidance({
        id: 'recovery-active-ready',
        level: GUIDANCE_LEVELS.INFO,
        reason: 'Sommeil, stress et charge récente sont dans vos repères personnels.',
        action: 'Une activité normale est possible ; ce n’est pas un feu vert médical.',
        confidence,
        sourceDay,
        domain: 'recovery',
      }),
    )
  } else {
    candidates.push(
      createGuidance({
        id: lowQuality ? 'recovery-low-quality' : 'recovery-normal',
        level: GUIDANCE_LEVELS.INFO,
        reason: lowQuality
          ? 'La qualité des données réduit la fiabilité de cette évaluation de récupération.'
          : 'Aucun signal de récupération défavorable ne ressort aujourd’hui.',
        action: null,
        confidence,
        sourceDay,
        domain: 'recovery',
      }),
    )
  }

  return {
    state,
    lowQuality,
    reasons,
    signals: { sleep: { strong: sleepStrong, poor: sleepPoor }, stress, heart, loadHigh },
    confidence,
    blockers,
    candidates,
  }
}
