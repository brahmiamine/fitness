import { describe, expect, it } from 'vitest'
import { parseAppStats } from '../lib/appStats'

describe('appStats', () => {
  it('groups the two internal counters per application without summing them', () => {
    const rows = [
      { name: '1_com.facebook.orca', type: 1, notificationCounter: 12, notificationTotalCounter: 12 },
      { name: '3_com.facebook.orca', type: 3, notificationCounter: 12, notificationTotalCounter: 12 },
      { name: '1_com.google.android.gm', type: 1, notificationCounter: 21, notificationTotalCounter: 21 },
    ]
    const result = parseAppStats(rows)
    expect(result).toHaveLength(2)
    const messenger = result.find((item) => item.appName === 'com.facebook.orca')
    expect(messenger.counters).toEqual({ 1: 12, 3: 12 })
    const gmail = result.find((item) => item.appName === 'com.google.android.gm')
    expect(gmail.counters).toEqual({ 1: 21 })
  })

  it('sorts applications by their combined counter total, descending', () => {
    const rows = [
      { name: '1_low', type: 1, notificationCounter: 1, notificationTotalCounter: 1 },
      { name: '1_high', type: 1, notificationCounter: 50, notificationTotalCounter: 50 },
    ]
    const result = parseAppStats(rows)
    expect(result.map((item) => item.appName)).toEqual(['high', 'low'])
  })

  it('returns an empty list for no rows', () => {
    expect(parseAppStats([])).toEqual([])
  })
})
