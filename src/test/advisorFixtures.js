/**
 * Deterministic DailyHealthSnapshot fixtures shared by the advisor engine
 * and the end-to-end scenario suite (#28). No randomness, no real clock:
 * every value is derived from the day string so two runs are identical.
 */

function parse(day) {
  return Date.parse(`${day}T00:00:00Z`)
}

export function addDays(day, offset) {
  return new Date(parse(day) + offset * 86_400_000).toISOString().slice(0, 10)
}

function hourlyFrom(minuteSteps) {
  const hourly = new Array(24).fill(0)
  for (const [minute, steps] of minuteSteps) hourly[Math.floor(minute / 60)] += steps
  return hourly
}

export function daySnapshot(day, {
  steps = 6000,
  sleepMinutes = 480,
  bedtimeMinutes = 1380,
  wakeMinutes = 420,
  sessions = 1,
  heart = 60,
  heartSamples = 100,
  stress = 20,
  stressSamples = 100,
  spo2 = 97,
  spo2Samples = 20,
  workouts = [],
  weight = null,
  quality = 95,
  dayAgeDays = 0,
  minuteSteps = Array.from({ length: 15 }, (_, index) => [480 + index * 60, 100]),
  distanceMeters,
  bloodPressure = null,
  bloodGlucose = null,
} = {}) {
  const sorted = [...minuteSteps].sort((a, b) => a[0] - b[0])
  return {
    day,
    source: { importId: 'fixture', fileName: 'fixture.nxk', importedAt: '2026-09-18T08:00:00.000Z' },
    activity: {
      steps,
      calories: 2000,
      distanceMeters: distanceMeters === undefined ? steps * 0.7 : distanceMeters,
      activeMinutes: 40,
      intensiveMinutes: 10,
      pai: 5,
      paiEarned: 5,
      activeHours: new Set(sorted.map(([minute]) => Math.floor(minute / 60))).size,
      maximumMinuteSteps: sorted.reduce((max, [, value]) => Math.max(max, value), 0),
      minuteSteps: sorted,
      hourlySteps: hourlyFrom(sorted),
      hasMinuteData: sorted.length > 0,
    },
    heart: { average: heartSamples ? heart : 0, median: heart, minimum: heart - 10, maximum: heart + 20, samples: heartSamples, peak: null },
    sleep: {
      minutes: sessions ? sleepMinutes : 0,
      window: sessions ? sleepMinutes + 20 : 0,
      sessions,
      intervalsCount: sessions,
      bedtimeMinutes: sessions ? bedtimeMinutes : null,
      wakeMinutes: sessions ? wakeMinutes : null,
      hrAverage: 57,
      spo2Average: 96,
    },
    oxygen: {
      average: spo2Samples ? spo2 : 0,
      minimum: spo2Samples ? spo2 - 2 : 0,
      maximum: spo2Samples ? spo2 + 1 : 0,
      samples: spo2Samples,
      below95: spo2Samples && spo2 < 95 ? spo2Samples : 0,
    },
    stress: { average: stressSamples ? stress : 0, minimum: stress - 2, maximum: stress + 3, samples: stressSamples },
    workouts,
    weight: weight == null ? null : { valueKg: weight, measuredAt: parse(day) + 12 * 3_600_000 },
    bloodPressure,
    bloodGlucose,
    quality: { score: quality, level: quality >= 90 ? 'high' : quality >= 70 ? 'medium' : 'low', missingDomains: [], anomalies: [] },
    completeness: { domains: [], missing: [], ratio: 1, sampleCounts: {} },
    freshness: { importedAt: '2026-09-18T08:00:00.000Z', importAgeDays: 0, dayAgeDays },
    remindersConfigured: [],
  }
}

/**
 * Builds a timeline of `days` snapshots starting at `startDay`. `generator`
 * receives (index, day) and returns snapshot overrides.
 */
export function buildTimeline(startDay, days, generator = () => ({})) {
  return Array.from({ length: days }, (_, index) => {
    const day = addDays(startDay, index)
    return daySnapshot(day, generator(index, day))
  })
}
