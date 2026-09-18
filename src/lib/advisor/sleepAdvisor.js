import { formatClockMinute, median } from '../format'
import { computeMetricBaseline, deviationFromWindow } from './baselines'
import { describeSourceDay, freshnessFactor, isFresh } from './freshness'
import { GUIDANCE_LEVELS } from './guidanceLevels'
import { createGuidance } from './safetyPolicy'

/**
 * Personalized sleep advisor (#18). Turns the sleep history already
 * normalized into DailyHealthSnapshot into bounded, explainable decisions:
 * one bad night yields advice, repeated short nights yield a commitment and
 * a rolling-plan candidate, and a normal night yields no correction.
 *
 * Watch sleep stages remain estimates: this module never claims clinical
 * staging and always exposes the calculation basis for a target bedtime.
 */
export const SLEEP_DEFAULTS = {
  shortRatio: 0.85,
  populationShortMinutes: 420,
  sustainedNights: 3,
  bedtimeDriftMinutes: 45,
  irregularityMinutes: 60,
  desiredMinimumMinutes: 420,
  desiredMaximumMinutes: 540,
  populationTargetMinutes: 450,
  lookbackNights: 10,
}

const DAY_MS = 86_400_000

function shiftDay(day, offset) {
  return new Date(Date.parse(`${day}T00:00:00Z`) + offset * DAY_MS).toISOString().slice(0, 10)
}

function sleepMinutesOf(snapshot) {
  const sleep = snapshot?.sleep
  if (!sleep || !sleep.sessions) return null
  const minutes = Number(sleep.minutes)
  return Number.isFinite(minutes) && minutes > 0 ? minutes : null
}

function circularDifference(value, reference) {
  let difference = value - reference
  if (difference > 720) difference -= 1440
  if (difference < -720) difference += 1440
  return difference
}

function circularMad(values) {
  if (values.length < 2) return 0
  const center = median(values)
  const deviations = values.map((value) => Math.abs(circularDifference(value, center)))
  return median(deviations)
}

function isShortNight(snapshots, day, options) {
  const byDay = new Map(snapshots.map((snapshot) => [snapshot.day, snapshot]))
  const snapshot = byDay.get(day)
  const minutes = sleepMinutesOf(snapshot)
  if (minutes == null) return false
  const baseline = computeMetricBaseline(snapshots, day, 'sleepMinutes', options)
  const window = baseline.windows.rolling7
  if (window.ready && window.median) {
    const deviation = deviationFromWindow(minutes, window)
    return (deviation?.robustScore ?? 0) <= -1 || minutes < window.median * SLEEP_DEFAULTS.shortRatio
  }
  return minutes < SLEEP_DEFAULTS.populationShortMinutes
}

function recentValues(snapshots, targetDay, extractor, { nights = 7, qualityThreshold = 50 } = {}) {
  const byDay = new Map(snapshots.map((snapshot) => [snapshot.day, snapshot]))
  const values = []
  for (let back = 0; back < nights; back += 1) {
    const snapshot = byDay.get(shiftDay(targetDay, -back))
    if (!snapshot) continue
    const score = snapshot.quality?.score
    if (score != null && score < qualityThreshold) continue
    const value = extractor(snapshot)
    if (value != null) values.push(value)
  }
  return values
}

