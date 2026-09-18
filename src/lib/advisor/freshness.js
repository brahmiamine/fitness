/**
 * Shared freshness helpers. NXK backups are imported data, never a live
 * stream, so every advisor that phrases something as "aujourd'hui" or
 * "maintenant" must derive that phrasing from the snapshot's import age
 * instead of assuming the target day is today.
 */

export const FRESHNESS_DEFAULTS = { freshDays: 1, staleDays: 7 }

export function dayAgeDays(snapshot) {
  const age = snapshot?.freshness?.dayAgeDays
  return Number.isFinite(age) ? age : null
}

/**
 * Human phrasing for the day a fact comes from, valid whether the import is
 * fresh or several days old.
 */
export function describeSourceDay(snapshot) {
  const age = dayAgeDays(snapshot)
  if (age == null) return 'la dernière journée importée'
  if (age <= 0) return "aujourd'hui"
  if (age === 1) return 'hier'
  if (age <= 6) return `il y a ${age} jours`
  return `le ${snapshot?.day || 'jour importé'}`
}

/** `true` only when the data is fresh enough to speak in the present tense. */
export function isFresh(snapshot, { freshDays = FRESHNESS_DEFAULTS.freshDays } = {}) {
  const age = dayAgeDays(snapshot)
  return age != null && age <= freshDays
}

/**
 * Multiplicative confidence penalty for stale imports. Fresh data keeps
 * full confidence; very old data bottoms out at 40 % so a strong decision
 * is never presented as if it were observed live.
 */
export function freshnessFactor(snapshot, options = {}) {
  const { freshDays = FRESHNESS_DEFAULTS.freshDays, staleDays = FRESHNESS_DEFAULTS.staleDays } = options
  const age = dayAgeDays(snapshot)
  if (age == null) return 1
  if (age <= freshDays) return 1
  if (age >= staleDays) return 0.4
  return 1 - ((age - freshDays) / (staleDays - freshDays)) * 0.6
}
