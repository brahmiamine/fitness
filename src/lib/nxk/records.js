import { localDateKey } from '../format'
import { number } from './sqlHelpers'

export function normalizeTimedRows(rows) {
  return rows
    .map((row) => ({
      ...row,
      dateTime: number(row.dateTime),
      tz: number(row.tz),
      value: number(row.value),
      type: number(row.type),
      day: localDateKey(number(row.dateTime), number(row.tz)),
    }))
    .filter((row) => row.dateTime > 0)
}

export function normalizeRecords(rows) {
  return rows.map((row) => ({
    dateTime: number(row.dateTime),
    tz: number(row.tz),
    day: localDateKey(number(row.dateTime), number(row.tz)),
    type: number(row.type),
    steps: number(row.steps),
    calories: number(row.calories),
    activityType: number(row.activityType),
    distance: number(row.distance),
    heartRate: number(row.hr),
    spo2: number(row.spo2),
    stress: number(row.stress),
    energy: number(row.energy),
  }))
}

export function normalizeSleep(rows) {
  return rows.map((row) => {
    const light = number(row.light)
    const deep = number(row.deep)
    const rem = number(row.rem)
    const awake = number(row.awake)
    const asleep = light + deep + rem
    return {
      start: number(row.start),
      end: number(row.end),
      tz: number(row.tz),
      day: row.day || localDateKey(number(row.end), number(row.tz)),
      light,
      deep,
      rem,
      awake,
      total: number(row.total, asleep + awake),
      asleep,
      heartAverage: number(row.hrAvg),
      spo2Average: number(row.spo2Avg),
      modified: Boolean(row.userModified),
      turnOvers: number(row.turnOver),
    }
  })
}
