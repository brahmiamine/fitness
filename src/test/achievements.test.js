import { describe, expect, it } from 'vitest'
import { parseAchievements } from '../lib/achievements'

describe('achievements', () => {
  it('decodes unlocked badges from appSetting rows without exposing unrelated settings', () => {
    const rows = [
      { name: 'ach-steps_sunday_sprinter-uAt', value: '1788062531505' },
      { name: 'ach-sleep_dream_architect-uAt', value: '1788155795640' },
      { name: 'ach-sleep_dream_architect-period', value: '2026-W36' },
      { name: 'ach-state-brokenStepsStreak', value: '1' },
      { name: 'pulsoidAccessToken', value: 'secret-token' },
      { name: 'ico_74FB177E2D9C_d1f4d84b1e2e647ebca3272b5828ff', value: 'true' },
    ]
    const badges = parseAchievements(rows)
    expect(badges).toHaveLength(2)
    expect(badges.map((badge) => badge.id)).toEqual(['sleep_dream_architect', 'steps_sunday_sprinter'])
    const dreamArchitect = badges.find((badge) => badge.id === 'sleep_dream_architect')
    expect(dreamArchitect.period).toBe('2026-W36')
    expect(dreamArchitect.categoryLabel).toBe('Sommeil')
    expect(JSON.stringify(badges)).not.toContain('secret-token')
  })

  it('ignores malformed or unlocked-at-zero entries', () => {
    expect(parseAchievements([{ name: 'ach-steps_x-uAt', value: '0' }])).toHaveLength(0)
    expect(parseAchievements([{ name: 'ach-steps_x-other', value: '123' }])).toHaveLength(0)
    expect(parseAchievements([])).toHaveLength(0)
  })

  it('falls back to a humanized label for unknown badge slugs', () => {
    const [badge] = parseAchievements([{ name: 'ach-cardio_new_badge_type-uAt', value: '100' }])
    expect(badge.label).toBe('New Badge Type')
    expect(badge.categoryLabel).toBe('Cardio')
  })
})
