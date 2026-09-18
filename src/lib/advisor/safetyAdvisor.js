import { formatNumber } from '../format'
import { describeSourceDay, freshnessFactor } from './freshness'
import { GUIDANCE_LEVELS, guidancePriority } from './guidanceLevels'
import { createGuidance, sortGuidanceByPriority } from './safetyPolicy'

/**
 * Conservative safety/recheck advisor (#21). Higher-risk measurements
 * (wearable SpO2, cuff blood pressure, blood glucose) never produce a
 * diagnosis, a medication instruction or a treatment change. The strongest
 * output is an action class — INFO / RECHECK / MONITOR /
 * SEEK_MEDICAL_ADVICE — and every higher-risk action cites a versioned
 * evidence entry.
 *
 * A single unusual-looking reading only triggers a recheck; repetition in a
 * comparable context escalates the class. Glucose is always compared within
 * its recorded meal/context group, never fasting against post-meal.
 */
export const SAFETY_DEFAULTS = {
  repeatWindowDays: 7,
  repeatMinDays: 2,
  spo2RecheckMinimum: 92,
  spo2RecheckAverage: 94,
  bpSystolicRecheck: 140,
  bpDiastolicRecheck: 90,
  bpSystolicConcern: 160,
  bpDiastolicConcern: 100,
  glucoseRecheckMgDl: 180,
  glucoseConcernMgDl: 250,
}

const DAY_MS = 86_400_000

function dayDiff(day, targetDay) {
  const a = Date.parse(`${day}T00:00:00Z`)
  const b = Date.parse(`${targetDay}T00:00:00Z`)
  return Number.isFinite(a) && Number.isFinite(b) ? Math.round((b - a) / DAY_MS) : Number.POSITIVE_INFINITY
}

function confidenceFor(sampleCount, snapshot, minimum) {
  const sampleFactor = Math.min(1, sampleCount / minimum)
  return Math.round(Math.min(1, 0.4 + sampleFactor * 0.6) * freshnessFactor(snapshot) * 100) / 100
}

function assessSpo2(snapshots, targetDay, byDay, settings) {
  const target = byDay.get(targetDay)
  const oxygen = target?.oxygen
  const recent = snapshots.filter(
    (snapshot) => snapshot.day <= targetDay && dayDiff(snapshot.day, targetDay) <= settings.repeatWindowDays && (snapshot.oxygen?.samples || 0) > 0,
  )
  const lowDays = recent.filter(
    (snapshot) => snapshot.oxygen.minimum < settings.spo2RecheckMinimum || snapshot.oxygen.average < settings.spo2RecheckAverage,
  )
  const targetIsLow = Boolean(oxygen && oxygen.samples > 0 && (oxygen.minimum < settings.spo2RecheckMinimum || oxygen.average < settings.spo2RecheckAverage))
  if (!targetIsLow && lowDays.length < settings.repeatMinDays) {
    return { status: 'OK', lowDays: lowDays.map((snapshot) => snapshot.day), candidates: [] }
  }
  const repeated = lowDays.length >= settings.repeatMinDays
  const level = repeated ? GUIDANCE_LEVELS.MONITOR : GUIDANCE_LEVELS.RECHECK
  const confidence = confidenceFor(lowDays.length, target, 3)
  const phrase = describeSourceDay(target)
  const candidate = {
    ...createGuidance({
      id: repeated ? 'safety-spo2-monitor' : 'safety-spo2-recheck',
      level,
      reason: repeated
        ? `${lowDays.length} journées récentes présentent une SpO₂ basse selon ce bracelet (dernière valeur ${formatNumber(oxygen.minimum)} % au minimum).`
        : `Une valeur de SpO₂ basse (${formatNumber(oxygen.minimum)} % au minimum) ressort ${phrase}.`,
      action: repeated
        ? 'Continuer à recontrôler au repos et demander un avis médical en cas de répétition ou de symptômes signalés.'
        : 'Recontrôler la SpO₂ au repos, doigt immobile, avant toute interprétation.',
      evidenceId: 'fda-pulse-oximeter-2021',
      confidence,
      sourceDay: targetDay,
      domain: 'oxygen',
    }),
    metric: 'spo2',
    mandatory: true,
    target: null,
    detail: { lowDays: lowDays.map((snapshot) => snapshot.day), minimum: oxygen?.minimum ?? null, samples: oxygen?.samples ?? 0 },
  }
  return { status: repeated ? 'REPEATED_LOW' : 'SINGLE_LOW', lowDays: lowDays.map((snapshot) => snapshot.day), candidates: [candidate] }
}

