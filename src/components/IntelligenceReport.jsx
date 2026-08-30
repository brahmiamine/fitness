import { useMemo, useState } from 'react'
import {
  BrainCircuit,
  CheckCircle2,
  CircleAlert,
  Database,
  Info,
  Link2,
  LockKeyhole,
  Minus,
  ShieldCheck,
  Telescope,
  TrendingDown,
  TrendingUp,
} from 'lucide-react'
import { buildLocalIntelligence } from '../lib/intelligence'
import { formatDuration, formatNumber } from '../lib/format'

function confidenceLabel(level) {
  if (level === 'high') return 'Confiance élevée'
  if (level === 'medium') return 'Confiance moyenne'
  return 'Confiance limitée'
}

function formatMetric(value, metricKey, signed = false) {
  if (!Number.isFinite(value)) return '—'
  const prefix = signed && value > 0 ? '+' : ''
  if (metricKey === 'sleep') {
    if (!signed) return formatDuration(value)
    return `${value < 0 ? '−' : prefix}${formatDuration(Math.abs(value))}`
  }
  if (metricKey === 'heart') return `${prefix}${formatNumber(value, 1)} bpm`
  if (metricKey === 'oxygen') return `${prefix}${formatNumber(value, 1)} %`
  if (metricKey === 'stress') return `${prefix}${formatNumber(value, 1)} points`
  if (metricKey === 'activeMinutes') return `${prefix}${formatDuration(value)}`
  return `${prefix}${formatNumber(value)} pas`
}

function BaselineList({ baselines }) {
  return (
    <div className="ai-baselines" aria-label="Comparaison avec le profil personnel">
      {baselines.map((item) => {
        const difference = item.current != null && item.median != null ? item.current - item.median : null
        const direction = difference > 0 ? 'up' : difference < 0 ? 'down' : 'same'
        const DirectionIcon = direction === 'up' ? TrendingUp : direction === 'down' ? TrendingDown : Minus
        return (
          <article key={item.metricKey} className="ai-baseline">
            <div className="ai-baseline__heading">
              <strong>{item.shortLabel}</strong>
              {item.ready
                ? <span className={`ai-delta ai-delta--${direction}`}><DirectionIcon size={15} aria-hidden="true" />{formatMetric(difference, item.metricKey, true)}</span>
                : <span className="ai-learning">{item.samples}/7 jours</span>}
            </div>
            <dl>
              <div><dt>Journée</dt><dd>{formatMetric(item.current, item.metricKey)}</dd></div>
              <div><dt>Médiane personnelle</dt><dd>{item.ready ? formatMetric(item.median, item.metricKey) : 'En apprentissage'}</dd></div>
            </dl>
            {item.ready && <p>Zone habituelle : {formatMetric(item.low, item.metricKey)} à {formatMetric(item.high, item.metricKey)} · {item.samples} jours comparés</p>}
          </article>
        )
      })}
    </div>
  )
}

function SignalList({ report }) {
  if (report.confidence.currentQuality < 60) {
    return (
      <div className="ai-message ai-message--warning">
        <CircleAlert size={20} aria-hidden="true" />
        <p><strong>Alertes personnelles suspendues</strong>La qualité technique de cette journée est insuffisante pour une comparaison fiable.</p>
      </div>
    )
  }
  if (report.readiness.personal < report.readiness.personalTarget) {
    return (
      <div className="ai-message">
        <Info size={20} aria-hidden="true" />
        <p><strong>Détection en apprentissage</strong>Au moins 7 journées antérieures sont nécessaires pour comparer la journée à vos propres habitudes.</p>
      </div>
    )
  }
  if (!report.signals.length) {
    return (
      <div className="ai-message ai-message--positive">
        <CheckCircle2 size={20} aria-hidden="true" />
        <p><strong>Aucune variation personnelle importante</strong>Les mesures disponibles restent proches de votre profil sur la période choisie.</p>
      </div>
    )
  }
  return (
    <div className="ai-signals">
      {report.signals.map((signal) => (
        <article key={signal.id} className={`ai-signal ai-signal--${signal.level}`}>
          <CircleAlert size={20} aria-hidden="true" />
          <div>
            <h4>{signal.title}</h4>
            <p>{signal.text}</p>
            <span>Valeur : {formatMetric(signal.current, signal.metricKey)} · Médiane : {formatMetric(signal.baseline, signal.metricKey)} · {signal.samples} jours de référence</span>
          </div>
        </article>
      ))}
    </div>
  )
}

function Correlations({ report }) {
  if (!report.correlations.length) {
    return (
      <p className="ai-empty">{report.readiness.correlations < report.readiness.correlationsTarget
        ? `Encore ${report.readiness.correlationsTarget - report.readiness.correlations} journée(s) comparable(s) pour rechercher des associations.`
        : 'Aucune association suffisamment nette sur cette période.'}</p>
    )
  }
  return (
    <div className="ai-correlations">
      {report.correlations.map((item) => (
        <article key={`${item.x}-${item.y}`}>
          <Link2 size={18} aria-hidden="true" />
          <div><strong>{item.label}</strong><p>Association {item.strength}, évolution {item.direction === 'same' ? 'dans le même sens' : 'en sens opposé'}.</p></div>
          <span>r = {formatNumber(item.coefficient, 2)}<small>{item.samples} jours</small></span>
        </article>
      ))}
    </div>
  )
}

