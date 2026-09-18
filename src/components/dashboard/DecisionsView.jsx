import { useEffect, useMemo, useState } from 'react'
import {
  Activity,
  AlertTriangle,
  CalendarClock,
  CheckCircle2,
  ChevronRight,
  Info,
  ListChecks,
  RefreshCw,
  ShieldCheck,
  Sparkles,
  Target,
  TrendingDown,
  TrendingUp,
} from 'lucide-react'
import { summarizeDay } from '../../lib/analysis'
import { buildHealthTimeline } from '../../lib/healthTimeline'
import { loadProfile, toProfileContext } from '../../lib/profile'
import { buildAdvisorResult } from '../../lib/advisor/engine'
import { getEvidence } from '../../lib/advisor/evidence'
import { GUIDANCE_LEVELS } from '../../lib/advisor/guidanceLevels'
import { formatClockMinute, formatDay, formatDuration, formatNumber, formatShortDay } from '../../lib/format'
import { IntelligenceReport } from '../IntelligenceReport'
import { SectionHeading } from './shared'

const LEVEL_LABELS = {
  [GUIDANCE_LEVELS.SEEK_MEDICAL_ADVICE]: 'Avis médical',
  [GUIDANCE_LEVELS.RECHECK]: 'À recontrôler',
  [GUIDANCE_LEVELS.MONITOR]: 'À surveiller',
  [GUIDANCE_LEVELS.COMMITMENT]: 'Engagement',
  [GUIDANCE_LEVELS.ADVICE]: 'Conseil',
  [GUIDANCE_LEVELS.INFO]: 'Information',
}

function ConfidenceBadge({ value }) {
  if (!Number.isFinite(value)) return null
  const percent = Math.round(value * 100)
  const label = percent >= 70 ? 'high' : percent >= 45 ? 'medium' : 'low'
  return <span className={`decisions-confidence decisions-confidence--${label}`}>Confiance {percent}%</span>
}

function EvidenceLink({ id }) {
  const evidence = id ? getEvidence(id) : null
  if (!evidence) return null
  return (
    <a className="decisions-evidence" href={evidence.url} target="_blank" rel="noreferrer">
      {evidence.organization} · {evidence.version}
    </a>
  )
}

function Freshness({ freshness }) {
  if (!freshness) return null
  if (Number.isFinite(freshness.dayAgeDays) && freshness.dayAgeDays > 1) {
    return <p className="decisions-freshness"><Info size={15} aria-hidden="true" /> Données importées il y a {freshness.dayAgeDays} jours — pas de suivi en direct.</p>
  }
  return <p className="decisions-freshness"><CheckCircle2 size={15} aria-hidden="true" /> Dernier import pris en compte pour cette journée.</p>
}

function CommitmentCard({ decision, currentSteps }) {
  const target = decision.target
  const showProgress = target?.kind === 'steps' && Number.isFinite(target.value) && Number.isFinite(currentSteps)
  const ratio = showProgress ? Math.min(1, currentSteps / target.value) : null
  return (
    <article className={`decision-card decision-card--${decision.priorityClass}`}>
      <header>
        <span className="decision-card__kind">{LEVEL_LABELS[decision.actionClass] || decision.actionClass}</span>
        <ConfidenceBadge value={decision.confidence} />
      </header>
      <h3>{decision.reasons[0] || decision.id}</h3>
      {decision.reasons.slice(1).map((reason) => <p key={reason}>{reason}</p>)}
      {showProgress && (
        <div className="decision-progress" role="group" aria-label="Progression de l’engagement">
          <div className="decision-progress__bar"><span style={{ width: `${ratio * 100}%` }} /></div>
          <span>{formatNumber(currentSteps)} / {formatNumber(target.value)} pas</span>
          {Number.isFinite(target.distanceKm) && target.distanceKm > 0 && <span className="decision-progress__km">≈ {target.distanceKm} km</span>}
        </div>
      )}
      {target?.kind === 'bedtime' && Number.isFinite(target.minute) && (
        <p className="decision-card__target"><CalendarClock size={15} aria-hidden="true" /> Coucher cible : {formatClockMinute(target.minute)}</p>
      )}
      {target?.kind === 'workout' && Number.isFinite(target.minMinutes) && (
        <p className="decision-card__target"><Activity size={15} aria-hidden="true" /> {target.minMinutes}–{target.maxMinutes} min d’activité modérée</p>
      )}
      <EvidenceLink id={decision.evidenceIds?.[0]} />
      <details className="decision-card__why">
        <summary>Pourquoi cette décision ?</summary>
        <ul>
          {decision.reasons.map((reason) => <li key={reason}>{reason}</li>)}
          {decision.sourcePeriod && <li>Période source : {formatShortDay(decision.sourcePeriod.start)} → {formatShortDay(decision.sourcePeriod.end)}</li>}
          {decision.blockers?.length > 0 && <li>Bloqueurs : {decision.blockers.join(', ')}</li>}
        </ul>
      </details>
    </article>
  )
}