function collectReadings(snapshots, targetDay, extractor, settings) {
  const entries = []
  for (const snapshot of snapshots) {
    if (snapshot.day > targetDay || dayDiff(snapshot.day, targetDay) > settings.repeatWindowDays) continue
    for (const reading of extractor(snapshot) || []) entries.push({ day: snapshot.day, ...reading })
  }
  return entries
}

function evaluateGroups(entries, { targetDay, contextKeyOf, abnormal, concern, settings }) {
  const groups = new Map()
  for (const entry of entries) {
    const key = contextKeyOf(entry)
    if (!groups.has(key)) groups.set(key, [])
    groups.get(key).push(entry)
  }
  const results = []
  for (const [contextKey, list] of groups) {
    const sorted = [...list].sort((a, b) => (a.dateTime || 0) - (b.dateTime || 0))
    const latest = sorted.at(-1)
    const abnormalDays = [...new Set(sorted.filter(abnormal).map((entry) => entry.day))].sort()
    if (!abnormal(latest)) continue
    const repeated = abnormalDays.length >= settings.repeatMinDays
    if (latest.day !== targetDay && !repeated) continue
    const level = repeated ? (concern(latest) ? GUIDANCE_LEVELS.SEEK_MEDICAL_ADVICE : GUIDANCE_LEVELS.MONITOR) : GUIDANCE_LEVELS.RECHECK
    results.push({ level, repeated, contextKey, latest, abnormalDays, sampleCount: sorted.length })
  }
  return results.sort((a, b) => guidancePriority(a.level) - guidancePriority(b.level))
}

function assessBloodPressure(snapshots, targetDay, byDay, settings) {
  const entries = collectReadings(
    snapshots,
    targetDay,
    (snapshot) => (snapshot.bloodPressure?.readings || []).map((reading) => ({ ...reading })),
    settings,
  )
  const abnormal = (reading) => reading.systolic >= settings.bpSystolicRecheck || reading.diastolic >= settings.bpDiastolicRecheck
  const concern = (reading) => reading.systolic >= settings.bpSystolicConcern || reading.diastolic >= settings.bpDiastolicConcern
  const results = evaluateGroups(entries, {
    targetDay,
    contextKeyOf: (reading) => `${reading.position ?? 'n'}|${reading.measurementSite ?? 'n'}|${reading.context ?? 'n'}`,
    abnormal,
    concern,
    settings,
  })
  const candidates = []
  const result = results[0]
  if (result) {
    const { latest, repeated, abnormalDays } = result
    const phrase = describeSourceDay(byDay.get(latest.day))
    const base = repeated
      ? `${abnormalDays.length} mesures élevées comparables ressortent sur ${abnormalDays.length} jours récents (dernière ${formatNumber(latest.systolic)}/${formatNumber(latest.diastolic)} mmHg).`
      : `Une mesure de tension ${formatNumber(latest.systolic)}/${formatNumber(latest.diastolic)} mmHg ressort ${phrase}.`
    candidates.push({
      ...createGuidance({
        id: result.level === GUIDANCE_LEVELS.SEEK_MEDICAL_ADVICE ? 'safety-bp-medical' : repeated ? 'safety-bp-monitor' : 'safety-bp-recheck',
        level: result.level,
        reason: base,
        action:
          result.level === GUIDANCE_LEVELS.SEEK_MEDICAL_ADVICE
            ? 'Recontrôler au repos et demander un avis médical, surtout si la répétition se confirme.'
            : repeated
              ? 'Poursuivre les mesures au repos dans le même contexte et demander un avis médical si la répétition se confirme.'
              : 'Recontrôler la tension au repos, dans les mêmes conditions, avant toute interprétation.',
        evidenceId: 'who-hypertension-2021',
        confidence: confidenceFor(result.sampleCount, byDay.get(latest.day), 4),
        sourceDay: latest.day,
        domain: 'bloodPressure',
      }),
      metric: 'bloodPressure',
      mandatory: true,
      target: null,
      detail: { abnormalDays, contextKey: result.contextKey, systolic: latest.systolic, diastolic: latest.diastolic },
    })
  }

  const irregular = [...entries].filter((entry) => entry.irregularHeartbeat).sort((a, b) => (a.dateTime || 0) - (b.dateTime || 0)).at(-1)
  if (irregular) {
    candidates.push(
      createGuidance({
        id: 'safety-bp-irregular',
        level: GUIDANCE_LEVELS.MONITOR,
        reason: 'Le bracelet a signalé un rythme irrégulier pendant une mesure de tension.',
        action: 'Recontrôler au calme et demander un avis médical si cette indication se répète.',
        evidenceId: 'ameli-palpitations',
        confidence: 0.5,
        sourceDay: irregular.day,
        domain: 'heart',
      }),
    )
  }

  return { status: result ? (result.repeated ? 'REPEATED_HIGH' : 'SINGLE_HIGH') : 'OK', results, candidates }
}

