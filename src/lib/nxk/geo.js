import { localDateKey } from '../format'

function haversineDistance(first, second) {
  const radians = (value) => (value * Math.PI) / 180
  const earthRadius = 6_371_000
  const lat1 = radians(first.latitude)
  const lat2 = radians(second.latitude)
  const deltaLat = lat2 - lat1
  const deltaLng = radians(second.longitude - first.longitude)
  const value =
    Math.sin(deltaLat / 2) ** 2 +
    Math.cos(lat1) * Math.cos(lat2) * Math.sin(deltaLng / 2) ** 2
  return earthRadius * 2 * Math.atan2(Math.sqrt(value), Math.sqrt(1 - value))
}

export function summarizeGps(rows) {
  if (!rows.length) return null
  let maximumSpeed = 0
  let minimumAltitude = Number.POSITIVE_INFINITY
  let maximumAltitude = Number.NEGATIVE_INFINITY
  let pausedSamples = 0
  let distance = 0
  for (const row of rows) {
    maximumSpeed = Math.max(maximumSpeed, row.speed)
    minimumAltitude = Math.min(minimumAltitude, row.altitude)
    maximumAltitude = Math.max(maximumAltitude, row.altitude)
    if (row.pause) pausedSamples += 1
  }
  for (let index = 1; index < rows.length; index += 1) {
    const segment = haversineDistance(rows[index - 1], rows[index])
    if (segment < 100) distance += segment
  }
  const start = rows[0]
  const end = rows.at(-1)
  const durationMinutes = Math.max(0, (end.dateTime - start.dateTime) / 60_000)
  return {
    day: localDateKey(start.dateTime, start.tz),
    sampleCount: rows.length,
    start: start.dateTime,
    end: end.dateTime,
    timezone: start.tz,
    durationMinutes,
    distance,
    averageSpeed: durationMinutes ? (distance / (durationMinutes * 60)) * 3.6 : 0,
    maximumSpeed: maximumSpeed * 3.6,
    minimumAltitude,
    maximumAltitude,
    pausedSamples,
  }
}

export function summarizeGpsByDay(rows) {
  const byDay = new Map()
  for (const row of rows) {
    const day = localDateKey(row.dateTime, row.tz)
    if (!byDay.has(day)) byDay.set(day, [])
    byDay.get(day).push(row)
  }
  return [...byDay.values()].map(summarizeGps).filter(Boolean)
}