function AdviceCard({ item }) {
  return (
    <article className={`decision-card decision-card--advice${item.kind === 'reassurance' ? ' decision-card--positive' : ''}`}>
      <header>
        <span className="decision-card__kind">{item.kind === 'reassurance' ? 'Rassurance' : 'Conseil'}</span>
        <ConfidenceBadge value={item.confidence} />
      </header>
      <p className="decision-card__message">{item.message}</p>
      <p className="decision-card__reason">{item.reason}</p>
      <EvidenceLink id={item.evidenceId} />
    </article>
  )
}

function RecheckCard({ decision }) {
  const urgent = decision.actionClass === GUIDANCE_LEVELS.SEEK_MEDICAL_ADVICE
  return (
    <article className={`decision-card decision-card--${urgent ? 'medical' : 'recheck'}`}>
      <header>
        <span className="decision-card__kind">{urgent ? <AlertTriangle size={15} aria-hidden="true" /> : <RefreshCw size={15} aria-hidden="true" />} {LEVEL_LABELS[decision.actionClass]}</span>
        <ConfidenceBadge value={decision.confidence} />
      </header>
      <h3>{decision.reasons[0]}</h3>
      <p>{decision.sourceMetrics?.[0]?.metricKey ? `Mesure concernée : ${decision.sourceMetrics[0].metricKey}` : ''}</p>
      <EvidenceLink id={decision.evidenceIds?.[0]} />
    </article>
  )
}

