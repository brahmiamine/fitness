import { Activity, Sparkles } from 'lucide-react'
import { buildInsights } from '../../lib/analysis'
import { formatDuration, formatNumber } from '../../lib/format'
import { DayTimeline } from '../DayTimeline'
import { MultiDayComparison } from '../MultiDayComparison'
import { QualityReport } from '../QualityReport'
import { IntelligenceReport } from '../IntelligenceReport'
import { ArchiveOverview } from './ArchiveOverview'
import { DataQuality, InsightList, MetricRow, SectionHeading } from './shared'

export function Overview({ dataset, day, summary, history }) {
  const insights = buildInsights(summary)
  return (
    <div className="dashboard-view">
      <section className="overview-lead">
        <div className="overview-lead__copy">
          <span className="status-dot"><i aria-hidden="true" /> Données analysées localement</span>
          <h1>Votre journée, reliée plutôt qu’empilée.</h1>
          <p>Le contexte aide à comprendre une mesure isolée : sommeil, mouvement et récupération sont lus ensemble.</p>
        </div>
        <MetricRow
          items={[
            { label: 'Sommeil', value: formatDuration(summary.sleepMinutes), detail: `${summary.sleepSessions} période${summary.sleepSessions > 1 ? 's' : ''}` },
            { label: 'Activité', value: formatNumber(summary.steps), detail: 'pas' },
            { label: 'Cœur', value: summary.heartAverage ? `${formatNumber(summary.heartAverage)} bpm` : '—', detail: 'moyenne périodique' },
            { label: 'Oxygène', value: summary.spo2Average ? `${formatNumber(summary.spo2Average, 1)} %` : '—', detail: 'moyenne mesurée' },
          ]}
        />
      </section>

      <QualityReport dataset={dataset} day={day} />
      <MultiDayComparison dataset={dataset} day={day} />
      <IntelligenceReport dataset={dataset} day={day} imports={history} currentSummary={summary} />

      <section className="content-section content-section--timeline">
        <SectionHeading icon={Activity} title="Ligne de la journée" description="Les mesures replacées sur la même période de 24 heures." />
        <DayTimeline dataset={dataset} day={day} />
      </section>

      <section className="content-section">
        <SectionHeading icon={Sparkles} title="Ce qui ressort" description="Repères généraux calculés à partir de cette seule journée." />
        <InsightList insights={insights} />
      </section>

      <ArchiveOverview dataset={dataset} />
      <DataQuality dataset={dataset} summary={summary} />
    </div>
  )
}
