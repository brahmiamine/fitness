import { GUIDANCE_LEVELS, guidancePriority } from './guidanceLevels'

/**
 * Decision arbitration, priority and daily-commitment engine (#24).
 * Collects candidate decisions from every domain advisor and
 * deterministically chooses the small set that matters most:
 *
 *   safety/recheck → recovery → sleep → activity/workout → optimization
 *
 * Safety always outranks optimization, recovery defers a workout, at most
 * three priority commitments are selected, zero commitments is a valid
 * outcome, and the same input always produces the same output.
 */
export const MAX_COMMITMENTS = 3

export const DECISION_STATUS = {
  TO_DO: 'TO_DO',
  IN_PROGRESS: 'IN_PROGRESS',
  DONE: 'DONE',
  DEFERRED_BY_SAFETY: 'DEFERRED_BY_SAFETY',
  NOT_NEEDED: 'NOT_NEEDED',
}

const COMMITMENT_LEVELS = new Set([
  GUIDANCE_LEVELS.SEEK_MEDICAL_ADVICE,
  GUIDANCE_LEVELS.RECHECK,
  GUIDANCE_LEVELS.MONITOR,
  GUIDANCE_LEVELS.COMMITMENT,
])

const CLASS_ORDER = { safety: 0, recovery: 1, sleep: 2, activity: 3, general: 4 }

export function priorityClassOf(domain, level) {
  if ([GUIDANCE_LEVELS.SEEK_MEDICAL_ADVICE, GUIDANCE_LEVELS.RECHECK, GUIDANCE_LEVELS.MONITOR].includes(level)) return 'safety'
  if (domain === 'recovery') return 'recovery'
  if (domain === 'sleep') return 'sleep'
  if (domain === 'activity') return 'activity'
  return 'general'
}

function normalize(text) {
  return String(text || '').trim().toLowerCase()
}

function toDecision(candidate, { generatedAt, targetSnapshot }) {
  const actionClass = candidate.level
  const deferred = Array.isArray(candidate.deferredBy) && candidate.deferredBy.length > 0
  const status = actionClass === GUIDANCE_LEVELS.INFO
    ? DECISION_STATUS.NOT_NEEDED
    : deferred
      ? DECISION_STATUS.DEFERRED_BY_SAFETY
      : DECISION_STATUS.TO_DO
  const priorityClass = priorityClassOf(candidate.domain, actionClass)
  return {
    id: candidate.id,
    actionClass,
    domain: candidate.domain || 'general',
    priorityClass,
    priority: guidancePriority(actionClass) * 10 + CLASS_ORDER[priorityClass],
    target: candidate.target || null,
    deadline: candidate.deadline || (actionClass === GUIDANCE_LEVELS.COMMITMENT ? 'today' : null),
    status,
    selected: false,
    reasons: [candidate.reason].filter(Boolean),
    evidenceIds: [candidate.evidenceId].filter(Boolean),
    confidence: candidate.confidence ?? null,
    sourceMetrics: candidate.metric ? [{ metricKey: candidate.metric, period: candidate.period || null }] : [],
    sourcePeriod: candidate.period || (candidate.sourceDay ? { start: candidate.sourceDay, end: candidate.sourceDay } : null),
    blockers: deferred ? candidate.deferredBy : [],
    merged: false,
    generatedAt: generatedAt ?? null,
    dataFreshness: targetSnapshot?.freshness ?? null,
    _mandatory: COMMITMENT_LEVELS.has(actionClass) && status === DECISION_STATUS.TO_DO,
  }
}

/**
 * @param {object} input
 * @param {object} input.assessments  Domain advisor outputs carrying `.candidates`.
 * @param {object} [input.targetSnapshot] Snapshot for the target day (freshness).
 * @param {string} [input.generatedAt] Deterministic timestamp; omit in tests.
 */
export function buildDecisionSet({ assessments = {}, targetSnapshot = null, generatedAt = null } = {}) {
  const candidates = Object.values(assessments).flatMap((assessment) => assessment?.candidates || [])
  const decisions = []
  const byKey = new Map()

  for (const candidate of candidates) {
    const decision = toDecision(candidate, { generatedAt, targetSnapshot })
    const key = `${decision.domain}|${decision.actionClass}|${normalize(candidate.action || candidate.reason)}`
    const existing = byKey.get(key)
    if (existing) {
      existing.reasons = [...new Set([...existing.reasons, ...decision.reasons])]
      existing.evidenceIds = [...new Set([...existing.evidenceIds, ...decision.evidenceIds])]
      existing.confidence = Math.max(existing.confidence ?? 0, decision.confidence ?? 0) || null
      existing.merged = true
      continue
    }
    byKey.set(key, decision)
    decisions.push(decision)
  }

  decisions.sort((a, b) => a.priority - b.priority || String(a.id).localeCompare(String(b.id)))

  let selectedCount = 0
  for (const decision of decisions) {
    if (!decision._mandatory) continue
    if (selectedCount < MAX_COMMITMENTS) {
      decision.selected = true
      selectedCount += 1
    }
  }

  const clean = decisions.map(({ _mandatory, ...decision }) => decision)
  const commitments = clean.filter((decision) => decision.selected)
  const safety = clean.filter((decision) => decision.priorityClass === 'safety')
  const deferred = clean.filter((decision) => decision.status === DECISION_STATUS.DEFERRED_BY_SAFETY)
  const notNeeded = clean.filter((decision) => decision.status === DECISION_STATUS.NOT_NEEDED)

  return { decisions: clean, commitments, safety, deferred, notNeeded }
}
