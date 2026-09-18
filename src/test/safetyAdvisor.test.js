import { describe, expect, it } from 'vitest'
import { assessSafety } from '../lib/advisor/safetyAdvisor'
import { GUIDANCE_LEVELS } from '../lib/advisor/guidanceLevels'

function addDays(day, offset) {
  const date = new Date(`${day}T00:00:00Z`)
  date.setUTCDate(date.getUTCDate() + offset)
  return date.toISOString().slice(0, 10)
}

function snapshot(day, { oxygen = null, bp = [], glucose = [], quality = 95, dayAgeDays = 0 } = {}) {
  return {
    day,
    activity: { steps: 5000, activeMinutes: 0, intensiveMinutes: 0 },
    heart: { samples: 0 },
    sleep: { minutes: null, sessions: 0 },
    oxygen: oxygen ? { minimum: oxygen.minimum, average: oxygen.average, samples: oxygen.samples ?? 20 } : { samples: 0 },
    stress: { samples: 0 },
    workouts: [],
    weight: null,
    bloodPressure: bp.length ? { systolic: bp.at(-1).systolic, diastolic: bp.at(-1).diastolic, readings: bp } : null,
    bloodGlucose: glucose.length ? { valueMgDl: glucose.at(-1).valueMgDl, readings: glucose } : null,
    quality: { score: quality },
    freshness: { dayAgeDays },
  }
}

const START = '2026-06-01'
const targetDay = addDays(START, 7)

function bpReading(day, { systolic, diastolic = 80, dateTime = 1, position = 0, measurementSite = 0, context = 0, irregularHeartbeat = false }) {
  return { day, dateTime, systolic, diastolic, position, measurementSite, context, irregularHeartbeat }
}

function glucoseReading(day, { valueMgDl, mealRelation = 1, mealType = 0, sampleSource = 0, dateTime = 1 }) {
  return { day, dateTime, valueMgDl, mealRelation, mealType, sampleSource }
}

describe('assessSafety — SpO2', () => {
  it('turns one unusual wearable value into a recheck, never a diagnosis', () => {
    const result = assessSafety({ snapshots: [snapshot(targetDay, { oxygen: { minimum: 91, average: 96 } })], targetDay })
    const spo2 = result.candidates.find((item) => item.domain === 'oxygen')
    expect(spo2.level).toBe(GUIDANCE_LEVELS.RECHECK)
    expect(spo2.evidenceId).toBe('fda-pulse-oximeter-2021')
    expect(JSON.stringify(spo2)).not.toMatch(/diagnosti|dose|insuline|traitement/i)
    expect(result.spo2.status).toBe('SINGLE_LOW')
  })

  it('escalates to monitor when low values repeat on several days', () => {
    const snapshots = [snapshot(addDays(targetDay, -1), { oxygen: { minimum: 90, average: 95 } }), snapshot(targetDay, { oxygen: { minimum: 91, average: 96 } })]
    const result = assessSafety({ snapshots, targetDay })
    expect(result.spo2.status).toBe('REPEATED_LOW')
    expect(result.candidates.find((item) => item.domain === 'oxygen').level).toBe(GUIDANCE_LEVELS.MONITOR)
  })

  it('stays silent without SpO2 data', () => {
    const result = assessSafety({ snapshots: [snapshot(targetDay)], targetDay })
    expect(result.candidates.filter((item) => item.domain === 'oxygen')).toHaveLength(0)
  })
})

