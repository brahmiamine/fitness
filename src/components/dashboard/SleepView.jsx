import { BedDouble, Database, HeartPulse, MoonStar } from 'lucide-react'
import { average, formatDuration, formatNumber, formatTime } from '../../lib/format'
import { LineChart, StageBar } from '../Charts'
import { DetailTable } from '../DataDetails'
import { MetricRow, SectionHeading, SLEEP_STAGE_LABELS } from './shared'

export function SleepView({ dataset, day, summary }) {
  const sessions = (dataset.sleep || []).filter((row) => row.day === day)
  const intervals = (dataset.sleepIntervals || []).filter((row) => row.day === day)
  const combined = sessions.reduce(
    (result, session) => ({
      light: result.light + session.light,
      deep: result.deep + session.deep,
      rem: result.rem + session.rem,
      awake: result.awake + session.awake,
    }),
    { light: 0, deep: 0, rem: 0, awake: 0 },
  )
  const nocturnalHeartAverages = sessions.map((row) => row.heartAverage).filter(Boolean)
  const nocturnalOxygenAverages = sessions.map((row) => row.spo2Average).filter(Boolean)
  const sleepHeart = dataset.heart.filter((row) => sessions.some((session) => row.dateTime >= session.start && row.dateTime <= session.end))
  return (
    <div className="dashboard-view">
      <section className="content-section content-section--intro">
        <SectionHeading icon={MoonStar} title="Sommeil" description="La durée est plus fiable que le détail des stades estimés." />
        <MetricRow items={[
          { label: 'Sommeil estimé', value: formatDuration(summary.sleepMinutes) },
          { label: 'Fenêtre détectée', value: formatDuration(summary.sleepWindow) },
          { label: 'Cœur nocturne', value: nocturnalHeartAverages.length ? `${formatNumber(average(nocturnalHeartAverages))} bpm` : '—' },
          { label: 'SpO₂ nocturne', value: nocturnalOxygenAverages.length ? `${formatNumber(average(nocturnalOxygenAverages), 1)} %` : '—' },
        ]} />
      </section>

      <section className="content-section">
        <SectionHeading icon={BedDouble} title="Répartition estimée" description="À utiliser pour la tendance, pas pour un diagnostic de sommeil." />
        <StageBar sleep={combined} />
      </section>

      <section className="content-section">
        <SectionHeading icon={HeartPulse} title="Cœur pendant le sommeil" />
        <LineChart
          data={sleepHeart.map((row) => ({ value: row.value, label: formatTime(row.dateTime, row.tz) }))}
          label="Fréquence cardiaque pendant le sommeil"
          unit="bpm"
        />
      </section>

      <section className="session-list" aria-label="Périodes de sommeil">
        {sessions.map((session, index) => (
          <article key={session.start} className="session-row">
            <div><span>Période {index + 1}</span><strong>{formatTime(session.start, session.tz)} – {formatTime(session.end, session.tz)}</strong></div>
            <div><span>Sommeil estimé</span><strong>{formatDuration(session.asleep)}</strong></div>
            <div><span>Éveil · retournements</span><strong>{formatDuration(session.awake)} · {formatNumber(session.turnOvers || 0)}</strong></div>
          </article>
        ))}
      </section>

      <section className="content-section">
        <SectionHeading icon={Database} title="Intervalles détaillés" description="Découpage des stades transmis par Notify, avec la moyenne cardiaque de chaque intervalle." />
        <DetailTable
          title="Journal des stades"
          rows={intervals}
          columns={[
            { label: 'Horaire', render: (row) => `${formatTime(row.start, row.tz)} – ${formatTime(row.end, row.tz)}` },
            { label: 'Stade', render: (row) => SLEEP_STAGE_LABELS[row.type] || `Code ${row.type}` },
            { label: 'Durée', render: (row) => formatDuration((row.end - row.start) / 60_000) },
            { label: 'Cœur', render: (row) => row.heartAverage ? `${formatNumber(row.heartAverage)} bpm` : '—' },
          ]}
        />
      </section>
    </div>
  )
}
