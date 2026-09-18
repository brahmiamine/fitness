import { beforeEach, describe, expect, it } from 'vitest'
import { clearImports } from '../lib/storage'
import {
  applyDerivedField,
  applyWatchDerivedField,
  createEmptyProfile,
  getFieldValue,
  getMissingRequiredFields,
  isProfileComplete,
  loadProfile,
  persistProfile,
  setProfileField,
  syncWeightFromHistory,
  toProfileContext,
} from '../lib/profile'
import { PROFILE_SOURCES } from '../lib/profileSchema'

beforeEach(async () => {
  await clearImports()
  await persistProfile(createEmptyProfile())
})

describe('personal health profile', () => {
  it('flags every required field as missing on an empty profile', () => {
    const profile = createEmptyProfile()
    expect(getMissingRequiredFields(profile)).toEqual(
      expect.arrayContaining(['sex', 'age', 'heightCm', 'weightKg']),
    )
    expect(isProfileComplete(profile)).toBe(false)
  })

  it('never guesses height: it stays unknown until the user answers', () => {
    let profile = createEmptyProfile()
    profile = setProfileField(profile, 'sex', 'male', PROFILE_SOURCES.USER)
    profile = setProfileField(profile, 'age', 32, PROFILE_SOURCES.USER)
    profile = setProfileField(profile, 'weightKg', 82, PROFILE_SOURCES.USER)
    expect(getMissingRequiredFields(profile)).toEqual(['heightCm'])
    expect(getFieldValue(profile, 'heightCm')).toBeNull()
  })

  it('rejects a source not allowed for a field (height can only come from the user)', () => {
    const profile = createEmptyProfile()
    expect(() => setProfileField(profile, 'heightCm', 180, PROFILE_SOURCES.WATCH)).toThrow()
  })

  it('rejects out-of-range values', () => {
    const profile = createEmptyProfile()
    expect(() => setProfileField(profile, 'age', 5, PROFILE_SOURCES.USER)).toThrow()
    expect(() => setProfileField(profile, 'sex', 'unknown', PROFILE_SOURCES.USER)).toThrow()
  })

  it('lets a fresh watch weight update the profile without touching the target weight', () => {
    let profile = createEmptyProfile()
    profile = setProfileField(profile, 'targetWeightKg', 75, PROFILE_SOURCES.USER)
    profile = applyWatchDerivedField(profile, 'weightKg', 81.4, { measuredAt: '2026-09-18T06:00:00.000Z' })
    expect(getFieldValue(profile, 'weightKg')).toBe(81.4)
    expect(profile.fields.weightKg.source).toBe(PROFILE_SOURCES.WATCH)
    expect(getFieldValue(profile, 'targetWeightKg')).toBe(75)
  })

  it('does not let an older watch reading override a newer explicit user entry', () => {
    let profile = createEmptyProfile()
    profile = setProfileField(profile, 'weightKg', 80, PROFILE_SOURCES.USER)
    const userUpdatedAt = profile.fields.weightKg.updatedAt
    profile = applyWatchDerivedField(profile, 'weightKg', 90, {
      measuredAt: new Date(new Date(userUpdatedAt).getTime() - 60_000).toISOString(),
    })
    expect(getFieldValue(profile, 'weightKg')).toBe(80)
  })

  it('picks the most recent weight row from history and ignores non-positive values', () => {
    let profile = createEmptyProfile()
    profile = syncWeightFromHistory(profile, [
      { dateTime: Date.parse('2026-09-10T08:00:00Z'), value: 83 },
      { dateTime: Date.parse('2026-09-17T08:00:00Z'), value: 81.8 },
      { dateTime: Date.parse('2026-09-18T08:00:00Z'), value: 0 },
    ])
    expect(getFieldValue(profile, 'weightKg')).toBe(81.8)
  })

  it('derived fields never override an explicit user choice', () => {
    let profile = createEmptyProfile()
    profile = setProfileField(profile, 'activityLevel', 'light', PROFILE_SOURCES.USER)
    profile = applyDerivedField(profile, 'activityLevel', 'very_active', 0.9)
    expect(getFieldValue(profile, 'activityLevel')).toBe('light')
  })

  it('exposes a flat context object for math/advisor engines', () => {
    let profile = createEmptyProfile()
    profile = setProfileField(profile, 'sex', 'male', PROFILE_SOURCES.USER)
    profile = setProfileField(profile, 'age', 32, PROFILE_SOURCES.USER)
    const context = toProfileContext(profile)
    expect(context).toMatchObject({ sex: 'male', age: 32, heightCm: null })
  })

  it('persists across reloads through local storage', async () => {
    let profile = createEmptyProfile()
    profile = setProfileField(profile, 'sex', 'male', PROFILE_SOURCES.USER)
    profile = setProfileField(profile, 'heightCm', 178, PROFILE_SOURCES.USER)
    await persistProfile(profile)

    const reloaded = await loadProfile()
    expect(getFieldValue(reloaded, 'sex')).toBe('male')
    expect(getFieldValue(reloaded, 'heightCm')).toBe(178)
  })

  it('tolerates unknown legacy fields when migrating a stored profile (schema evolution)', async () => {
    await persistProfile({
      schemaVersion: 0,
      fields: {
        age: { value: 32, source: 'user', updatedAt: '2026-01-01T00:00:00.000Z', confidence: null },
        someRemovedField: { value: 'x', source: 'user', updatedAt: '2026-01-01T00:00:00.000Z' },
      },
    })
    const reloaded = await loadProfile()
    expect(getFieldValue(reloaded, 'age')).toBe(32)
    expect(reloaded.fields).not.toHaveProperty('someRemovedField')
  })
})