function targetBedtime(snapshots, targetDay, options) {
  const wakeValues = recentValues(snapshots, targetDay, (snapshot) => snapshot.sleep?.wakeMinutes)
  const bedtimeValues = recentValues(snapshots, targetDay, (snapshot) => snapshot.sleep?.bedtimeMinutes)
  const baseline = computeMetricBaseline(snapshots, targetDay, 'sleepMinutes', options)
  const personal = baseline.windows.rolling28.ready ? baseline.windows.rolling28.median : baseline.windows.rolling7.ready ? baseline.windows.rolling7.median : null
  const desiredMinutes = personal
    ? Math.max(SLEEP_DEFAULTS.desiredMinimumMinutes, Math.min(SLEEP_DEFAULTS.desiredMaximumMinutes, personal))
    : SLEEP_DEFAULTS.populationTargetMinutes
  const wakeMinute = wakeValues.length ? median(wakeValues) : null
  return {
    wakeMinute,
    bedtimeMinute: bedtimeValues.length ? median(bedtimeValues) : null,
    desiredMinutes,
    targetMinute: wakeMinute == null ? null : Math.round(((wakeMinute - desiredMinutes) % 1440 + 1440) % 1440),
    basis: {
      source: personal ? 'personal_baseline' : 'population_guardrail',
      desiredMinutes,
      wakeMinute,
      samples: wakeValues.length,
    },
  }
}

