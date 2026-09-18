import { summarizeDay } from './analysis'

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
