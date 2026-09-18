import { buildPersonalBaselines } from './baselines'
import { buildComparisons, detectSustainedTrends } from './comparisons'
import { assessSedentary } from './sedentary'
import { assessSleep } from './sleepAdvisor'
import { assessActivity } from './activityAdvisor'
import { assessRecovery } from './recoveryAdvisor'
import { assessSafety } from './safetyAdvisor'
import { buildHealthMath } from './healthMath'
import { buildDailyPlan } from './planner'
import { buildRollingPlan } from './rollingPlan'
import { GUIDANCE_LEVELS } from './guidanceLevels'

/**
 * Single entry point of the advisor (#27's one source of truth). Composes
 * every domain engine deterministically from a longitudinal timeline and a
 * local profile context, and returns the Today/Tomorrow plan, the 3–7 day
 * rolling plan, the comparisons, the health math and the raw assessments.
 *
 * Ordering matters: activity is first evaluated without blockers, then
 * recovery is derived (it needs sleep + activity), then activity is
 * re-evaluated with the recovery/safety blockers so a due workout can be
 * deferred.
 */
export const ADVISOR_ENGINE_VERSION = '1.0.0'

export function buildAdvisorResult({ snapshots = [], targetDay, profileContext = {}, options = {}, generatedAt = null } = {}) {
  const targetSnapshot = snapshots.find((snapshot) => snapshot.day === targetDay) || null
  const comparisons = buildComparisons(snapshots, targetDay, options.comparisonMetrics, options)
  const trends = detectSustainedTrends(snapshots, targetDay, options.trendMetrics, options)

  const sedentary = assessSedentary({ snapshots, targetDay, options })
  const sleep = assessSleep({ snapshots, targetDay, options })
  const safety = assessSafety({ snapshots, targetDay, options })

  const activityBase = assessActivity({ snapshots, targetDay, options, blockers: [] })
  const recovery = assessRecovery({ snapshots, targetDay, sleepAssessment: sleep, activityAssessment: activityBase, options })

  const safetyBlocker =
    safety.hasUrgent || safety.needsRecheck
      ? [{ id: 'safety', domain: 'safety', level: GUIDANCE_LEVELS.MONITOR, reason: 'Une mesure de sécurité doit être recontrôlée.' }]
      : []
  const blockers = [...safetyBlocker, ...recovery.blockers]
  const activity = blockers.length ? assessActivity({ snapshots, targetDay, options, blockers }) : activityBase

  const healthMath = buildHealthMath({ profileContext, snapshots, targetDay })
  const assessments = { sedentary, sleep, activity, recovery, safety }
  const plan = buildDailyPlan({ assessments, comparisons, targetSnapshot, generatedAt })
  const rollingPlan = buildRollingPlan({ snapshots, targetDay, assessments, healthMath, options: { ...options, trends } })

  return {
    version: ADVISOR_ENGINE_VERSION,
    day: targetDay,
    targetSnapshot,
    profileContext,
    baselines: buildPersonalBaselines(snapshots, targetDay, undefined, options),
    assessments,
    comparisons,
    trends,
    healthMath,
    plan,
    rollingPlan,
    decisionSet: plan.decisionSet,
    advice: plan.advice,
  }
}
