import { useEffect, useMemo, useState } from 'react'
import {
  CalendarClock,
  CheckCircle2,
  ChevronDown,
  CircleAlert,
  Footprints,
  ShieldCheck,
  Sparkles,
  Target,
} from 'lucide-react'
import { summarizeDay } from '../../lib/analysis'
import { buildHealthTimeline } from '../../lib/healthTimeline'
import { loadProfile, toProfileContext } from '../../lib/profile'
import { buildAdvisorResult } from '../../lib/advisor/engine'
import { formatClockMinute, formatNumber } from '../../lib/format'

function Freshness({ freshness }) {
  if (!freshness) return null
  if (Number.isFinite(freshness.dayAgeDays) && freshness.dayAgeDays > 1) {
    return <p className="simple-freshness">Conseils basés sur les dernières données importées, datant de {freshness.dayAgeDays} jours.</p>
  }
  return <p className="simple-freshness">Conseils basés sur le dernier import disponible.</p>
}

function actionText(decision) {
  if (decision.action) return decision.action
  const target = decision.target
  if (target?.kind === 'steps' && Number.isFinite(target.value)) return `Atteins environ ${formatNumber(target.value)} pas aujourd’hui.`
  if (target?.kind === 'bedtime' && Number.isFinite(target.minute)) return `Essaie de te coucher vers ${formatClockMinute(target.minute)}.`
  if (target?.kind === 'workout' && Number.isFinite(target.minMinutes)) return `Prévois ${target.minMinutes} à ${target.maxMinutes} minutes d’activité.`
  return decision.reasons?.[0] || 'Continue normalement aujourd’hui.'
}

function SimpleDecision({ decision, currentSteps }) {
  const target = decision.target
  const isSteps = target?.kind === 'steps' && Number.isFinite(target.value)
  const progress = isSteps && Number.isFinite(currentSteps) ? Math.min(1, currentSteps / target.value) : null

  return (
    <article className={`simple-decision simple-decision--${decision.priorityClass || 'general'}`}>
      <div className="simple-decision__icon" aria-hidden="true">
        {decision.priorityClass === 'activity' ? <Footprints size={21} /> : decision.priorityClass === 'safety' ? <ShieldCheck size={21} /> : <Target size={21} />}
      </div>
      <div className="simple-decision__body">
        <h3>{actionText(decision)}</h3>

        {progress != null && (
          <div className="simple-progress" aria-label="Progression de l’objectif de pas">
            <span><i style={{ width: `${progress * 100}%` }} /></span>
            <small>
              {formatNumber(currentSteps)} / {formatNumber(target.value)} pas
              {Number.isFinite(target.distanceKm) && target.distanceKm > 0 ? ` · environ ${target.distanceKm} km` : ''}
            </small>
          </div>
        )}

        <details className="simple-why">
          <summary>Pourquoi ? <ChevronDown size={15} aria-hidden="true" /></summary>
          <p>{decision.reasons?.[0] || 'Décision calculée à partir de ton historique personnel.'}</p>
        </details>
      </div>
    </article>
  )
}

function comparisonSentence(comparison) {
  const labels = {
    steps: 'Tu as marché',
    sleepMinutes: 'Tu as dormi',
    activeMinutes: 'Tu as été actif',
    workoutMinutes: 'Tu as fait du sport',
    stressAverage: 'Ton stress est',
    heartAverage: 'Ta fréquence cardiaque moyenne est',
  }
  const prefix = labels[comparison.metricKey] || comparison.label || 'Cette mesure est'
  if (comparison.direction === 'up') return `${prefix} davantage que la période précédente.`
  if (comparison.direction === 'down') return `${prefix} moins que la période précédente.`
  return `${prefix} à un niveau proche de la période précédente.`
}

function planAction(day) {
  const map = {
    SLEEP_RECOVERY: 'Priorise une nuit régulière.',
    ACTIVITY_RAMP: 'Remonte progressivement ton activité.',
    LIGHT_ACTIVITY: 'Fais une activité légère.',
    REST_OR_WALK: 'Récupère ou fais une marche légère.',
    MODERATE_SESSION: 'Prévois une séance modérée.',
    REASSESS: 'Réévalue selon tes nouvelles données.',
    RECOVERY: 'Priorise la récupération.',
    LIGHT_MOVEMENT: 'Bouge légèrement sans forcer.',
    ENERGY_TARGET: 'Garde ton objectif de poids progressif.',
  }
  if (map[day.intent]) return map[day.intent]
  if (day.targets?.steps) return `Vise environ ${formatNumber(day.targets.steps)} pas.`
  if (day.targets?.bedtimeMinute != null) return `Garde un coucher proche de ${formatClockMinute(day.targets.bedtimeMinute)}.`
  return day.reason || 'Continue selon ton rythme habituel.'
}

function Advice({ item }) {
  return (
    <article className="simple-advice">
      <Sparkles size={19} aria-hidden="true" />
      <div>
        <strong>{item.message}</strong>
        <details className="simple-why">
          <summary>Pourquoi ? <ChevronDown size={15} aria-hidden="true" /></summary>
          <p>{item.reason}</p>
        </details>
      </div>
    </article>
  )
}