describe('assessSafety — blood pressure', () => {
  it('distinguishes a single high reading (recheck) from repeated high readings (monitor)', () => {
    const single = assessSafety({ snapshots: [snapshot(targetDay, { bp: [bpReading(targetDay, { systolic: 150 })] })], targetDay })
    expect(single.candidates.find((item) => item.domain === 'bloodPressure').level).toBe(GUIDANCE_LEVELS.RECHECK)
    const repeated = assessSafety({
      snapshots: [snapshot(addDays(targetDay, -1), { bp: [bpReading(addDays(targetDay, -1), { systolic: 150 })] }), snapshot(targetDay, { bp: [bpReading(targetDay, { systolic: 150 })] })],
      targetDay,
    })
    expect(repeated.candidates.find((item) => item.domain === 'bloodPressure').level).toBe(GUIDANCE_LEVELS.MONITOR)
  })

  it('only uses SEEK_MEDICAL_ADVICE for repeated, clearly high readings and cites evidence', () => {
    const snapshots = [addDays(targetDay, -1), targetDay].map((day) => snapshot(day, { bp: [bpReading(day, { systolic: 170, diastolic: 105 })] }))
    const result = assessSafety({ snapshots, targetDay })
    const candidate = result.candidates.find((item) => item.domain === 'bloodPressure')
    expect(candidate.level).toBe(GUIDANCE_LEVELS.SEEK_MEDICAL_ADVICE)
    expect(candidate.evidenceId).toBe('who-hypertension-2021')
    expect(result.hasUrgent).toBe(true)
  })

  it('flags a device-reported irregular rhythm conservatively', () => {
    const result = assessSafety({ snapshots: [snapshot(targetDay, { bp: [bpReading(targetDay, { systolic: 120, irregularHeartbeat: true })] })], targetDay })
    const candidate = result.candidates.find((item) => item.id === 'safety-bp-irregular')
    expect(candidate.level).toBe(GUIDANCE_LEVELS.MONITOR)
    expect(candidate.evidenceId).toBe('ameli-palpitations')
  })
})

describe('assessSafety — blood glucose', () => {
  it('never mixes fasting and post-meal contexts', () => {
    const glucose = [glucoseReading(targetDay, { valueMgDl: 210, mealRelation: 1 }), glucoseReading(targetDay, { valueMgDl: 120, mealRelation: 2, dateTime: 2 })]
    const result = assessSafety({ snapshots: [snapshot(targetDay, { glucose })], targetDay })
    const candidates = result.candidates.filter((item) => item.domain === 'bloodGlucose')
    expect(candidates).toHaveLength(1)
    expect(candidates[0].detail.contextKey.startsWith('1|')).toBe(true)
    expect(candidates[0].level).toBe(GUIDANCE_LEVELS.RECHECK)
  })

  it('escalates repeated high values in the same context', () => {
    const glucoseAt = (day) => [glucoseReading(day, { valueMgDl: 260, mealRelation: 1 })]
    const snapshots = [snapshot(addDays(targetDay, -1), { glucose: glucoseAt(addDays(targetDay, -1)) }), snapshot(targetDay, { glucose: glucoseAt(targetDay) })]
    const result = assessSafety({ snapshots, targetDay })
    const candidate = result.candidates.find((item) => item.domain === 'bloodGlucose')
    expect(candidate.level).toBe(GUIDANCE_LEVELS.SEEK_MEDICAL_ADVICE)
    expect(candidate.evidenceId).toBe('who-diabetes-glycaemia')
  })

  it('handles missing context without inventing it', () => {
    const glucose = [{ day: targetDay, dateTime: 1, valueMgDl: 200 }]
    const result = assessSafety({ snapshots: [snapshot(targetDay, { glucose })], targetDay })
    const candidate = result.candidates.find((item) => item.domain === 'bloodGlucose')
    expect(candidate.detail.contextKey).toBe('n|n|n')
    expect(candidate.reason).toMatch(/contexte/i)
  })

  it('never emits dosing or treatment instructions', () => {
    const glucose = [glucoseReading(targetDay, { valueMgDl: 300, mealRelation: 1 })]
    const result = assessSafety({ snapshots: [snapshot(targetDay, { glucose })], targetDay })
    for (const candidate of result.candidates) {
      expect(`${candidate.reason} ${candidate.action}`).not.toMatch(/dose|insuline|traitement|comprimé|posologie/i)
    }
  })
})
