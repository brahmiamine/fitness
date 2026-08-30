import { AlertTriangle, CheckCircle2, CircleAlert, Info, ShieldCheck } from 'lucide-react'
import { formatNumber } from '../lib/format'

const STATUS = {
  pass: { label: 'Réussi', icon: CheckCircle2 },
  error: { label: 'Erreur', icon: CircleAlert },
  warning: { label: 'Attention', icon: AlertTriangle },
  info: { label: 'Information', icon: Info },
}

function scoreLabel(level) {
  if (level === 'high') return 'Qualité élevée'
  if (level === 'medium') return 'Qualité moyenne'
  return 'Qualité faible'
}

export function QualityReport({ dataset, day }) {
  const report = dataset.metadata?.quality
  const daily = dataset.days.find((item) => item.day === day)?.quality
  if (!report) return null

  return (
    <section className="content-section quality-report" aria-labelledby="quality-report-title">
      <header className="quality-report__header">
        <div className={`quality-score quality-score--${report.level}`} aria-label={`Score de qualité global ${report.score} sur 100`}>
          <strong>{formatNumber(report.score)}</strong><span>/100</span>
        </div>
        <div>
          <span className="section-kicker"><ShieldCheck size={16} aria-hidden="true" /> Contrôle avant analyse</span>
          <h2 id="quality-report-title">Rapport de qualité</h2>
          <p>{scoreLabel(report.level)}. Le score mesure la cohérence technique et la couverture, pas votre état de santé.</p>
        </div>
      </header>

      <dl className="quality-summary">
        <div><dt>Erreurs</dt><dd>{formatNumber(report.summary?.errors || 0)}</dd></div>
        <div><dt>Alertes</dt><dd>{formatNumber(report.summary?.warnings || 0)}</dd></div>
        <div><dt>Informations</dt><dd>{formatNumber(report.summary?.information || 0)}</dd></div>
        <div><dt>Journée affichée</dt><dd>{formatNumber(daily?.score ?? 100)}/100</dd></div>
      </dl>

      <div className="quality-checks">
        {report.checks.map((item) => {
          const current = STATUS[item.status] || STATUS.info
          const Icon = current.icon
          return (
            <article key={item.id} className={`quality-check quality-check--${item.status}`}>
              <Icon size={19} aria-hidden="true" />
              <div><h3>{item.title}</h3><p>{item.explanation}</p></div>
              <span>{item.count ? formatNumber(item.count) : current.label}</span>
            </article>
          )
        })}
      </div>

      {daily?.anomalies?.length > 0 && (
        <div className="daily-anomalies">
          <strong>À vérifier pour cette journée</strong>
          <ul>{daily.anomalies.map((item) => <li key={item}>{item}</li>)}</ul>
        </div>
      )}
    </section>
  )
}
