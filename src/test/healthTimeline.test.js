import { beforeEach, describe, expect, it } from 'vitest'
import { clearImports, listImports, saveImport } from '../lib/storage'
import { buildHealthTimeline, loadDailyHealthSnapshot, pickFreshestImport } from '../lib/healthTimeline'

beforeEach(async () => {
  await clearImports()
})

function makeImport({ id, importedAt, days, heart = [], records = [] }) {
  return {
    id,
    fileName: `${id}.nxk`,
    importedAt,
    schemaVersion: 5,
    metadata: {},
    days,
    heart,
    records,
    spo2: [],
    stress: [],
    sleep: [],
    sleepIntervals: [],
    workouts: [],
    weights: [],
    bloodPressure: [],
    bloodGlucose: [],
    notifications: [],
    battery: [],
    reminders: [],
  }
}

describe('pickFreshestImport', () => {
  it('picks the most recently imported backup', () => {
    const imports = [
      { id: 'a', importedAt: '2026-09-01T00:00:00.000Z' },
      { id: 'b', importedAt: '2026-09-15T00:00:00.000Z' },
    ]
    expect(pickFreshestImport(imports).id).toBe('b')
  })

  it('returns null for an empty list', () => {
    expect(pickFreshestImport([])).toBeNull()
  })
})

describe('longitudinal health timeline', () => {
  it('resolves an overlapping day to the freshest backup only (no mixing of old and new data)', async () => {
    await saveImport(
      makeImport({
        id: 'old-backup',
        importedAt: '2026-09-01T00:00:00.000Z',
        days: [{ day: '2026-09-10', steps: 1000 }],
        heart: [{ day: '2026-09-10', dateTime: 10, type: 0, value: 60 }],
      }),
    )
    await saveImport(
      makeImport({
        id: 'new-backup',
        importedAt: '2026-09-17T00:00:00.000Z',
        days: [{ day: '2026-09-10', steps: 9000 }, { day: '2026-09-11', steps: 4000 }],
        heart: [{ day: '2026-09-10', dateTime: 10, type: 0, value: 70 }],
      }),
    )

    const imports = await listImports()
    const snapshot = await loadDailyHealthSnapshot('2026-09-10', imports)
    expect(snapshot.activity.steps).toBe(9000)
    expect(snapshot.heart.average).toBe(70)
    expect(snapshot.source.importId).toBe('new-backup')
  })

  it('returns null for a day with no data in any stored backup', async () => {
    await saveImport(makeImport({ id: 'a', importedAt: '2026-09-01T00:00:00.000Z', days: [{ day: '2026-09-10', steps: 1 }] }))
    const imports = await listImports()
    expect(await loadDailyHealthSnapshot('2026-01-01', imports)).toBeNull()
  })

  it('builds a chronologically ordered snapshot per known day across multiple partial backups', async () => {
    await saveImport(
      makeImport({
        id: 'first-half',
        importedAt: '2026-09-01T00:00:00.000Z',
        days: [{ day: '2026-09-05', steps: 2000 }, { day: '2026-09-06', steps: 3000 }],
      }),
    )
    await saveImport(
      makeImport({
        id: 'second-half',
        importedAt: '2026-09-10T00:00:00.000Z',
        days: [{ day: '2026-09-07', steps: 4000 }],
      }),
    )

    const imports = await listImports()
    const timeline = await buildHealthTimeline(imports)
    expect(timeline.map((snapshot) => snapshot.day)).toEqual(['2026-09-05', '2026-09-06', '2026-09-07'])
    expect(timeline.map((snapshot) => snapshot.activity.steps)).toEqual([2000, 3000, 4000])
  })

  it('respects the fromDay/toDay window', async () => {
    await saveImport(
      makeImport({
        id: 'a',
        importedAt: '2026-09-01T00:00:00.000Z',
        days: [{ day: '2026-09-01', steps: 1 }, { day: '2026-09-05', steps: 2 }, { day: '2026-09-10', steps: 3 }],
      }),
    )
    const imports = await listImports()
    const timeline = await buildHealthTimeline(imports, { fromDay: '2026-09-02', toDay: '2026-09-09' })
    expect(timeline.map((snapshot) => snapshot.day)).toEqual(['2026-09-05'])
  })
})
