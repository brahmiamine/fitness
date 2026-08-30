import { describe, expect, it } from 'vitest'
import { partitionImport } from '../lib/storage'

describe('partitioned fitness storage', () => {
  it('keeps the manifest light and isolates detailed rows by day', () => {
    const item = {
      id: 'archive-1',
      schemaVersion: 3,
      importedAt: '2026-08-30T00:00:00.000Z',
      days: [{ day: '2026-08-30' }, { day: '2026-08-29' }],
      metadata: {},
      heart: [
        { day: '2026-08-30', value: 70 },
        { day: '2026-08-29', value: 65 },
      ],
      records: [{ day: '2026-08-30', steps: 10 }],
      notifications: [{ day: '2026-08-30', appName: 'mail', total: 4, filtered: 1 }],
      gpsPrivate: [{ day: '2026-08-30', latitude: 48.8, longitude: 2.3 }],
    }

    const { manifest, chunks } = partitionImport(item)

    expect(manifest.storageMode).toBe('day-partitioned')
    expect(manifest).not.toHaveProperty('heart')
    expect(manifest).not.toHaveProperty('gpsPrivate')
    expect(manifest.schemaVersion).toBe(4)
    expect(manifest.metadata.coverage.dayCount).toBe(2)
    expect(manifest.metadata.domainCounts.heart).toBe(2)
    expect(manifest.metadata.notificationApps[0].total).toBe(4)
    expect(chunks).toHaveLength(2)
    expect(chunks.find((chunk) => chunk.day === '2026-08-30').heart).toHaveLength(1)
    expect(chunks.find((chunk) => chunk.day === '2026-08-29').records).toHaveLength(0)
  })
})
