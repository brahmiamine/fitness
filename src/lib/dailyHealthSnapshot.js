import { summarizeDay } from './analysis'
import { localMinutes } from './format'

export const HEALTH_DOMAINS = [
  'records',
  'heart',
  'spo2',
  'stress',
  'sleep',
  'workouts',
  'weights',
  'bloodPressure',
  'bloodGlucose',
]

function latestByDateTime(rows = []) {
  return rows.reduce((latest, row) => (!latest || (row.dateTime || 0) > (latest.dateTime || 0) ? row : latest), null)
}

function domainSampleCounts(chunk) {
  return Object.fromEntries(HEALTH_DOMAINS.map((domain) => [domain, (chunk[domain] || []).length]))
}

/**
 * Compact minute-level movement trace for the day. Only minutes with at
 * least one recorded step are kept (sparse `[minuteOfDay, steps]` pairs),
 * so a full day costs a few hundred entries instead of 1 440. This is what
 * the sedentary/activity advisors (#17/#19) read; it stays additive so the
 * descriptive dashboards are unaffected.
 */
function buildMinuteMovement(records = []) {
  const minuteSteps = []
  const hourlySteps = new Array(24).fill(0)
  for (const row of records) {
    const steps = Number(row.steps) || 0
    if (steps <= 0 || !Number.isFinite(row.dateTime) || row.dateTime <= 0) continue
    const minute = Math.floor(localMinutes(row.dateTime, Number(row.tz) || 0))
    if (minute < 0 || minute >= 1440) continue
    minuteSteps.push([minute, steps])
    hourlySteps[Math.floor(minute / 60)] += steps
  }
  minuteSteps.sort((a, b) => a[0] - b[0])
  return { minuteSteps, hourlySteps, hasMinuteData: minuteSteps.length > 0 }
}

/**
 * Bedtime/wake clock positions and physiological context for the main
 * sleep session of the day. The main session is the one with the most
 * asleep minutes, so a nap never overrides the night. Values stay `null`
 * when the backup has no usable session, and the sleep advisor (#18) is
 * the only consumer.
 */
function buildSleepDetail(sleepRows = []) {
  const sessions = sleepRows.filter((row) => Number.isFinite(Number(row.start)) && Number.isFinite(Number(row.end)))
  if (!sessions.length) {
    return { bedtimeMinutes: null, wakeMinutes: null, hrAverage: null, spo2Average: null }
  }
  const asleepOf = (row) => (Number(row.light) || 0) + (Number(row.deep) || 0) + (Number(row.rem) || 0) || Number(row.asleep) || 0
  const main = sessions.reduce((best, row) => (asleepOf(row) > asleepOf(best) ? row : best), sessions[0])
  const tz = Number(main.tz) || 0
  return {
    bedtimeMinutes: Math.round(localMinutes(Number(main.start), tz)),
    wakeMinutes: Math.round(localMinutes(Number(main.end), tz)),
    hrAverage: Number.isFinite(Number(main.heartAverage)) && Number(main.heartAverage) > 0 ? Number(main.heartAverage) : null,
    spo2Average: Number.isFinite(Number(main.spo2Average)) && Number(main.spo2Average) > 0 ? Number(main.spo2Average) : null,
  }
}

function buildCompleteness(chunk) {
  const counts = domainSampleCounts(chunk)
  const present = HEALTH_DOMAINS.filter((domain) => counts[domain] > 0)
  const missing = HEALTH_DOMAINS.filter((domain) => counts[domain] === 0)
  return {
    domains: present,
    missing,
    ratio: HEALTH_DOMAINS.length ? present.length / HEALTH_DOMAINS.length : 0,
    sampleCounts: counts,
  }
}

function buildFreshness(day, source, now = Date.now()) {
  const importedAtMs = source?.importedAt ? Date.parse(source.importedAt) : NaN
  const dayMs = Date.parse(`${day}T00:00:00Z`)
  return {
    importedAt: source?.importedAt ?? null,
    importAgeDays: Number.isFinite(importedAtMs) ? Math.max(0, Math.round((now - importedAtMs) / 86_400_000)) : null,
    dayAgeDays: Number.isFinite(dayMs) ? Math.max(0, Math.round((now - dayMs) / 86_400_000)) : null,
  }
}

