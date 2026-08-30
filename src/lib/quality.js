const TIMED_DOMAINS = ['records', 'heart', 'spo2', 'stress', 'sleep', 'sleepIntervals', 'weights', 'bloodPressure', 'bloodGlucose']

function rowsByDay(rows = []) {
  const result = new Map()
  for (const row of rows) {
    if (!row.day) continue
    result.set(row.day, (result.get(row.day) || 0) + 1)
  }
  return result
}

function duplicateCount(rows = [], keyFor) {
  let duplicates = 0
  let currentTimestamp = null
  const timestampKeys = new Set()
  for (const row of rows) {
    if (row.dateTime !== currentTimestamp) {
      currentTimestamp = row.dateTime
      timestampKeys.clear()
    }
    const key = keyFor(row)
    if (timestampKeys.has(key)) duplicates += 1
    else timestampKeys.add(key)
  }
  return duplicates
}

function overlapCount(intervals = []) {
  const sorted = [...intervals].filter((row) => row.start > 0 && row.end > 0).sort((a, b) => a.start - b.start)
  let overlaps = 0
  let latestEnd = 0
  for (const interval of sorted) {
    if (interval.start < latestEnd) overlaps += 1
    latestEnd = Math.max(latestEnd, interval.end)
  }
  return overlaps
}

function calendarGapCount(days = []) {
  const ordered = [...days].map((row) => row.day).filter(Boolean).sort()
  let gaps = 0
  for (let index = 1; index < ordered.length; index += 1) {
    const previous = Date.parse(`${ordered[index - 1]}T00:00:00Z`)
    const current = Date.parse(`${ordered[index]}T00:00:00Z`)
    if (Number.isFinite(previous) && Number.isFinite(current) && current - previous > 86_400_000) gaps += 1
  }
  return gaps
}

function check(id, title, count, severity, explanation, passText) {
  return {
    id,
    title,
    count,
    status: count ? severity : 'pass',
    explanation: count ? explanation : passText,
  }
}

function dailyTimezoneConflicts(dataset) {
  const byDay = new Map()
  for (const domain of TIMED_DOMAINS) {
    for (const row of dataset[domain] || []) {
      if (!row.day || !Number.isFinite(Number(row.tz))) continue
      if (!byDay.has(row.day)) byDay.set(row.day, new Set())
      byDay.get(row.day).add(Number(row.tz))
    }
  }
  return new Set([...byDay].filter(([, values]) => values.size > 1).map(([day]) => day))
}

function buildDailyQuality(dataset, anomalyDays) {
  const domainCoverage = Object.fromEntries(TIMED_DOMAINS.map((domain) => [domain, rowsByDay(dataset[domain])]))
  const activeDomains = TIMED_DOMAINS.filter((domain) => (dataset[domain] || []).length > 0)
  const sleepMetrics = new Map()
  for (const row of dataset.sleep || []) {
    const current = sleepMetrics.get(row.day) || { minutes: 0, window: 0, sessions: 0 }
    current.minutes += (row.light || 0) + (row.deep || 0) + (row.rem || 0)
    current.window += row.total || 0
    current.sessions += 1
    sleepMetrics.set(row.day, current)
  }
  return (dataset.days || []).map((day) => {
    const missingDomains = activeDomains.filter((domain) => !domainCoverage[domain].has(day.day))
    const anomalies = anomalyDays.get(day.day) || []
    const penalty = Math.min(60, missingDomains.length * 2 + anomalies.reduce((sum, item) => sum + item.penalty, 0))
    const score = Math.max(0, 100 - penalty)
    return {
      ...day,
      sleepMinutes: sleepMetrics.get(day.day)?.minutes || 0,
      sleepWindow: sleepMetrics.get(day.day)?.window || 0,
      sleepSessions: sleepMetrics.get(day.day)?.sessions || 0,
      heartSamples: domainCoverage.heart.get(day.day) || 0,
      spo2Samples: domainCoverage.spo2.get(day.day) || 0,
      stressSamples: domainCoverage.stress.get(day.day) || 0,
      recordSamples: domainCoverage.records.get(day.day) || 0,
      quality: {
        score,
        level: score >= 90 ? 'high' : score >= 70 ? 'medium' : 'low',
        missingDomains,
        anomalies: anomalies.map((item) => item.label),
      },
    }
  })
}