function assessBloodGlucose(snapshots, targetDay, byDay, settings) {
  const entries = collectReadings(
    snapshots,
    targetDay,
    (snapshot) => (snapshot.bloodGlucose?.readings || []).map((reading) => ({ ...reading })),
    settings,
  )
  const abnormal = (reading) => reading.valueMgDl >= settings.glucoseRecheckMgDl
  const concern = (reading) => reading.valueMgDl >= settings.glucoseConcernMgDl
  const results = evaluateGroups(entries, {
    targetDay,
    contextKeyOf: (reading) => `${reading.mealRelation ?? 'n'}|${reading.mealType ?? 'n'}|${reading.sampleSource ?? 'n'}`,
    abnormal,
    concern,
    settings,
  })
  const result = results[0]
  if (!result) return { status: 'OK', results, candidates: [] }
  const { latest, repeated, abnormalDays } = result
  const phrase = describeSourceDay(byDay.get(latest.day))
  const candidate = {
    ...createGuidance({
      id: result.level === GUIDANCE_LEVELS.SEEK_MEDICAL_ADVICE ? 'safety-glucose-medical' : repeated ? 'safety-glucose-monitor' : 'safety-glucose-recheck',
      level: result.level,
      reason: repeated
        ? `${abnormalDays.length} mesures de glycémie élevées dans le même contexte de repas ressortent sur ${abnormalDays.length} jours récents.`
        : `Une glycémie de ${formatNumber(latest.valueMgDl)} mg/dL ressort ${phrase}, dans le contexte de mesure enregistré (repas/à jeun).`,
      action:
        result.level === GUIDANCE_LEVELS.SEEK_MEDICAL_ADVICE
          ? 'Recontrôler dans le même contexte (avant/après repas) et demander un avis médical si la répétition se confirme.'
          : repeated
            ? 'Continuer à mesurer dans le même contexte de repas et demander un avis médical si la répétition se confirme.'
            : 'Recontrôler la glycémie dans le même contexte (repas/à jeun) avant toute interprétation.',
      evidenceId: 'who-diabetes-glycaemia',
      confidence: confidenceFor(result.sampleCount, byDay.get(latest.day), 4),
      sourceDay: latest.day,
      domain: 'bloodGlucose',
    }),
    metric: 'bloodGlucose',
    mandatory: true,
    target: null,
    detail: { abnormalDays, contextKey: result.contextKey, valueMgDl: latest.valueMgDl },
  }
  return { status: result.repeated ? 'REPEATED_HIGH' : 'SINGLE_HIGH', results, candidates: [candidate] }
}

export function assessSafety({ snapshots, targetDay, options = {} } = {}) {
  const settings = { ...SAFETY_DEFAULTS, ...options }
  const byDay = new Map(snapshots.map((snapshot) => [snapshot.day, snapshot]))
  const spo2 = assessSpo2(snapshots, targetDay, byDay, settings)
  const bloodPressure = assessBloodPressure(snapshots, targetDay, byDay, settings)
  const bloodGlucose = assessBloodGlucose(snapshots, targetDay, byDay, settings)
  const candidates = sortGuidanceByPriority([...spo2.candidates, ...bloodPressure.candidates, ...bloodGlucose.candidates])
  const hasUrgent = candidates.some((candidate) => candidate.level === GUIDANCE_LEVELS.SEEK_MEDICAL_ADVICE)
  const needsRecheck = candidates.some((candidate) => candidate.level === GUIDANCE_LEVELS.RECHECK || candidate.level === GUIDANCE_LEVELS.MONITOR)
  return {
    domain: 'safety',
    day: targetDay,
    spo2,
    bloodPressure,
    bloodGlucose,
    candidates,
    hasUrgent,
    needsRecheck,
  }
}
