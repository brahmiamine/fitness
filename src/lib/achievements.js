const BADGE_LABELS = {
  'recovery_ice_heart': { label: 'Cœur glacé', description: 'Récupération cardiaque rapide après un effort.' },
  'recovery_lazarus_return': { label: 'Retour de Lazare', description: 'Reprise d’activité après une longue pause.' },
  'steps_sunday_sprinter': { label: 'Sprinteur du dimanche', description: 'Journée de dimanche particulièrement active.' },
  'steps_accidental_marathoner': { label: 'Marathonien accidentel', description: 'Distance parcourue inhabituellement longue en une journée.' },
  'sleep_hibernating_bear': { label: 'Ours hibernant', description: 'Nuit de sommeil particulièrement longue.' },
  'sleep_rem_dj': { label: 'DJ du sommeil paradoxal', description: 'Proportion de sommeil paradoxal élevée.' },
  'sleep_dream_architect': { label: 'Architecte des rêves', description: 'Régularité du sommeil sur la période.' },
}

const CATEGORY_LABELS = {
  steps: 'Activité',
  sleep: 'Sommeil',
  recovery: 'Récupération',
  heart: 'Cœur',
  stress: 'Stress',
}

const ACHIEVEMENT_KEY_PATTERN = /^ach-([a-z]+)_([a-z0-9_]+)-uAt$/i

function humanizeSlug(slug) {
  return slug
    .split('_')
    .filter(Boolean)
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
    .join(' ')
}

function number(value, fallback = 0) {
  const parsed = Number(value)
  return Number.isFinite(parsed) ? parsed : fallback
}

/**
 * Notify conserve un système de badges dans `appSetting`, mêlé à des jetons de service tiers
 * (ex. Pulsoid) et à d’autres réglages internes. Seules les clés `ach-<catégorie>_<slug>-uAt`
 * sont lues ici : rien d’autre dans cette table n’est jamais extrait.
 */
export function parseAchievements(appSettingRows = []) {
  const byKey = new Map(appSettingRows.map((row) => [String(row.name ?? ''), row.value]))
  const badges = []

  for (const row of appSettingRows) {
    const name = String(row.name ?? '')
    const match = name.match(ACHIEVEMENT_KEY_PATTERN)
    if (!match) continue
    const [, category, slug] = match
    const unlockedAt = number(row.value)
    if (unlockedAt <= 0) continue
    const id = `${category}_${slug}`.toLocaleLowerCase()
    const known = BADGE_LABELS[id]
    const period = byKey.get(`ach-${id}-period`)
    badges.push({
      id,
      category: category.toLocaleLowerCase(),
      categoryLabel: CATEGORY_LABELS[category.toLocaleLowerCase()] || humanizeSlug(category),
      label: known?.label || humanizeSlug(slug),
      description: known?.description || '',
      unlockedAt,
      period: period ? String(period) : '',
    })
  }

  return badges.sort((a, b) => b.unlockedAt - a.unlockedAt)
}
