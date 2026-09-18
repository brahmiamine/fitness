import { BASELINE_METRICS } from './baselines'
import { GUIDANCE_LEVELS } from './guidanceLevels'

/**
 * Contextual daily-advice engine (#23). Advice is helpful but never one of
 * the maximum three priority commitments: it collects the non-mandatory,
 * data-grounded observations produced by the domain advisors and the
 * period comparisons, then merges duplicates.
 *
 * Hard rule: Pulse never outputs generic wellness filler (hydration,
 * supplements, protein, caffeine, diet, symptoms) unless a relevant data
 * field actually supports it. Every item carries its reason, source period,
 * confidence, freshness and — when a population rule is involved — an
 * evidence id.
 */
export const FORBIDDEN_ADVICE_TOPICS = [
  /hydratation|hydratez-vous|buvez de l’eau/i,
  /complément|supplément|vitamine|protéine|créatine/i,
  /caféine|café\b|thé\b/i,
  /régime|alimentation|nutrition/i,
  /symptôme|fièvre|douleur/i,
]

const COMPARISON_METRICS = ['steps', 'sleepMinutes', 'activeMinutes']

function isGrounded(message = '', reason = '') {
  const text = `${message} ${reason}`
  return !FORBIDDEN_ADVICE_TOPICS.some((pattern) => pattern.test(text))
}

function normalizeKey(domain, message) {
  return `${domain}|${String(message || '').trim().toLowerCase()}`
}

function fromCandidate(candidate, { targetSnapshot, domainOrder }) {
  const period = candidate.period || (candidate.sourceDay ? { start: candidate.sourceDay, end: candidate.sourceDay } : null)
  return {
    id: candidate.id,
    domain: candidate.domain || 'general',
    kind: candidate.id === 'recovery-active-ready' ? 'reassurance' : 'advice',
    message: candidate.action || candidate.reason,
    reason: candidate.reason,
    evidenceId: candidate.evidenceId || null,
    confidence: candidate.confidence ?? null,
    freshnessDays: targetSnapshot?.freshness?.dayAgeDays ?? null,
    sourceDay: candidate.sourceDay || null,
    period,
    sourceMetrics: candidate.metric ? [{ metricKey: candidate.metric, period }] : [],
    order: domainOrder[candidate.domain] ?? 99,
  }
}

function comparisonAdvice(comparisons, targetSnapshot, domainOrder) {
  const items = []
  for (const metricKey of COMPARISON_METRICS) {
    const comparison = comparisons.find((entry) => entry.metricKey === metricKey && entry.type === 'week_to_date_vs_previous_week' && entry.comparable)
    if (!comparison || comparison.confidence < 0.5 || Math.abs(comparison.percentChange ?? 0) < 0.2) continue
    const label = BASELINE_METRICS[metricKey]?.label || metricKey
    const direction = comparison.percentChange > 0 ? 'au-dessus' : 'au-dessous'
    const percent = Math.round(Math.abs(comparison.percentChange) * 100)
    const period = `${comparison.periodA.start} → ${comparison.periodA.end}`
    const message =
      metricKey === 'steps' && comparison.percentChange < 0
        ? `Votre activité de la semaine est ${percent} % ${direction} de la même période la semaine dernière ; répartir le mouvement sur les jours restants.`
        : `Votre ${label.toLowerCase()} de la semaine est ${percent} % ${direction} de la même période la semaine dernière.`
    items.push({
      id: `advice-comparison-${metricKey}`,
      domain: BASELINE_METRICS[metricKey]?.domain || 'general',
      kind: 'advice',
      message,
      reason: `Comparaison de période identique (${period}) vs semaine précédente.`,
      evidenceId: null,
      confidence: comparison.confidence,
      freshnessDays: targetSnapshot?.freshness?.dayAgeDays ?? null,
      sourceDay: comparison.periodA.end,
      period: comparison.periodA,
      sourceMetrics: [{ metricKey, current: comparison.periodA.value, previous: comparison.periodB.value, period: comparison.periodA }],
      order: domainOrder[BASELINE_METRICS[metricKey]?.domain] ?? 99,
    })
  }
  return items
}

/**
 * @param {object} input
 * @param {object} input.assessments  { sedentary, sleep, activity, recovery, safety }
 * @param {Array} input.comparisons   Output of buildComparisons (#15).
 */
export function buildDailyAdvice({ assessments = {}, comparisons = [], targetSnapshot = null, options = {} } = {}) {
  const domainOrder = { safety: 0, recovery: 1, sleep: 2, activity: 3, general: 5 }
  const candidates = []

  for (const assessment of Object.values(assessments)) {
    for (const candidate of assessment?.candidates || []) {
      if (candidate.level !== GUIDANCE_LEVELS.ADVICE && candidate.id !== 'recovery-active-ready') continue
      candidates.push(fromCandidate(candidate, { targetSnapshot, domainOrder }))
    }
  }

  candidates.push(...comparisonAdvice(comparisons, targetSnapshot, domainOrder))

  const merged = new Map()
  let mergedCount = 0
  for (const item of candidates) {
    if (!isGrounded(item.message, item.reason)) continue
    const key = normalizeKey(item.domain, item.message)
    if (merged.has(key)) {
      mergedCount += 1
      const existing = merged.get(key)
      merged.set(key, {
        ...existing,
        confidence: Math.max(existing.confidence ?? 0, item.confidence ?? 0) || null,
        sourceMetrics: [...existing.sourceMetrics, ...item.sourceMetrics],
      })
      continue
    }
    merged.set(key, item)
  }

  const items = [...merged.values()]
    .map(({ order, ...item }) => item)
    .sort((a, b) => (a.domain === b.domain ? String(a.id).localeCompare(String(b.id)) : (domainOrder[a.domain] ?? 99) - (domainOrder[b.domain] ?? 99)))

  return { items, mergedCount }
}
