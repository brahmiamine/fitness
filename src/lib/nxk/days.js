import { number } from './sqlHelpers'

function createAggregate() {
  return {
    steps: 0,
    calories: 0,
    distance: 0,
    heartSum: 0,
    heartCount: 0,
    spo2Sum: 0,
    spo2Count: 0,
    stressSum: 0,
    stressCount: 0,
    weightSum: 0,
    weightCount: 0,
    systolicSum: 0,
    diastolicSum: 0,
    bloodPressureCount: 0,
    glucoseSum: 0,
    glucoseCount: 0,
  }
}

export function buildDays(dayRows, records, heart, spo2, stress, sleep, collections = {}) {
  const byDay = new Map()
  for (const row of dayRows) {
    byDay.set(row.day, {
      day: row.day,
      steps: number(row.steps),
      calories: number(row.calories),
      activeMinutes: number(row.activeMinutes),
      intensiveMinutes: number(row.intensiveMinutes),
      pai: number(row.pai),
      paiEarned: number(row.paiEarned),
      distance: number(row.distance),
      heartAverage: number(row.hr),
      spo2Average: number(row.spo2),
      stressAverage: number(row.stress),
      weightAverage: 0,
      systolicAverage: 0,
      diastolicAverage: 0,
      glucoseAverage: 0,
    })
  }

  const aggregates = new Map()
  const aggregateFor = (day) => {
    if (!day) return null
    if (!aggregates.has(day)) aggregates.set(day, createAggregate())
    return aggregates.get(day)
  }
  for (const row of records) {
    const aggregate = aggregateFor(row.day)
    if (!aggregate) continue
    aggregate.steps += row.steps
    aggregate.calories += row.calories
    aggregate.distance += row.distance
  }
  for (const row of heart) {
    const aggregate = aggregateFor(row.day)
    if (aggregate && row.type === 0) {
      aggregate.heartSum += row.value
      aggregate.heartCount += 1
    }
  }
  for (const row of spo2) {
    const aggregate = aggregateFor(row.day)
    if (aggregate) {
      aggregate.spo2Sum += row.value
      aggregate.spo2Count += 1
    }
  }
  for (const row of stress) {
    const aggregate = aggregateFor(row.day)
    if (aggregate) {
      aggregate.stressSum += row.value
      aggregate.stressCount += 1
    }
  }
  for (const row of sleep) aggregateFor(row.day)

  const {
    workouts = [],
    gpsSummaries = [],
    weights = [],
    bloodPressure = [],
    bloodGlucose = [],
    notifications = [],
    battery = [],
  } = collections
  for (const row of weights || []) {
    const aggregate = aggregateFor(row.day)
    if (aggregate && row.value > 0) {
      aggregate.weightSum += row.value
      aggregate.weightCount += 1
    }
  }
  for (const row of bloodPressure || []) {
    const aggregate = aggregateFor(row.day)
    if (aggregate && row.systolic > 0 && row.diastolic > 0) {
      aggregate.systolicSum += row.systolic
      aggregate.diastolicSum += row.diastolic
      aggregate.bloodPressureCount += 1
    }
  }
  for (const row of bloodGlucose || []) {
    const aggregate = aggregateFor(row.day)
    if (aggregate && row.valueMgDl > 0) {
      aggregate.glucoseSum += row.valueMgDl
      aggregate.glucoseCount += 1
    }
  }
  for (const collection of [workouts, gpsSummaries, notifications, battery]) {
    for (const row of collection || []) aggregateFor(row.day)
  }

  for (const [day, aggregate] of aggregates) {
    if (!day) continue
    const existing = byDay.get(day) ?? { day }
    byDay.set(day, {
      ...existing,
      steps: existing.steps || aggregate.steps,
      calories: existing.calories || aggregate.calories,
      distance: existing.distance || aggregate.distance,
      heartAverage: existing.heartAverage || (aggregate.heartCount ? aggregate.heartSum / aggregate.heartCount : 0),
      spo2Average: existing.spo2Average || (aggregate.spo2Count ? aggregate.spo2Sum / aggregate.spo2Count : 0),
      stressAverage: existing.stressAverage || (aggregate.stressCount ? aggregate.stressSum / aggregate.stressCount : 0),
      weightAverage: aggregate.weightCount ? aggregate.weightSum / aggregate.weightCount : 0,
      systolicAverage: aggregate.bloodPressureCount ? aggregate.systolicSum / aggregate.bloodPressureCount : 0,
      diastolicAverage: aggregate.bloodPressureCount ? aggregate.diastolicSum / aggregate.bloodPressureCount : 0,
      glucoseAverage: aggregate.glucoseCount ? aggregate.glucoseSum / aggregate.glucoseCount : 0,
    })
  }
  return [...byDay.values()].sort((a, b) => b.day.localeCompare(a.day))
}
