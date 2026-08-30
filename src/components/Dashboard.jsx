import {
  Activity,
  ArrowUpRight,
  BedDouble,
  CircleAlert,
  Footprints,
  Gauge,
  HeartPulse,
  Info,
  MoonStar,
  ShieldCheck,
  Sparkles,
  Wind,
} from 'lucide-react'
import { buildInsights, preferredHeartSeries, SOURCES, summarizeDay } from '../lib/analysis'
import {
  average,
  formatDistance,
  formatDuration,
  formatNumber,
  formatTime,
  localMinutes,
} from '../lib/format'
import { DayTimeline } from './DayTimeline'
import { LineChart, StageBar } from './Charts'

function MetricRow({ items }) {
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

function SectionHeading({ icon: Icon, title, description, action }) {
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

function InsightList({ insights }) {
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

function DataQuality({ dataset, summary }) {
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
          <div><dt>Lignes de données importées</dt><dd>{formatNumber(dataset.metadata.recordCount)}</dd></div>
        </dl>
      </div>
    </details>
  )
}

function Overview({ dataset, day, summary }) {
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

      <section className="content-section content-section--timeline">
        <SectionHeading icon={Activity} title="Ligne de la journée" description="Les mesures replacées sur la même période de 24 heures." />
        <DayTimeline dataset={dataset} day={day} />
      </section>

      <section className="content-section">
        <SectionHeading icon={Sparkles} title="Ce qui ressort" description="Repères généraux calculés à partir de cette seule journée." />
        <InsightList insights={insights} />
      </section>

      <DataQuality dataset={dataset} summary={summary} />
    </div>
  )
}

function SleepView({ dataset, day, summary }) {
  const sessions = dataset.sleep.filter((row) => row.day === day)
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
            <div><span>Éveil détecté</span><strong>{formatDuration(session.awake)}</strong></div>
          </article>
        ))}
      </section>
    </div>
  )
}

function HeartView({ dataset, day, summary }) {
  const rows = preferredHeartSeries(dataset.heart.filter((row) => row.day === day))
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
    </div>
  )
}

function VitalsView({ dataset, day, summary }) {
  const oxygen = dataset.spo2.filter((row) => row.day === day)
  const stress = dataset.stress.filter((row) => row.day === day)
  return (
    <div className="dashboard-view">
      <section className="content-section content-section--intro">
        <SectionHeading icon={Wind} title="Oxygène et stress" description="Deux estimations optiques à lire comme tendances." />
        <MetricRow items={[
          { label: 'SpO₂ moyenne', value: summary.spo2Average ? `${formatNumber(summary.spo2Average, 1)} %` : '—' },
          { label: 'SpO₂ minimum', value: summary.spo2Minimum ? `${formatNumber(summary.spo2Minimum)} %` : '—' },
          { label: 'Stress moyen', value: summary.stressAverage ? formatNumber(summary.stressAverage, 1) : '—' },
          { label: 'Stress maximum', value: summary.stressMaximum ? formatNumber(summary.stressMaximum) : '—' },
        ]} />
      </section>
      <section className="content-section">
        <SectionHeading icon={Wind} title="Saturation en oxygène" description={`${summary.spo2Samples} mesures disponibles.`} />
        <LineChart data={oxygen.map((row) => ({ value: row.value, label: formatTime(row.dateTime, row.tz) }))} label="Saturation en oxygène" unit="%" color="var(--oxygen)" />
      </section>
      <section className="content-section">
        <SectionHeading icon={Gauge} title="Stress estimé" description={`${summary.stressSamples} mesures disponibles.`} />
        <LineChart data={stress.map((row) => ({ value: row.value, label: formatTime(row.dateTime, row.tz) }))} label="Score de stress" unit="points" color="var(--stress)" />
      </section>
      <p className="medical-note">
        Une valeur SpO₂ au poignet peut varier avec le mouvement, la température, la circulation ou le positionnement.{' '}
        <a href={SOURCES.oxygen.href} target="_blank" rel="noreferrer">Voir les limites de l’oxymétrie <ArrowUpRight size={14} aria-hidden="true" /></a>
      </p>
    </div>
  )
}

function ActivityView({ dataset, day, summary }) {
  const records = dataset.records.filter((row) => row.day === day)
  const hourly = Array.from({ length: 24 }, (_, hour) => {
    const rows = records.filter((row) => Math.floor(localMinutes(row.dateTime, row.tz) / 60) === hour)
    return { value: rows.reduce((sum, row) => sum + row.steps, 0), label: `${hour} h` }
  })
  const gps = dataset.gps.find((row) => row.day === day)
  return (
    <div className="dashboard-view">
      <section className="content-section content-section--intro">
        <SectionHeading icon={Footprints} title="Activité" description="Pas, distance calculée et répartition horaire." />
        <MetricRow items={[
          { label: 'Pas', value: formatNumber(summary.steps) },
          { label: 'Distance', value: formatDistance(summary.distance) },
          { label: 'Calories', value: summary.calories ? `${formatNumber(summary.calories)} kcal` : '—' },
          { label: 'Temps actif', value: summary.activeMinutes ? formatDuration(summary.activeMinutes) : '—' },
        ]} />
      </section>
      <section className="content-section">
        <SectionHeading icon={Activity} title="Pas par heure" />
        <LineChart data={hourly} label="Pas par heure" unit="pas" color="var(--primary)" />
      </section>
      {gps && (
        <section className="gps-summary">
          <div><span>Trace GPS partielle</span><strong>{formatDistance(gps.distance)}</strong></div>
          <div><span>Durée</span><strong>{formatDuration(gps.durationMinutes)}</strong></div>
          <div><span>Vitesse maximale</span><strong>{formatNumber(gps.maximumSpeed, 1)} km/h</strong></div>
          <div><span>Dénivelé mesuré</span><strong>{formatNumber(gps.maximumAltitude - gps.minimumAltitude)} m</strong></div>
        </section>
      )}
      <p className="medical-note">
        Les calories et distances d’un bracelet sont des estimations. Pour la santé, privilégiez la régularité : l’OMS recommande 150 à 300 minutes d’activité modérée par semaine.{' '}
        <a href={SOURCES.activity.href} target="_blank" rel="noreferrer">Consulter la recommandation <ArrowUpRight size={14} aria-hidden="true" /></a>
      </p>
    </div>
  )
}

export const VIEW_ITEMS = [
  { id: 'overview', label: 'Synthèse', icon: Sparkles },
  { id: 'sleep', label: 'Sommeil', icon: MoonStar },
  { id: 'heart', label: 'Cœur', icon: HeartPulse },
  { id: 'vitals', label: 'Mesures', icon: Wind },
  { id: 'activity', label: 'Activité', icon: Footprints },
]

export function Dashboard({ dataset, day, view }) {
  const summary = summarizeDay(dataset, day)
  const views = {
    overview: <Overview dataset={dataset} day={day} summary={summary} />,
    sleep: <SleepView dataset={dataset} day={day} summary={summary} />,
    heart: <HeartView dataset={dataset} day={day} summary={summary} />,
    vitals: <VitalsView dataset={dataset} day={day} summary={summary} />,
    activity: <ActivityView dataset={dataset} day={day} summary={summary} />,
  }
  return views[view] || views.overview
}
