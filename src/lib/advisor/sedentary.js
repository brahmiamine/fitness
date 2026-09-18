import { formatClockMinute } from '../format'
import { computeMetricBaseline } from './baselines'
import { describeSourceDay, freshnessFactor, isFresh } from './freshness'
import { GUIDANCE_LEVELS } from './guidanceLevels'
import { createGuidance } from './safetyPolicy'

/**
 * Sedentary detection (#17). Reads the sparse minute-level movement trace
 * already exposed by DailyHealthSnapshot (#12) and turns prolonged
 * low-movement blocks into bounded, freshness-aware decisions.
 *
 * The goal is to reduce long sedentary stretches and improve how movement
 * is distributed across the day — never to ask someone to "move all the
 * time". Thresholds are explicit named constants here, not magic numbers
 * scattered through the UI.
 */
export const SEDENTARY_DEFAULTS = {
  blockMinutes: 120,
  concentratedHours: 4,
  concentratedShare: 0.5,
  minimumStepsForDistribution: 2000,
}

/**
 * Finds consecutive idle stretches *between* the first and last recorded
 * active minute. Overnight sleep and the edges of the day are deliberately
 * excluded: we can only claim a sedentary block when we know the person was
 * awake and active around it.
 */
export function detectSedentaryBlocks(minuteSteps = [], { blockMinutes = SEDENTARY_DEFAULTS.blockMinutes } = {}) {
  const minutes = minuteSteps.map(([minute]) => minute).filter(Number.isFinite).sort((a, b) => a - b)
  if (minutes.length < 2) {
    return { hasData: minutes.length > 0, firstActiveMinute: minutes[0] ?? null, lastActiveMinute: minutes[0] ?? null, activeMinuteCount: minutes.length, blocks: [], longestBlockMinutes: 0 }
  }
  const blocks = []
  let previous = minutes[0]
  for (const minute of minutes.slice(1)) {
    const gap = minute - previous - 1
    if (gap >= blockMinutes) blocks.push({ startMinute: previous + 1, endMinute: minute - 1, durationMinutes: gap })
    previous = minute
  }
  return {
    hasData: true,
    firstActiveMinute: minutes[0],
    lastActiveMinute: minutes.at(-1),
    activeMinuteCount: minutes.length,
    blocks,
    longestBlockMinutes: blocks.reduce((longest, block) => Math.max(longest, block.durationMinutes), 0),
  }
}

function buildDistribution(hourlySteps = []) {
  const total = hourlySteps.reduce((sum, value) => sum + value, 0)
  const activeHours = hourlySteps.filter((value) => value > 0).length
  const peak = hourlySteps.reduce((maximum, value) => Math.max(maximum, value), 0)
  return { totalSteps: total, activeHours, peakHourShare: total ? peak / total : 0 }
}

/**
 * @param {object} input
 * @param {Array} input.snapshots   Full longitudinal timeline, oldest first.
 * @param {string} input.targetDay  Day to assess.
 * @returns {object} assessment facts + guidance candidates (never UI text
 *   alone: every candidate still goes through createGuidance/safetyPolicy).
 */
export function assessSedentary({ snapshots, targetDay, options = {} } = {}) {
  const settings = { ...SEDENTARY_DEFAULTS, ...options }
  const target = snapshots.find((snapshot) => snapshot.day === targetDay) || null
  const minuteSteps = target?.activity?.minuteSteps || []
  const detection = detectSedentaryBlocks(minuteSteps, { blockMinutes: settings.blockMinutes })
  const distribution = buildDistribution(target?.activity?.hourlySteps || [])
  const baseline = computeMetricBaseline(snapshots, targetDay, 'steps', options)
  const window = baseline.windows.rolling7
  const steps = target?.activity?.steps ?? null
  const highActivity = window.ready && steps != null && steps >= window.q3
  const poorDistribution =
    detection.hasData &&
    distribution.totalSteps >= settings.minimumStepsForDistribution &&
    distribution.activeHours <= settings.concentratedHours &&
    distribution.peakHourShare >= settings.concentratedShare

  const baseConfidence = Math.min(1, (window.sampleCount / 14) * 0.6 + (detection.hasData ? 0.4 : 0))
  const confidence = Math.round(baseConfidence * freshnessFactor(target) * 100) / 100
  const candidates = []
  const sourceDay = targetDay

  if (!detection.hasData) {
    candidates.push(
      createGuidance({
        id: 'sedentary-insufficient',
        level: GUIDANCE_LEVELS.INFO,
        reason: 'Aucun détail minute par minute n’est disponible pour cette journée.',
        action: null,
        confidence,
        sourceDay,
        domain: 'activity',
      }),
    )
    return { ...detection, ...distribution, highActivity, poorDistribution, baseline: window, confidence, candidates, hasData: false }
  }

  const freshnessValid = isFresh(target)
  const phrase = describeSourceDay(target)

  if (detection.longestBlockMinutes >= settings.blockMinutes && !highActivity) {
    const longest = detection.blocks.reduce((best, block) => (block.durationMinutes > (best?.durationMinutes || 0) ? block : best), null)
    candidates.push({
      ...createGuidance({
        id: 'sedentary-break',
        level: GUIDANCE_LEVELS.COMMITMENT,
        reason: `Un bloc de ${Math.round(detection.longestBlockMinutes)} minutes sans mouvement détecté ressort ${phrase}.`,
        action: freshnessValid
          ? 'Marcher quelques minutes dès que possible aujourd’hui pour couper ce bloc sédentaire.'
          : `Lors de votre prochaine journée active, couper les blocs sédentaires par quelques minutes de marche.`,
        evidenceId: 'who-activity-2020',
        confidence,
        sourceDay,
        domain: 'activity',
      }),
      metric: 'steps',
      mandatory: true,
      target: null,
      window: longest ? { startMinute: longest.startMinute, endMinute: longest.endMinute, label: `de ${formatClockMinute(longest.startMinute)} à ${formatClockMinute(longest.endMinute)}` } : null,
    })
  }

  if (poorDistribution && !highActivity) {
    candidates.push({
      ...createGuidance({
        id: 'sedentary-distribution',
        level: GUIDANCE_LEVELS.ADVICE,
        reason: `${Math.round(distribution.peakHourShare * 100)} % de vos pas sont concentrés sur une seule heure, ${phrase}.`,
        action: 'Répartir le mouvement sur davantage d’heures plutôt que de l’ajouter en une seule fois.',
        evidenceId: 'who-activity-2020',
        confidence,
        sourceDay,
        domain: 'activity',
      }),
      metric: 'steps',
      mandatory: false,
      target: null,
    })
  }

  if (highActivity) {
    candidates.push(
      createGuidance({
        id: 'sedentary-not-needed',
        level: GUIDANCE_LEVELS.INFO,
        reason: 'Votre activité dépasse déjà le haut de votre intervalle personnel habituel.',
        action: 'Aucun pas supplémentaire n’est nécessaire uniquement pour ajouter du mouvement.',
        confidence,
        sourceDay,
        domain: 'activity',
      }),
    )
  }

  if (!candidates.length) {
    candidates.push(
      createGuidance({
        id: 'sedentary-ok',
        level: GUIDANCE_LEVELS.INFO,
        reason: 'Aucun bloc sédentaire prolongé ni déséquilibre horaire notable n’a été détecté.',
        action: null,
        confidence,
        sourceDay,
        domain: 'activity',
      }),
    )
  }

  return {
    ...detection,
    ...distribution,
    highActivity,
    poorDistribution,
    baseline: window,
    confidence,
    candidates,
    hasData: true,
  }
}
