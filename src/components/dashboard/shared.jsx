import { ArrowUpRight, CircleAlert, Info, ShieldCheck, Sparkles } from 'lucide-react'
import { formatNumber } from '../../lib/format'

export const APP_LABELS = {
  'com.google.android.gm': 'Gmail',
  'com.facebook.orca': 'Messenger',
  'com.facebook.katana': 'Facebook',
  'com.whatsapp.w4b': 'WhatsApp Business',
  'com.mc.miband1.genericApp': 'Notifications génériques',
  'com.mc.miband.incomingCall': 'Appels entrants',
  'com.mc.xiaomi1': 'Notify for Xiaomi',
}

export const HEART_TYPE_LABELS = { 0: 'Périodique', 3: 'Rapprochée' }
export const SLEEP_STAGE_LABELS = { 4: 'Léger', 5: 'Profond', 7: 'Éveillé', 8: 'Paradoxal' }

export function appLabel(value) {
  return APP_LABELS[value] || value || 'Application inconnue'
}

export function MetricRow({ items }) {
  return (
    <dl className="metric-row">
      {items.map((item) => (
        <div key={item.label} className="metric-row__item">
          <dt>{item.label}</dt>
          <dd>{item.value}</dd>
          {item.detail && <span>{item.detail}</span>}
        </div>
      ))}
    </dl>
  )
}

export function SectionHeading({ icon: Icon, title, description, action }) {
  return (
    <header className="section-heading">
      <div className="section-heading__title">
        <span className="section-heading__icon"><Icon size={20} aria-hidden="true" /></span>
        <div>
          <h2>{title}</h2>
          {description && <p>{description}</p>}
        </div>
      </div>
      {action}
    </header>
  )
}

export function InsightList({ insights }) {
  if (!insights.length) return null
  const icons = { positive: ShieldCheck, attention: CircleAlert, watch: Info, neutral: Sparkles }
  return (
    <div className="insight-list">
      {insights.map((insight) => {
        const Icon = icons[insight.level] || Info
        return (
          <article key={insight.id} className={`insight insight--${insight.level}`}>
            <Icon size={21} aria-hidden="true" />
            <div>
              <h3>{insight.title}</h3>
              <p>{insight.text}</p>
              {insight.source && (
                <a href={insight.source.href} target="_blank" rel="noreferrer">
                  {insight.source.label} <ArrowUpRight size={14} aria-hidden="true" />
                </a>
              )}
            </div>
          </article>
        )
      })}
    </div>
  )
}

export function DataQuality({ dataset, summary }) {
  const compatibility = dataset.metadata?.compatibility
  return (
    <details className="data-quality">
      <summary>Comprendre la qualité de ces données</summary>
      <div className="data-quality__body">
        <p>
          Les mesures viennent du bracelet et de Notify. Elles servent à suivre une tendance, pas à établir un diagnostic.
          Les moyennes sont calculées uniquement avec les valeurs disponibles dans la sauvegarde.
        </p>
        <dl>
          <div><dt>Mesures cardiaques utilisées</dt><dd>{formatNumber(summary.heartSamples)}</dd></div>
          <div><dt>Mesures SpO₂</dt><dd>{formatNumber(summary.spo2Samples)}</dd></div>
          <div><dt>Mesures de stress</dt><dd>{formatNumber(summary.stressSamples)}</dd></div>
          <div><dt>Lignes fitness analysées</dt><dd>{formatNumber(dataset.metadata?.recordCount || 0)}</dd></div>
          <div><dt>Toutes lignes SQLite</dt><dd>{formatNumber(dataset.metadata?.totalRows || dataset.metadata?.recordCount || 0)}</dd></div>
          <div><dt>Points GPS jamais enregistrés</dt><dd>{formatNumber(dataset.metadata?.gpsPointsDiscarded || 0)}</dd></div>
          <div><dt>Tables détectées</dt><dd>{formatNumber(dataset.metadata?.tableCount || 0)}</dd></div>
          <div><dt>Colonnes adaptées au schéma</dt><dd>{formatNumber(compatibility?.addedColumns?.length || 0)}</dd></div>
          <div><dt>Champs nouveaux conservés au catalogue</dt><dd>{formatNumber(compatibility?.unknownColumns?.length || 0)}</dd></div>
        </dl>
      </div>
    </details>
  )
}