export function DecisionsView({ dataset, day, history }) {
  const [state, setState] = useState({ loading: true, error: '', snapshots: null, profileContext: {} })
  const summary = summarizeDay(dataset, day)

  useEffect(() => {
    let active = true
    setState((current) => ({ ...current, loading: true, error: '' }))
    Promise.all([buildHealthTimeline(history), loadProfile()])
      .then(([snapshots, profile]) => {
        if (active) setState({ loading: false, error: '', snapshots, profileContext: toProfileContext(profile) })
      })
      .catch(() => {
        if (active) setState({ loading: false, error: 'Impossible de calculer les décisions à partir de l’historique local.', snapshots: null, profileContext: {} })
      })
    return () => { active = false }
  }, [history, dataset?.id])

  const result = useMemo(() => {
    if (!state.snapshots?.length) return null
    try {
      return buildAdvisorResult({ snapshots: state.snapshots, targetDay: day, profileContext: state.profileContext })
    } catch {
      return null
    }
  }, [state.snapshots, state.profileContext, day])

  if (state.loading) {
    return <div className="app-loading app-loading--inline" role="status"><span className="loader" aria-hidden="true" /> Calcul des décisions…</div>
  }

  if (state.error || !result) {
    return (
      <div className="dashboard-view">
        <section className="decisions-empty">
          <Target size={28} aria-hidden="true" />
          <h1>Pas encore assez de données</h1>
          <p>{state.error || 'Importe quelques journées supplémentaires pour que Pulse puisse apprendre tes habitudes.'}</p>
        </section>
      </div>
    )
  }

  const { plan, rollingPlan } = result
  const today = plan.today
  const currentSteps = result.targetSnapshot?.activity?.steps ?? summary.steps ?? 0
  const selectedIds = new Set(today.commitments.map((item) => item.id))
  const extraRechecks = today.rechecks.filter((item) => !selectedIds.has(item.id)).slice(0, 2)
  const comparisons = today.comparisons.slice(0, 3)
  const advice = today.advice.slice(0, 2)

  return (
    <div className="dashboard-view decisions-view decisions-view--simple">
      <header className="simple-hero">
        <span className="simple-hero__eyebrow">Pulse · Décisions</span>
        <h1>{today.state.label}</h1>
        <p>Seulement ce qui est utile à faire maintenant. Les calculs restent en arrière-plan.</p>
        <Freshness freshness={today.freshness} />
      </header>

      <section className="simple-section simple-section--today">
        <div className="simple-section__heading">
          <Target size={21} aria-hidden="true" />
          <h2>Aujourd’hui</h2>
        </div>
        {today.commitments.length ? (
          <div className="simple-stack">
            {today.commitments.map((decision) => (
              <SimpleDecision key={decision.id} decision={decision} currentSteps={currentSteps} />
            ))}
          </div>
        ) : (
          <div className="simple-ok">
            <CheckCircle2 size={22} aria-hidden="true" />
            <div>
              <strong>Rien de particulier à corriger.</strong>
              <p>Continue normalement aujourd’hui.</p>
            </div>
          </div>
        )}
      </section>

      {extraRechecks.length > 0 && (
        <section className="simple-section simple-section--watch">
          <div className="simple-section__heading">
            <CircleAlert size={21} aria-hidden="true" />
            <h2>À recontrôler</h2>
          </div>
          <div className="simple-stack">
            {extraRechecks.map((decision) => (
              <SimpleDecision key={decision.id} decision={decision} currentSteps={currentSteps} />
            ))}
          </div>
        </section>
      )}

      <section className="simple-section">
        <div className="simple-section__heading">
          <CalendarClock size={21} aria-hidden="true" />
          <h2>Demain</h2>
        </div>
        <article className="simple-tomorrow">
          <div>
            <span>Si ta récupération reste bonne</span>
            <strong>{plan.tomorrow.branches.ifMet.title}</strong>
          </div>
          <div>
            <span>Sinon</span>
            <strong>{plan.tomorrow.branches.else.title}</strong>
          </div>
        </article>
      </section>

      {comparisons.length > 0 && (
        <section className="simple-section">
          <div className="simple-section__heading">
            <Sparkles size={21} aria-hidden="true" />
            <h2>À savoir</h2>
          </div>
          <ul className="simple-changes">
            {comparisons.map((comparison) => (
              <li key={`${comparison.metricKey}-${comparison.period?.start || ''}`}>{comparisonSentence(comparison)}</li>
            ))}
          </ul>
        </section>
      )}

      {advice.length > 0 && (
        <section className="simple-section">
          <div className="simple-section__heading">
            <Sparkles size={21} aria-hidden="true" />
            <h2>Conseils</h2>
          </div>
          <div className="simple-stack">
            {advice.map((item) => <Advice key={item.id} item={item} />)}
          </div>
        </section>
      )}

      {rollingPlan.active && (
        <section className="simple-section">
          <div className="simple-section__heading">
            <Target size={21} aria-hidden="true" />
            <h2>Prochains jours</h2>
          </div>
          <p className="simple-section__intro">Une tendance a été détectée. Ce petit plan sera recalculé au prochain import.</p>
          <ol className="simple-plan">
            {rollingPlan.days.map((planDay) => (
              <li key={planDay.date}>
                <span>{planDay.relativeDay}</span>
                <strong>{planAction(planDay)}</strong>
              </li>
            ))}
          </ol>
        </section>
      )}

      <p className="simple-medical-note">
        Pulse aide à organiser des décisions de bien-être à partir des données de la montre. Il ne pose pas de diagnostic médical.
      </p>
    </div>
  )
}
