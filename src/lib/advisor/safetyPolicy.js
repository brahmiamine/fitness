import { getEvidence } from './evidence/registry'
import { GUIDANCE_LEVELS, guidancePriority, isKnownGuidanceLevel } from './guidanceLevels'

/**
 * Best-effort language guardrail: catches the clearest ways a generated
 * text could cross from "advice" into diagnosis or medication guidance.
 * This is a safety net, not a substitute for writing careful copy in each
 * advisor — every advisor string should already respect these rules.
 */
const FORBIDDEN_PATTERNS = [
  { pattern: /\bvous (avez|souffrez d[e']|êtes atteint)\b.{0,40}\b(diabète|cancer|infection|maladie|trouble)\b/i, reason: 'formulation de diagnostic' },
  { pattern: /\bdiagnosti(c|que|quer)\b/i, reason: 'formulation de diagnostic' },
  { pattern: /\b(prenez|augmentez|réduisez|arrêtez)\b.{0,40}\b(dose|comprimé|médicament|insuline|traitement)\b/i, reason: 'consigne médicamenteuse' },
  { pattern: /\bchangez\b.{0,20}\b(votre )?(traitement|ordonnance|posologie)\b/i, reason: 'consigne médicamenteuse' },
]

export function assertSafeGuidanceText(text) {
  if (!text) return true
  for (const { pattern, reason } of FORBIDDEN_PATTERNS) {
    if (pattern.test(text)) {
      throw new Error(`Texte de conseil refusé (${reason} détectée) : "${text}"`)
    }
  }
  return true
}

/**
 * The only supported way to build a decision/advice object. Every advisor
 * in src/lib/advisor/** must go through this so the safety guarantees are
 * structural rather than a matter of remembering to check them each time:
 *
 * - an unknown evidence id fails loudly instead of silently citing nothing
 * - the guidance level must be one the cited evidence actually allows
 *   (e.g. sleep evidence cannot be used to justify SEEK_MEDICAL_ADVICE)
 * - reason/action text is screened for diagnosis/medication language
 */
export function createGuidance({
  id,
  level,
  reason,
  action = null,
  evidenceId = null,
  confidence = null,
  sourceDay = null,
  freshnessDays = null,
  domain = null,
}) {
  if (!id) throw new Error('createGuidance requiert un identifiant unique ("id").')
  if (!reason) throw new Error(`createGuidance("${id}") requiert un motif ("reason") expliquant la décision.`)
  if (!isKnownGuidanceLevel(level)) throw new Error(`Niveau de guidance inconnu pour "${id}" : "${level}".`)

  let evidence = null
  if (evidenceId) {
    evidence = getEvidence(evidenceId)
    if (!evidence) throw new Error(`createGuidance("${id}") référence une preuve inconnue : "${evidenceId}".`)
    if (!evidence.allowedActionClasses.includes(level)) {
      throw new Error(
        `createGuidance("${id}") : la preuve "${evidenceId}" n’autorise pas le niveau "${level}".`,
      )
    }
  }

  assertSafeGuidanceText(reason)
  assertSafeGuidanceText(action)

  return {
    id,
    level,
    domain: domain || evidence?.domain || null,
    reason,
    action,
    evidenceId,
    confidence,
    sourceDay,
    freshnessDays,
    priority: guidancePriority(level),
  }
}

export function sortGuidanceByPriority(items = []) {
  return [...items].sort((a, b) => guidancePriority(a.level) - guidancePriority(b.level))
}

export { GUIDANCE_LEVELS, guidancePriority }