export function assessSleep({ snapshots, targetDay, options = {} } = {}) {
  const settings = { ...SLEEP_DEFAULTS, ...options }
  const byDay = new Map(snapshots.map((snapshot) => [snapshot.day, snapshot]))
  const daySnapshot = byDay.get(targetDay) || null
  const minutes = sleepMinutesOf(daySnapshot)
  const baseline = computeMetricBaseline(snapshots, targetDay, 'sleepMinutes', options)
  const window = baseline.windows.rolling7
  const quality = daySnapshot?.quality?.score ?? null
  const lowQuality = quality != null && quality < 50
  const confidence = Math.round(
    Math.min(1, (window.sampleCount / 14) * 0.7 + (minutes != null ? 0.3 : 0)) * freshnessFactor(daySnapshot) * (lowQuality ? 0.5 : 1) * 100,
  ) / 100
  const sourceDay = targetDay
  const candidates = []

  if (minutes == null) {
    candidates.push(
      createGuidance({
        id: 'sleep-insufficient',
        level: GUIDANCE_LEVELS.INFO,
        reason: 'Aucune durée de sommeil exploitable n’est disponible pour cette journée.',
        confidence,
        sourceDay,
        domain: 'sleep',
      }),
    )
    return { status: 'INSUFFICIENT', day: targetDay, minutes: null, lowQuality, targetBedtime: targetBedtime(snapshots, targetDay, options), consecutiveShortNights: 0, recoveryPressure: false, confidence, candidates }
  }

  let consecutiveShortNights = 0
  let firstShortDay = null
  for (let back = 0; back < settings.lookbackNights; back += 1) {
    const day = shiftDay(targetDay, -back)
    if (!byDay.has(day) || !isShortNight(snapshots, day, options)) break
    consecutiveShortNights += 1
    firstShortDay = day
  }

  const bedtimeValues = recentValues(snapshots, targetDay, (snapshot) => snapshot.sleep?.bedtimeMinutes)
  const regularityMinutes = Math.round(circularMad(bedtimeValues))
  const target = targetBedtime(snapshots, targetDay, options)

  const recentBedtimes = bedtimeValues.slice(0, 3)
  const olderBedtimes = bedtimeValues.slice(3)
  let bedtimeDriftMinutes = 0
  if (recentBedtimes.length && olderBedtimes.length >= 3) {
    bedtimeDriftMinutes = Math.round(circularDifference(median(recentBedtimes), median(olderBedtimes)))
  }

  const deviation = deviationFromWindow(minutes, window)
  const recoveryPressure = consecutiveShortNights >= settings.sustainedNights || (deviation?.robustScore ?? 0) <= -2

  let status = 'NORMAL'
  if (lowQuality) status = 'LOW_QUALITY'
  else if (consecutiveShortNights >= settings.sustainedNights) status = 'SLEEP_PRIORITY'
  else if (consecutiveShortNights >= 1) status = 'SHORT_NIGHT'

  if (lowQuality) {
    candidates.push(
      createGuidance({
        id: 'sleep-low-quality',
        level: GUIDANCE_LEVELS.INFO,
        reason: 'La qualité de cette journée est trop faible pour recommander un changement de sommeil fiable.',
        action: null,
        confidence,
        sourceDay,
        domain: 'sleep',
      }),
    )
  } else if (status === 'SLEEP_PRIORITY') {
    candidates.push({
      ...createGuidance({
        id: 'sleep-priority',
        level: GUIDANCE_LEVELS.COMMITMENT,
        reason: `${consecutiveShortNights} nuits consécutives sont sous votre repère personnel de sommeil.`,
        action: `Prioriser le sommeil cette nuit et viser un coucher vers ${formatClockMinute(target.targetMinute)}.`,
        evidenceId: 'inserm-sleep-duration',
        confidence,
        sourceDay,
        domain: 'sleep',
      }),
      metric: 'sleep',
      mandatory: true,
      target: { kind: 'bedtime', minute: target.targetMinute, basis: target.basis },
      period: firstShortDay ? { start: firstShortDay, end: targetDay } : null,
    })
  } else if (status === 'SHORT_NIGHT') {
    candidates.push({
      ...createGuidance({
        id: 'sleep-tonight',
        level: GUIDANCE_LEVELS.ADVICE,
        reason: `${consecutiveShortNights} nuit${consecutiveShortNights > 1 ? 's' : ''} plus courte${consecutiveShortNights > 1 ? 's' : ''} que votre repère personnel a été détectée${consecutiveShortNights > 1 ? 's' : ''}, ${describeSourceDay(daySnapshot)}.`,
        action: `Viser un coucher vers ${formatClockMinute(target.targetMinute)} ce soir, sans en faire une obligation.`,
        evidenceId: 'inserm-sleep-duration',
        confidence,
        sourceDay,
        domain: 'sleep',
      }),
      metric: 'sleep',
      mandatory: false,
      target: { kind: 'bedtime', minute: target.targetMinute, basis: target.basis },
    })
  }

  if (!lowQuality && bedtimeDriftMinutes >= settings.bedtimeDriftMinutes) {
    candidates.push({
      ...createGuidance({
        id: 'sleep-wind-down',
        level: GUIDANCE_LEVELS.ADVICE,
        reason: `Votre heure de coucher dérive d’environ ${bedtimeDriftMinutes} minutes plus tard que votre habitude.`,
        action: `Commencer la transition vers le sommeil plus tôt ce soir, autour de ${formatClockMinute(target.targetMinute)}.`,
        evidenceId: 'inserm-sleep-duration',
        confidence,
        sourceDay,
        domain: 'sleep',
      }),
      metric: 'sleep',
      mandatory: false,
      target: null,
    })
  }

  if (!lowQuality && regularityMinutes >= settings.irregularityMinutes) {
    candidates.push({
      ...createGuidance({
        id: 'sleep-regularity',
        level: GUIDANCE_LEVELS.ADVICE,
        reason: `Vos heures de coucher varient d’environ ${regularityMinutes} minutes autour de votre médiane personnelle.`,
        action: 'Garder une heure de coucher proche de votre repère habituel cette semaine.',
        evidenceId: 'inserm-sleep-duration',
        confidence,
        sourceDay,
        domain: 'sleep',
      }),
      metric: 'sleep',
      mandatory: false,
      target: null,
    })
  }

  if (!candidates.length) {
    candidates.push(
      createGuidance({
        id: 'sleep-ok',
        level: GUIDANCE_LEVELS.INFO,
        reason: 'Durée et régularité du sommeil dans votre repère personnel.',
        action: 'Aucune correction de sommeil n’est nécessaire.',
        confidence,
        sourceDay,
        domain: 'sleep',
      }),
    )
  }

  return {
    status,
    day: targetDay,
    minutes,
    baseline: window,
    deviation,
    lowQuality,
    targetBedtime: target,
    consecutiveShortNights,
    consecutiveShortNightsPeriod: firstShortDay ? { start: firstShortDay, end: targetDay } : null,
    bedtimeDriftMinutes,
    regularityMinutes,
    recoveryPressure,
    isFresh: isFresh(daySnapshot),
    confidence,
    candidates,
  }
}
