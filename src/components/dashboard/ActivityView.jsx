import { ArrowUpRight, Activity, Database, Footprints, Gauge } from 'lucide-react'
import { SOURCES } from '../../lib/analysis'
import { describeRecordType, describeSportType } from '../../lib/activityTypes'
import { formatDateTime, formatDistance, formatDuration, formatNumber, formatTime, localMinutes } from '../../lib/format'
import { LineChart } from '../Charts'
import { DetailTable } from '../DataDetails'
import { LocalGpsMap } from '../LocalGpsMap'
import { MetricRow, SectionHeading } from './shared'

export function ActivityView({ dataset, day, summary, privateGps }) {
  const records = (dataset.records || []).filter((row) => row.day === day)
  const workouts = (dataset.workouts || []).filter((row) => row.day === day)
  const hourly = Array.from({ length: 24 }, (_, hour) => {
    const rows = records.filter((row) => Math.floor(localMinutes(row.dateTime, row.tz) / 60) === hour)
    return { value: rows.reduce((sum, row) => sum + row.steps, 0), label: `${hour} h` }
  })
  const gps = (dataset.gps || []).find((row) => row.day === day)
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
      <section className="content-section">
        <SectionHeading icon={Gauge} title="Détail de l’effort" description="Indicateurs complémentaires enregistrés dans la synthèse quotidienne et les mesures minute par minute." />
        <MetricRow items={[
          { label: 'Minutes intensives', value: summary.intensiveMinutes ? formatDuration(summary.intensiveMinutes) : '0 min' },
          { label: 'Heures avec mouvement', value: formatNumber(summary.activeHours) },
          { label: 'Maximum par minute', value: `${formatNumber(summary.maximumMinuteSteps)} pas` },
          { label: 'PAI', value: formatNumber(summary.pai || 0), detail: `${formatNumber(summary.paiEarned || 0)} gagné sur la journée` },
        ]} />
      </section>
      {gps && (
        <section className="content-section">
          <SectionHeading icon={Footprints} title="Trace GPS agrégée" description="Les coordonnées brutes sont utilisées en mémoire pour le calcul puis supprimées avant l’enregistrement local." />
          <div className="gps-summary">
          <div><span>Distance calculée</span><strong>{formatDistance(gps.distance)}</strong></div>
          <div><span>Durée</span><strong>{formatDuration(gps.durationMinutes)}</strong></div>
          <div><span>Points analysés</span><strong>{formatNumber(gps.sampleCount)}</strong></div>
          <div><span>Vitesse moyenne</span><strong>{formatNumber(gps.averageSpeed, 1)} km/h</strong></div>
          <div><span>Vitesse maximale</span><strong>{formatNumber(gps.maximumSpeed, 1)} km/h</strong></div>
          <div><span>Dénivelé mesuré</span><strong>{formatNumber(gps.maximumAltitude - gps.minimumAltitude)} m</strong></div>
          <div><span>Altitude minimale</span><strong>{formatNumber(gps.minimumAltitude)} m</strong></div>
          <div><span>Altitude maximale</span><strong>{formatNumber(gps.maximumAltitude)} m</strong></div>
          <div><span>Début de trace</span><strong>{formatTime(gps.start, gps.timezone)}</strong></div>
          <div><span>Fin de trace</span><strong>{formatTime(gps.end, gps.timezone)}</strong></div>
          <div><span>Points en pause</span><strong>{formatNumber(gps.pausedSamples || 0)}</strong></div>
          </div>
        </section>
      )}
      <LocalGpsMap points={privateGps} />
      <section className="content-section">
        <SectionHeading icon={Database} title="Journal d’activité" description="Toutes les lignes minute par minute, y compris celles sans pas." />
        <DetailTable
          title="Mesures d’activité"
          rows={records}
          columns={[
            { label: 'Heure', render: (row) => formatTime(row.dateTime, row.tz) },
            { label: 'Pas', render: (row) => formatNumber(row.steps) },
            { label: 'Distance', render: (row) => formatDistance(row.distance) },
            { label: 'Calories', render: (row) => formatNumber(row.calories) },
            { label: 'Cœur', render: (row) => row.heartRate ? `${row.heartRate} bpm` : '—' },
            { label: 'SpO₂', render: (row) => row.spo2 ? `${row.spo2} %` : '—' },
            { label: 'Stress', render: (row) => row.stress || '—' },
            { label: 'Énergie', render: (row) => row.energy || '—' },
            { label: 'Contexte', render: (row) => describeRecordType(row.type) },
            { label: 'Type de sport', render: (row) => describeSportType(row.activityType) },
          ]}
        />
        <DetailTable
          title="Séances sportives"
          rows={workouts}
          columns={[
            { label: 'Début', render: (row) => formatDateTime(row.start, row.tz) },
            { label: 'Type', render: (row) => describeSportType(row.type, row.title) },
            { label: 'Durée', render: (row) => formatDuration(row.duration / 60) },
            { label: 'Pas', render: (row) => formatNumber(row.steps) },
            { label: 'Distance', render: (row) => formatDistance(row.distance) },
          ]}
        />
      </section>
      <p className="medical-note">
        Les calories et distances d’un bracelet sont des estimations. Pour la santé, privilégiez la régularité : l’OMS recommande 150 à 300 minutes d’activité modérée par semaine.{' '}
        <a href={SOURCES.activity.href} target="_blank" rel="noreferrer">Consulter la recommandation <ArrowUpRight size={14} aria-hidden="true" /></a>
      </p>
    </div>
  )
}
