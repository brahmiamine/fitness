import { describe, expect, it } from 'vitest'
import { buildDays } from '../lib/nxk/days'

describe('buildDays', () => {
  it('averages spo2 from raw samples even when the day table reports zero', () => {
    const dayRows = [{ day: '2026-08-30', steps: 100, calories: 10, activeMinutes: 5, intensiveMinutes: 0, pai: 0, paiEarned: 0, distance: 0, hr: 70, spo2: 0, stress: 20 }]
    const spo2 = [
      { day: '2026-08-30', value: 96 },
      { day: '2026-08-30', value: 98 },
    ]
    const [day] = buildDays(dayRows, [], [], spo2, [], [])
    expect(day.spo2Average).toBe(97)
  })

  it('computes daily averages for manual weight, blood pressure and glucose measurements', () => {
    const dayRows = [{ day: '2026-08-30', steps: 0, calories: 0, activeMinutes: 0, intensiveMinutes: 0, pai: 0, paiEarned: 0, distance: 0, hr: 0, spo2: 0, stress: 0 }]
    const weights = [{ day: '2026-08-30', value: 70 }, { day: '2026-08-30', value: 72 }]
    const bloodPressure = [{ day: '2026-08-30', systolic: 120, diastolic: 80 }]
    const bloodGlucose = [{ day: '2026-08-30', valueMgDl: 90 }]
    const [day] = buildDays(dayRows, [], [], [], [], [], { weights, bloodPressure, bloodGlucose })
    expect(day.weightAverage).toBe(71)
    expect(day.systolicAverage).toBe(120)
    expect(day.diastolicAverage).toBe(80)
    expect(day.glucoseAverage).toBe(90)
  })

  it('leaves manual measures at zero when no measurement exists for the day', () => {
    const dayRows = [{ day: '2026-08-30', steps: 0, calories: 0, activeMinutes: 0, intensiveMinutes: 0, pai: 0, paiEarned: 0, distance: 0, hr: 0, spo2: 0, stress: 0 }]
    const [day] = buildDays(dayRows, [], [], [], [], [])
    expect(day.weightAverage).toBe(0)
    expect(day.systolicAverage).toBe(0)
    expect(day.glucoseAverage).toBe(0)
  })
})