/**
 * Builds the canonical DailyHealthSnapshot for one day from the single
 * import chosen as authoritative for that day (see healthTimeline.js for
 * the freshest-import-wins selection policy). Reuses `summarizeDay` so the
 * numbers here never diverge from what the existing domain dashboards show.
 *
 * GPS is intentionally never read here: advisor calculations must never
 * depend on it (steps are the source of truth for distance/movement).
 */
export function buildDailyHealthSnapshot({ day, dayMeta, chunk, source, reminders = [] }) {
  const syntheticDataset = {
    days: [dayMeta || { day }],
    heart: chunk.heart || [],
    spo2: chunk.spo2 || [],
    stress: chunk.stress || [],
    sleep: chunk.sleep || [],
    records: chunk.records || [],
  }
  const summary = summarizeDay(syntheticDataset, day)
  const movement = buildMinuteMovement(chunk.records)
  const sleepDetail = buildSleepDetail(chunk.sleep)
  const latestWeight = latestByDateTime(chunk.weights)
  const latestBloodPressure = latestByDateTime(chunk.bloodPressure)
  const latestBloodGlucose = latestByDateTime(chunk.bloodGlucose)

  return {
    day,
    source: source ? { ...source } : null,
    activity: {
      steps: summary.steps || 0,
      calories: summary.calories || 0,
      distanceMeters: summary.distance || 0,
      activeMinutes: summary.activeMinutes || 0,
      intensiveMinutes: summary.intensiveMinutes || 0,
      pai: summary.pai || 0,
      paiEarned: summary.paiEarned || 0,
      activeHours: summary.activeHours || 0,
      maximumMinuteSteps: summary.maximumMinuteSteps || 0,
      minuteSteps: movement.minuteSteps,
      hourlySteps: movement.hourlySteps,
      hasMinuteData: movement.hasMinuteData,
    },
    heart: {
      average: summary.heartAverage || 0,
      median: summary.heartMedian || 0,
      minimum: summary.heartMinimum || 0,
      maximum: summary.heartMaximum || 0,
      samples: summary.heartSamples || 0,
      peak: summary.peakHeart ? { value: summary.peakHeart.value, timestamp: summary.peakHeart.dateTime, stepsAround: summary.peakSteps || 0 } : null,
    },
    sleep: {
      minutes: summary.sleepMinutes || 0,
      window: summary.sleepWindow || 0,
      sessions: summary.sleepSessions || 0,
      intervalsCount: (chunk.sleepIntervals || []).length,
      ...sleepDetail,
    },
    oxygen: {
      average: summary.spo2Average || 0,
      minimum: summary.spo2Minimum || 0,
      maximum: summary.spo2Maximum || 0,
      samples: summary.spo2Samples || 0,
      below95: summary.spo2Below95 || 0,
    },
    stress: {
      average: summary.stressAverage || 0,
      minimum: summary.stressMinimum || 0,
      maximum: summary.stressMaximum || 0,
      samples: summary.stressSamples || 0,
    },
    workouts: chunk.workouts || [],
    weight: latestWeight ? { valueKg: latestWeight.value, measuredAt: latestWeight.dateTime } : null,
    bloodPressure: latestBloodPressure
      ? { systolic: latestBloodPressure.systolic, diastolic: latestBloodPressure.diastolic, measuredAt: latestBloodPressure.dateTime, readings: chunk.bloodPressure }
      : null,
    bloodGlucose: latestBloodGlucose
      ? { valueMgDl: latestBloodGlucose.valueMgDl, measuredAt: latestBloodGlucose.dateTime, readings: chunk.bloodGlucose }
      : null,
    quality: dayMeta?.quality || null,
    completeness: buildCompleteness(chunk),
    freshness: buildFreshness(day, source),
    remindersConfigured: (reminders || []).filter((reminder) => reminder.enabled),
  }
}