function PlanDay({ day }) {
  return (
    <li className="decisions-plan__day">
      <span className="decisions-plan__day-label">{day.relativeDay}</span>
      <div>
        <strong>{day.intent}</strong>
        <p>{day.reason}</p>
        {day.targets?.steps != null && <p>Objectif : {formatNumber(day.targets.steps)} pas</p>}
        {day.targets?.bedtimeMinute != null && <p>Coucher : {formatClockMinute(day.targets.bedtimeMinute)}</p>}
        {day.targets?.energyKcal != null && <p>Cible énergétique estimée : {formatNumber(day.targets.energyKcal)} kcal</p>}
        {day.targets?.minutes != null && <p>{day.targets.minutes} min</p>}
      </div>
    </li>
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
        if (active) setState({ loading: false, error: 'Les décisions ne peuvent pas être calculées à partir de l’historique local.', snapshots: null, profileContext: {} })
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
    return <div className="app-loading app-loading--inline" role="status"><span className="loader" aria-hidden="true" /> Calcul des décisions personnelles…</div>
  }
  if (state.error || !result) {
    return (
      <div className="dashboard-view">
        <section className="decisions-empty">
          <Target size={28} aria-hidden="true" />
          <h1>Aucune décision disponible</h1>
          <p>{state.error || 'Importez au moins quelques journées pour que Pulse puisse apprendre vos repères personnels.'}</p>
        </section>
      </div>
    )
  }

  const { plan, rollingPlan, healthMath } = result
  const today = plan.today
  const currentSteps = result.targetSnapshot?.activity?.steps ?? summary.steps ?? 0
  const comparisons = today.comparisons

  return (
    <div className="dashboard-view decisions-view">
      <section className="decisions-lead">
        <div>
          <span className="status-dot"><i aria-hidden="true" /> Conseiller personnel local</span>
          <h1>{today.state.label}</h1>
          <p>Chaque décision indique son action, son motif, sa confiance et sa source. Pulse ne pose aucun diagnostic.</p>
        </div>
        <MetricSummary result={result} />
      </section>

      <Freshness freshness={today.freshness} />

      <section className="content-section">
        <SectionHeading icon={ListChecks} title="À faire aujourd’hui" description="Jusqu’à 3 engagements prioritaires. Zéro engagement est un résultat valide." />
        {today.commitments.length
          ? <div className="decisions-grid">{today.commitments.map((decision) => <CommitmentCard key={decision.id} decision={decision} currentSteps={currentSteps} />)}</div>
          : <p className="decisions-none"><CheckCircle2 size={18} aria-hidden="true" /> Aucun engagement nécessaire : votre journée est dans vos repères.</p>}
      </section>

      <section className="content-section">
        <SectionHeading icon={CalendarClock} title="Demain" description="Décision conditionnelle : de nouvelles données peuvent la changer." />
        <article className="decision-card decision-card--plan">
          <header><span className="decision-card__kind">Conditionnel</span></header>
          <ul className="decisions-conditions">
            {(plan.tomorrow.conditions || []).map((condition) => <li key={condition.id}>{condition.label}</li>)}
          </ul>
          <div className="decisions-branches">
            <div><strong>Si c’est le cas</strong><p>{plan.tomorrow.branches.ifMet.title}</p></div>
            <div><strong>Sinon</strong><p>{plan.tomorrow.branches.else.title}</p></div>
          </div>
          <p className="decision-card__reason">{plan.tomorrow.rationale}</p>
        </article>
      </section>

      {rollingPlan.active && (
        <section className="content-section">
          <SectionHeading icon={Target} title="Plan des prochains jours" description={rollingPlan.reason} />
          <ul className="decisions-plan">
            {rollingPlan.days.map((planDay) => <PlanDay key={planDay.date} day={planDay} />)}
          </ul>
          <p className="decisions-freshness"><Info size={15} aria-hidden="true" /> {rollingPlan.reassessment}</p>
        </section>
      )}

      {comparisons.length > 0 && (
        <section className="content-section">
          <SectionHeading icon={TrendingUp} title="Ce qui a changé" description="Comparaisons de périodes identiques, classées par importance." />
          <ul className="decisions-comparisons">
            {comparisons.map((comparison) => (
              <li key={`${comparison.metricKey}-${comparison.period?.start}`}>
                {comparison.direction === 'down' ? <TrendingDown size={18} aria-hidden="true" /> : <TrendingUp size={18} aria-hidden="true" />}
                <span>
                  <strong>{comparison.label}</strong>
                  <small>
                    {Math.abs(Math.round((comparison.percentChange || 0) * 100))} % {comparison.direction === 'up' ? 'au-dessus' : comparison.direction === 'down' ? 'au-dessous' : 'stable'} de la période précédente
                  </small>
                </span>
              </li>
            ))}
          </ul>
        </section>
      )}

      {today.advice.length > 0 && (
        <section className="content-section">
          <SectionHeading icon={Sparkles} title="Conseils du jour" description="Utiles mais non obligatoires, toujours issus de vos données." />
          <div className="decisions-grid">{today.advice.map((item) => <AdviceCard key={item.id} item={item} />)}</div>
        </section>
      )}

      {today.rechecks.length > 0 && (
        <section className="content-section">
          <SectionHeading icon={ShieldCheck} title="Recontrôler / surveiller" description="Mesures à confirmer avant toute interprétation." />
          <div className="decisions-grid">{today.rechecks.map((decision) => <RecheckCard key={decision.id} decision={decision} />)}</div>
        </section>
      )}

      <section className="content-section">
        <SectionHeading icon={Info} title="Pourquoi Pulse a décidé cela" description="Formules et repères utilisés." />
        <div className="decisions-why-grid">
          <article className="decision-card decision-card--info">
            <h3>Repères de calcul</h3>
            <ul>
              <li>IMC : {healthMath.bmi.computable ? `${healthMath.bmi.value} kg/m² (${healthMath.bmi.category})` : `non calculable — ${healthMath.bmi.missingInput || 'donnée manquante'}`}</li>
              <li>Métabolisme de base : {healthMath.bmr.computable ? `${formatNumber(healthMath.bmr.value)} kcal/j (${healthMath.bmr.formula.id})` : `non calculable — ${healthMath.bmr.missingInput}`}</li>
              <li>Besoin estimé : {healthMath.energyNeed.computable ? `${formatNumber(healthMath.energyNeed.value)} kcal/j (estimation)` : 'non calculable'}</li>
              <li>
                Objectif de poids : {healthMath.weightGoal.computable
                  ? `${healthMath.weightGoal.currentWeightKg} kg → ${healthMath.weightGoal.targetWeightKg} kg (${healthMath.weightGoal.direction})`
                  : 'non calculable'}
              </li>
            </ul>
          </article>
          <article className="decision-card decision-card--info">
            <h3>Confiance &amp; fraîcheur</h3>
            <ul>
              <li>Confiance globale : {healthMath ? `${Math.round((today.confidence || 0) * 100)}%` : '—'}</li>
              <li>{today.freshness?.dayAgeDays != null ? `Dernière journée importée il y a ${today.freshness.dayAgeDays} jour(s)` : 'Fraîcheur inconnue'}</li>
              <li>{today.deferred.length ? `${today.deferred.length} décision(s) reportée(s) pour sécurité` : 'Aucune décision reportée'}</li>
            </ul>
          </article>
        </div>
      </section>

      <section className="content-section">
        <SectionHeading icon={ChevronRight} title="Détails et historique" description="Vue descriptive complémentaire, sans recommandation contradictoire." />
        <IntelligenceReport dataset={dataset} day={day} imports={history} currentSummary={summary} />
      </section>
    </div>
  )
}

function MetricSummary({ result }) {
  const { assessments, healthMath } = result
  const items = [
    { label: 'Récupération', value: assessments.recovery?.state || '—' },
    { label: 'Sommeil', value: assessments.sleep?.minutes != null ? formatDuration(assessments.sleep.minutes) : '—' },
    { label: 'Sédentarité', value: assessments.sedentary?.longestBlockMinutes ? `${Math.round(assessments.sedentary.longestBlockMinutes)} min` : '—' },
    { label: 'Poids cible', value: healthMath.weightGoal.computable ? `${healthMath.weightGoal.targetWeightKg} kg` : '—' },
  ]
  return (
    <dl className="metric-row decisions-metrics">
      {items.map((item) => (
        <div key={item.label} className="metric-row__item"><dt>{item.label}</dt><dd>{item.value}</dd></div>
      ))}
    </dl>
  )
}