export function buildQualityReport(dataset) {
  const anomalyDays = new Map()
  const addAnomaly = (day, label, penalty) => {
    if (!day) return
    if (!anomalyDays.has(day)) anomalyDays.set(day, [])
    anomalyDays.get(day).push({ label, penalty })
  }

  let negativeSleepCount = 0
  const negativeSleepDays = new Set()
  for (const row of dataset.sleepIntervals || []) {
    if (row.end > row.start) continue
    negativeSleepCount += 1
    negativeSleepDays.add(row.day)
  }
  for (const day of negativeSleepDays) addAnomaly(day, 'Intervalle de sommeil nul ou négatif', 25)

  const sleepByDay = new Map()
  for (const row of dataset.sleepIntervals || []) {
    if (!sleepByDay.has(row.day)) sleepByDay.set(row.day, [])
    sleepByDay.get(row.day).push(row)
  }
  let sleepOverlaps = 0
  for (const [day, rows] of sleepByDay) {
    const count = overlapCount(rows)
    sleepOverlaps += count
    if (count) addAnomaly(day, `${count} chevauchement${count > 1 ? 's' : ''} de sommeil`, Math.min(20, count * 4))
  }

  const collectRangeIssues = (rows, invalid, label, penalty) => {
    let count = 0
    const days = new Set()
    for (const row of rows || []) {
      if (!invalid(row.value)) continue
      count += 1
      days.add(row.day)
    }
    for (const day of days) addAnomaly(day, label, penalty)
    return count
  }
  const heartOutliers = collectRangeIssues(dataset.heart, (value) => value < 25 || value > 250, 'Valeur cardiaque hors plage technique', 12)
  const oxygenOutliers = collectRangeIssues(dataset.spo2, (value) => value < 50 || value > 100, 'Valeur SpO₂ hors plage technique', 12)
  const stressOutliers = collectRangeIssues(dataset.stress, (value) => value < 0 || value > 100, 'Valeur de stress hors plage technique', 8)

  const duplicateHeart = duplicateCount(dataset.heart, (row) => `${row.dateTime}|${row.type}|${row.value}`)
  const duplicateOxygen = duplicateCount(dataset.spo2, (row) => `${row.dateTime}|${row.type}|${row.value}`)
  const duplicateStress = duplicateCount(dataset.stress, (row) => `${row.dateTime}|${row.type}|${row.value}`)
  const duplicateRecords = duplicateCount(dataset.records, (row) => `${row.dateTime}|${row.type}|${row.activityType}`)
  const duplicates = duplicateHeart + duplicateOxygen + duplicateStress + duplicateRecords

  const timezoneDays = dailyTimezoneConflicts(dataset)
  for (const day of timezoneDays) addAnomaly(day, 'Fuseaux horaires différents dans la journée', 6)

  const schemaAdjustments = dataset.metadata?.compatibility?.addedColumns?.length || 0
  const calendarGaps = calendarGapCount(dataset.days)
  const checks = [
    check('sleep-negative', 'Durées de sommeil valides', negativeSleepCount, 'error', 'Des intervalles finissent avant ou au même instant que leur début.', 'Aucune durée négative détectée.'),
    check('sleep-overlap', 'Intervalles de sommeil cohérents', sleepOverlaps, 'warning', 'Des stades de sommeil se chevauchent et peuvent gonfler les totaux.', 'Aucun chevauchement détecté.'),
    check('duplicates', 'Absence de doublons exacts', duplicates, 'warning', 'Des mesures strictement identiques partagent le même horodatage.', 'Aucun doublon exact détecté.'),
    check('heart-range', 'Plage technique cardiaque', heartOutliers, 'error', 'Certaines valeurs sont en dehors de la plage technique 25–250 bpm.', 'Toutes les valeurs sont dans la plage technique.'),
    check('oxygen-range', 'Plage technique SpO₂', oxygenOutliers, 'error', 'Certaines valeurs sont en dehors de la plage technique 50–100 %.', 'Toutes les valeurs sont dans la plage technique.'),
    check('stress-range', 'Plage technique du stress', stressOutliers, 'warning', 'Certaines valeurs sont en dehors de la plage 0–100.', 'Toutes les valeurs sont dans la plage technique.'),
    check('timezone', 'Fuseau horaire quotidien stable', timezoneDays.size, 'warning', 'Plusieurs décalages horaires apparaissent dans une même journée.', 'Le fuseau est cohérent à l’intérieur de chaque journée.'),
    check('schema', 'Compatibilité du schéma', schemaAdjustments, 'info', 'Le lecteur a neutralisé des colonnes absentes pour préserver l’import.', 'Le schéma reconnu est complet.'),
    check('calendar', 'Continuité du calendrier', calendarGaps, 'info', 'La sauvegarde contient des coupures entre certaines journées.', 'Aucune coupure entre les journées présentes.'),
  ]

  const errorCount = checks.filter((item) => item.status === 'error').reduce((sum, item) => sum + item.count, 0)
  const warningCount = checks.filter((item) => item.status === 'warning').reduce((sum, item) => sum + item.count, 0)
  const infoCount = checks.filter((item) => item.status === 'info').reduce((sum, item) => sum + item.count, 0)
  const score = Math.max(0, Math.round(100 - Math.min(45, errorCount * 12) - Math.min(30, warningCount * 3) - Math.min(10, infoCount)))

  return {
    score,
    level: score >= 90 ? 'high' : score >= 70 ? 'medium' : 'low',
    checks,
    summary: { errors: errorCount, warnings: warningCount, information: infoCount },
    days: buildDailyQuality(dataset, anomalyDays),
  }
}
