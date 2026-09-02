import { ArrowUpRight, Database, Gauge, Scale, Wind } from 'lucide-react'
import { SOURCES } from '../../lib/analysis'
import { formatNumber, formatTime } from '../../lib/format'
import { LineChart } from '../Charts'
import { DetailTable } from '../DataDetails'
import { MetricRow, SectionHeading } from './shared'

export function VitalsView({ dataset, day, summary }) {
  const oxygen = (dataset.spo2 || []).filter((row) => row.day === day)
  const stress = (dataset.stress || []).filter((row) => row.day === day)
  const weights = (dataset.weights || []).filter((row) => row.day === day)
  const pressure = (dataset.bloodPressure || []).filter((row) => row.day === day)
  const glucose = (dataset.bloodGlucose || []).filter((row) => row.day === day)
  const reminders = dataset.reminders || []
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
      <section className="content-section">
        <SectionHeading icon={Database} title="Mesures détaillées" description="Toutes les valeurs disponibles pour cette journée, affichées progressivement." />
        <DetailTable
          title="Saturation en oxygène"
          rows={oxygen}
          columns={[
            { label: 'Heure', render: (row) => formatTime(row.dateTime, row.tz) },
            { label: 'SpO₂', render: (row) => `${formatNumber(row.value)} %` },
            { label: 'Type', render: (row) => `Type ${row.type}` },
          ]}
        />
        <DetailTable
          title="Stress estimé"
          rows={stress}
          columns={[
            { label: 'Heure', render: (row) => formatTime(row.dateTime, row.tz) },
            { label: 'Score', render: (row) => formatNumber(row.value) },
            { label: 'Type', render: (row) => `Type ${row.type}` },
          ]}
        />
      </section>

      <section className="content-section">
        <SectionHeading icon={Scale} title="Mesures manuelles" description="Poids, tension et glycémie sont inclus lorsque ces tables ont été renseignées dans Notify." />
        <div className="manual-measure-grid">
          <DetailTable
            title="Poids"
            rows={weights}
            columns={[
              { label: 'Heure', render: (row) => formatTime(row.dateTime, row.tz) },
              { label: 'Valeur', render: (row) => `${formatNumber(row.value, 2)} kg` },
            ]}
          />
          <DetailTable
            title="Tension artérielle"
            rows={pressure}
            columns={[
              { label: 'Heure', render: (row) => formatTime(row.dateTime, row.tz) },
              { label: 'Tension', render: (row) => `${row.systolic}/${row.diastolic} mmHg` },
              { label: 'Cœur', render: (row) => row.heartRate ? `${row.heartRate} bpm` : '—' },
            ]}
          />
          <DetailTable
            title="Glycémie"
            rows={glucose}
            columns={[
              { label: 'Heure', render: (row) => formatTime(row.dateTime, row.tz) },
              { label: 'Valeur', render: (row) => `${formatNumber(row.valueMgDl, 1)} mg/dL` },
              { label: 'Glucides', render: (row) => row.carbohydratesGrams ? `${formatNumber(row.carbohydratesGrams, 1)} g` : '—' },
            ]}
          />
        </div>
        <DetailTable
          title="Rappels santé configurés"
          rows={reminders}
          columns={[
            { label: 'Libellé', render: (row) => row.label || `Mesure ${row.measurementType}` },
            { label: 'Horaire', render: (row) => `${String(row.hour).padStart(2, '0')}:${String(row.minute).padStart(2, '0')}` },
            { label: 'État', render: (row) => row.enabled ? 'Activé' : 'Désactivé' },
            { label: 'Répétition', render: (row) => `Masque ${row.daysMask}` },
          ]}
        />
      </section>
      <p className="medical-note">
        Une valeur SpO₂ au poignet peut varier avec le mouvement, la température, la circulation ou le positionnement.{' '}
        <a href={SOURCES.oxygen.href} target="_blank" rel="noreferrer">Voir les limites de l’oxymétrie <ArrowUpRight size={14} aria-hidden="true" /></a>
      </p>
    </div>
  )
}
