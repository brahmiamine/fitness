/**
 * Every decision the advisor produces is tagged with one of these levels.
 * Kept in its own module (no dependency on the evidence registry or the
 * safety policy) so both can import it without a circular dependency.
 */
export const GUIDANCE_LEVELS = {
  INFO: 'info',
  ADVICE: 'advice',
  COMMITMENT: 'commitment',
  RECHECK: 'recheck',
  MONITOR: 'monitor',
  SEEK_MEDICAL_ADVICE: 'seek_medical_advice',
}

/**
 * Safety and recheck guidance always outrank optimization/activity advice:
 * lower index = higher priority. Used by the arbitration engine (#24) to
 * decide which guidance wins when several apply on the same day.
 */
export const GUIDANCE_PRIORITY_ORDER = [
  GUIDANCE_LEVELS.SEEK_MEDICAL_ADVICE,
  GUIDANCE_LEVELS.RECHECK,
  GUIDANCE_LEVELS.MONITOR,
  GUIDANCE_LEVELS.COMMITMENT,
  GUIDANCE_LEVELS.ADVICE,
  GUIDANCE_LEVELS.INFO,
]

export function guidancePriority(level) {
  const index = GUIDANCE_PRIORITY_ORDER.indexOf(level)
  return index === -1 ? GUIDANCE_PRIORITY_ORDER.length : index
}

export function isKnownGuidanceLevel(level) {
  return Object.values(GUIDANCE_LEVELS).includes(level)
}
