import { average, formatDuration, formatNumber, median } from './format'

export const SOURCES = {
  sleep: {
    label: 'Inserm — 7 à 9 heures chez l’adulte',
    href: 'https://presse.inserm.fr/sommeil-et-immunite-des-liens-etroits-des-les-premieres-annees-de-vie/',
  },
  activity: {
    label: 'OMS — recommandations d’activité physique',
    href: 'https://www.who.int/europe/publications/i/item/9789240014886',
  },
  oxygen: {
    label: 'FDA — limites de l’oxymétrie',
    href: 'https://www.fda.gov/medical-devices/products-and-medical-procedures/pulse-oximeters',
  },
  palpitations: {
    label: 'Assurance Maladie — palpitations',
    href: 'https://www.ameli.fr/assure/sante/themes/palpitations-cardiaques/bons-reflexes',
  },
}

export function preferredHeartSeries(rows) {
  const periodic = rows.filter((row) => row.type === 0 && row.value > 0)
  return periodic.length ? periodic : rows.filter((row) => row.value > 0)
}

function activityAround(timestamp, records, windowMinutes = 2) {
  const radius = windowMinutes * 60 * 1000
  return records
    .filter((row) => Math.abs(row.dateTime - timestamp) <= radius)
    .reduce((sum, row) => sum + (row.steps || 0), 0)
}

export function summarizeDay(dataset, dayKey) {
  const daily = dataset.days.find((day) => day.day === dayKey) ?? { day: dayKey }
  const heartRows = preferredHeartSeries(dataset.heart.filter((row) => row.day === dayKey))
  const spo2Rows = dataset.spo2.filter((row) => row.day === dayKey && row.value > 0)
  const stressRows = dataset.stress.filter((row) => row.day === dayKey && row.value > 0)
  const sleepRows = dataset.sleep.filter((row) => row.day === dayKey)
  const records = dataset.records.filter((row) => row.day === dayKey)
  const sleepMinutes = sleepRows.reduce(
    (sum, row) => sum + (row.light || 0) + (row.deep || 0) + (row.rem || 0),
    0,
  )
  const sleepWindow = sleepRows.reduce((sum, row) => sum + (row.total || 0), 0)
  const heartValues = heartRows.map((row) => row.value)
  const oxygenValues = spo2Rows.map((row) => row.value)
  const stressValues = stressRows.map((row) => row.value)
  const peakHeart = heartRows.reduce(
    (peak, row) => (!peak || row.value > peak.value ? row : peak),
    null,
  )

  return {
    ...daily,
    day: dayKey,
    sleepMinutes,
    sleepWindow,
    sleepSessions: sleepRows.length,
    heartAverage: heartValues.length ? average(heartValues) : 0,
    heartMedian: heartValues.length ? median(heartValues) : 0,
    heartMinimum: heartValues.length ? Math.min(...heartValues) : 0,
    heartMaximum: heartValues.length ? Math.max(...heartValues) : 0,
    heartSamples: heartValues.length,
    peakHeart,
    peakSteps: peakHeart ? activityAround(peakHeart.dateTime, records) : 0,
    spo2Average: oxygenValues.length ? average(oxygenValues) : 0,
    spo2Minimum: oxygenValues.length ? Math.min(...oxygenValues) : 0,
    spo2Maximum: oxygenValues.length ? Math.max(...oxygenValues) : 0,
    spo2Samples: oxygenValues.length,
    stressAverage: stressValues.length ? average(stressValues) : 0,
    stressMinimum: stressValues.length ? Math.min(...stressValues) : 0,
    stressMaximum: stressValues.length ? Math.max(...stressValues) : 0,
    stressSamples: stressValues.length,
  }
}

export function buildInsights(summary) {
  const insights = []

  if (summary.sleepMinutes) {
    if (summary.sleepMinutes < 360) {
      insights.push({
        id: 'sleep-low',
        level: 'attention',
        title: 'Sommeil nettement court',
        text: `${formatDuration(summary.sleepMinutes)} détectées. Le repère adulte général est de 7 à 9 heures sur 24 heures.`,
        source: SOURCES.sleep,
      })
    } else if (summary.sleepMinutes < 420) {
      insights.push({
        id: 'sleep-short',
        level: 'watch',
        title: 'Sommeil un peu court',
        text: `${formatDuration(summary.sleepMinutes)} détectées. Regardez surtout la tendance sur plusieurs nuits.`,
        source: SOURCES.sleep,
      })
    } else {
      insights.push({
        id: 'sleep-ok',
        level: 'positive',
        title: 'Durée de sommeil dans le repère courant',
        text: `${formatDuration(summary.sleepMinutes)} détectées. Les stades restent des estimations du bracelet.`,
        source: SOURCES.sleep,
      })
    }
  }

  if (summary.heartMaximum) {
    const duringMovement = summary.peakSteps >= 30
    insights.push({
      id: 'heart-peak',
      level: summary.heartMaximum > 180 && !duringMovement ? 'attention' : 'neutral',
      title: duringMovement ? 'Pic cardiaque associé à du mouvement' : 'Pic cardiaque sans contexte suffisant',
      text: `${formatNumber(summary.heartMaximum)} bpm au maximum${
        duringMovement ? `, avec ${formatNumber(summary.peakSteps)} pas autour de la mesure` : ''
      }. Un pic isolé au poignet peut être imprécis.`,
      source: SOURCES.palpitations,
    })
  }

  if (summary.spo2Samples) {
    insights.push({
      id: 'oxygen',
      level: summary.spo2Minimum < 90 ? 'attention' : summary.spo2Minimum < 95 ? 'watch' : 'positive',
      title: summary.spo2Minimum >= 95 ? 'Mesures d’oxygène stables' : 'Valeur basse à recontrôler',
      text: `${formatNumber(summary.spo2Minimum)} à ${formatNumber(summary.spo2Maximum)} %, sur ${formatNumber(
        summary.spo2Samples,
      )} mesures. Le bracelet ne remplace pas un oxymètre médical.`,
      source: SOURCES.oxygen,
    })
  }

  if ((summary.steps || 0) >= 10000) {
    insights.push({
      id: 'activity',
      level: 'positive',
      title: 'Journée très active',
      text: `${formatNumber(summary.steps)} pas enregistrés. La régularité hebdomadaire compte davantage qu’une seule journée.`,
      source: SOURCES.activity,
    })
  }

  return insights
}

export function buildHistoryTrend(items) {
  return items
    .flatMap((item) => item.days.map((day) => ({ importId: item.id, ...summarizeDay(item, day.day) })))
    .sort((a, b) => a.day.localeCompare(b.day))
}