function Forecasts({ report }) {
  if (!report.forecasts.length) {
    return (
      <p className="ai-empty">{report.readiness.forecasts < report.readiness.forecastsTarget
        ? `Encore ${report.readiness.forecastsTarget - report.readiness.forecasts} journée(s) comparable(s) pour calculer une projection.`
        : 'Historique trop irrégulier pour afficher une projection utile.'}</p>
    )
  }
  return (
    <div className="ai-forecasts">
      {report.forecasts.map((item) => {
        const Icon = item.trend === 'up' ? TrendingUp : item.trend === 'down' ? TrendingDown : Minus
        return (
          <article key={item.metricKey}>
            <div><Telescope size={19} aria-hidden="true" /><span>{item.metricKey === 'steps' ? 'Activité' : 'Sommeil'} dans 7 jours</span></div>
            <strong>{formatMetric(item.projected, item.metricKey)}</strong>
            <p><Icon size={15} aria-hidden="true" /> Tendance {item.trend === 'up' ? 'à la hausse' : item.trend === 'down' ? 'à la baisse' : 'stable'} · intervalle indicatif {formatMetric(item.low, item.metricKey)}–{formatMetric(item.high, item.metricKey)}</p>
          </article>
        )
      })}
    </div>
  )
}

function Readiness({ report }) {
  const items = [
    { label: 'Profil personnel', value: report.readiness.personal, target: report.readiness.personalTarget },
    { label: 'Corrélations', value: report.readiness.correlations, target: report.readiness.correlationsTarget },
    { label: 'Projections', value: report.readiness.forecasts, target: report.readiness.forecastsTarget },
  ]
  return (
    <div className="ai-readiness" aria-label="Progression du profil intelligent">
      {items.map((item) => {
        const percent = Math.min(100, item.value / item.target * 100)
        return (
          <div key={item.label}>
            <span><strong>{item.label}</strong><small>{item.value}/{item.target} jours</small></span>
            <i aria-hidden="true"><b style={{ width: `${percent}%` }} /></i>
          </div>
        )
      })}
    </div>
  )
}

export function IntelligenceReport({ dataset, day, imports, currentSummary }) {
  const [range, setRange] = useState(30)
  const report = useMemo(
    () => buildLocalIntelligence({ dataset, day, imports, rangeDays: range, currentSummary }),
    [dataset, day, imports, range, currentSummary],
  )

  return (
    <section className="content-section local-intelligence" aria-labelledby="local-intelligence-title">
      <header className="ai-header">
        <div className={`ai-score ai-score--${report.confidence.level}`} aria-label={`Confiance de l’analyse ${report.confidence.score} sur 100`}>
          <strong>{report.confidence.score}</strong><span>/100</span>
        </div>
        <div className="ai-header__copy">
          <span className="ai-private"><LockKeyhole size={15} aria-hidden="true" /> IA locale · aucun envoi</span>
          <h2 id="local-intelligence-title"><BrainCircuit size={22} aria-hidden="true" /> Analyse intelligente personnelle</h2>
          <p>{report.narrative}</p>
        </div>
      </header>

      <div className="ai-toolbar">
        <div><ShieldCheck size={17} aria-hidden="true" /><span>{confidenceLabel(report.confidence.level)}</span></div>
        <div className="segmented-control" aria-label="Période de référence de l’analyse intelligente">
          {[14, 30, 90, 0].map((value) => (
            <button key={value} type="button" className={range === value ? 'is-active' : ''} aria-pressed={range === value} onClick={() => setRange(value)}>
              {value ? `${value} j` : 'Tout'}
            </button>
          ))}
        </div>
      </div>

      <Readiness report={report} />

      <div className="ai-subsection">
        <h3>Votre journée face à vos habitudes</h3>
        <p>La médiane résiste mieux aux valeurs extrêmes qu’une moyenne simple.</p>
        <BaselineList baselines={report.baselines} />
      </div>

      <div className="ai-subsection">
        <h3>Variations détectées</h3>
        <p>Une variation est affichée seulement si l’écart statistique et l’écart relatif sont tous les deux importants.</p>
        <SignalList report={report} />
      </div>

      <div className="ai-split">
        <div className="ai-subsection">
          <h3>Associations dans l’historique</h3>
          <p>Une corrélation décrit une association, jamais une cause.</p>
          <Correlations report={report} />
        </div>
        <div className="ai-subsection">
          <h3>Projections prudentes</h3>
          <p>Projection linéaire indicative sur l’activité et le sommeil uniquement.</p>
          <Forecasts report={report} />
        </div>
      </div>

      <details className="ai-method">
        <summary><Database size={17} aria-hidden="true" /> Sources et méthode</summary>
        <div>
          <p>Analyse calculée dans votre navigateur à partir de {report.sources.days} journée{report.sources.days > 1 ? 's' : ''} consolidée{report.sources.days > 1 ? 's' : ''}, provenant de {report.sources.imports || 1} backup{report.sources.imports > 1 ? 's' : ''}. {report.sources.duplicateDays ? `${report.sources.duplicateDays} date(s) en double ont été remplacées par l’import le plus récent.` : 'Aucune date en double.'} Aucun critère démographique n’est utilisé.</p>
          <dl>
            <div><dt>Moteur</dt><dd>Pulse local v{report.version}</dd></div>
            <div><dt>Profil</dt><dd>Médiane, quartiles et écart absolu médian</dd></div>
            <div><dt>Associations</dt><dd>Corrélation de Pearson, minimum 10 jours</dd></div>
            <div><dt>Projection</dt><dd>Régression linéaire, minimum 14 jours</dd></div>
          </dl>
          <p><strong>Limite :</strong> ces résultats sont des estimations de bien-être. Ils ne diagnostiquent aucune maladie et ne remplacent pas un professionnel de santé.</p>
        </div>
      </details>
    </section>
  )
}
