import { ArrowUpRight, Activity, Database, Gauge, HeartPulse } from 'lucide-react'
import { preferredHeartSeries, SOURCES } from '../../lib/analysis'
import { formatNumber, formatTime } from '../../lib/format'
import { LineChart } from '../Charts'
import { DetailTable } from '../DataDetails'
import { HEART_TYPE_LABELS, MetricRow, SectionHeading } from './shared'

export function HeartView({ dataset, day, summary }) {
  const allRows = (dataset.heart || []).filter((row) => row.day === day)
  const rows = preferredHeartSeries(allRows)
  const peak = summary.peakHeart
  return (
    <div className="dashboard-view">
      <section className="content-section content-section--intro">
        <SectionHeading icon={HeartPulse} title="Fréquence cardiaque" description="Mesures périodiques privilégiées pour éviter de surpondérer les relevés très rapprochés." />
        <MetricRow items={[
          { label: 'Minimum', value: summary.heartMinimum ? `${formatNumber(summary.heartMinimum)} bpm` : '—' },
          { label: 'Médiane', value: summary.heartMedian ? `${formatNumber(summary.heartMedian)} bpm` : '—' },
          { label: 'Moyenne', value: summary.heartAverage ? `${formatNumber(summary.heartAverage)} bpm` : '—' },
          { label: 'Maximum', value: summary.heartMaximum ? `${formatNumber(summary.heartMaximum)} bpm` : '—' },
        ]} />
      </section>
      <section className="content-section">
        <SectionHeading icon={Activity} title="Évolution sur la journée" />
        <LineChart data={rows.map((row) => ({ value: row.value, label: formatTime(row.dateTime, row.tz) }))} label="Fréquence cardiaque" unit="bpm" />
      </section>
      <section className="content-section">
        <SectionHeading icon={Database} title="Couverture des mesures" description="Les statistiques principales utilisent la série périodique ; les relevés rapprochés restent consultables ci-dessous." />
        <MetricRow items={[
          { label: 'Périodiques', value: formatNumber(summary.heartPeriodicSamples), detail: 'utilisées pour les statistiques' },
          { label: 'Rapprochées', value: formatNumber(summary.heartDenseSamples), detail: 'conservées dans le journal' },
          { label: 'Plage centrale 5–95 %', value: `${formatNumber(summary.heartLowPercentile)}–${formatNumber(summary.heartHighPercentile)} bpm` },
          { label: 'Total brut', value: formatNumber(summary.heartAllSamples), detail: 'tous types confondus' },
        ]} />
      </section>
      {peak && (
        <section className="peak-context">
          <Gauge size={23} aria-hidden="true" />
          <div>
            <h3>Pic à {formatNumber(peak.value)} bpm vers {formatTime(peak.dateTime, peak.tz)}</h3>
            <p>{summary.peakSteps >= 30 ? `${formatNumber(summary.peakSteps)} pas sont présents autour de la mesure : le pic coïncide avec un effort.` : 'Aucun mouvement suffisant n’est enregistré autour de ce pic. Surveillez sa répétition plutôt qu’une valeur isolée.'}</p>
          </div>
        </section>
      )}
      <p className="medical-note">
        En cas de palpitations avec douleur thoracique, malaise, essoufflement ou vertiges, appelez le 15 ou le 112.{' '}
        <a href={SOURCES.palpitations.href} target="_blank" rel="noreferrer">Source Assurance Maladie <ArrowUpRight size={14} aria-hidden="true" /></a>
      </p>
      <DetailTable
        title="Toutes les mesures cardiaques"
        description="Journal progressif trié par heure, sans suppression des relevés rapprochés."
        rows={allRows}
        columns={[
          { label: 'Heure', render: (row) => formatTime(row.dateTime, row.tz) },
          { label: 'Valeur', render: (row) => `${formatNumber(row.value)} bpm` },
          { label: 'Mode', render: (row) => HEART_TYPE_LABELS[row.type] || `Type ${row.type}` },
        ]}
      />
    </div>
  )
}
