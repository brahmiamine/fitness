import { describe, expect, it } from 'vitest'
import { describeRecordType, describeSportType } from '../lib/activityTypes'

describe('activityTypes', () => {
  it('describes the default record context without inventing a value', () => {
    expect(describeRecordType(0)).toBe('Suivi standard')
    expect(describeRecordType(2)).toBe('Suivi standard (contexte 2)')
    expect(describeRecordType(undefined)).toBe('Suivi standard')
  })

  it('prefers a user-provided workout title over the raw sport code', () => {
    expect(describeSportType(4, 'Course du matin')).toBe('Course du matin')
    expect(describeSportType(4, '')).toBe('Séance sportive (code 4)')
    expect(describeSportType(0, '')).toBe('Séance sans type enregistré')
  })
})
