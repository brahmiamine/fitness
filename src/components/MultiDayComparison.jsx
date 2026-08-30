import { useMemo, useState } from 'react'
import { CalendarRange, TrendingDown, TrendingUp } from 'lucide-react'
import { formatDuration, formatNumber, formatShortDay } from '../lib/format'
import { LineChart } from './Charts'

const METRICS = {
  steps: { label: 'Pas', unit: 'pas', value: (row) => row.steps || 0, available: (row) => row.steps != null, format: (value) => formatNumber(value) },
  sleep: { label: 'Sommeil', unit: 'min', value: (row) => row.sleepMinutes || 0, available: (row) => row.sleepSessions > 0, format: (value) => formatDuration(value) },
  heart: { label: 'Cœur moyen', unit: 'bpm', value: (row) => row.heartAverage || 0, available: (row) => row.heartSamples > 0 || row.heartAverage > 0, format: (value) => `${formatNumber(value)} bpm` },
  oxygen: { label: 'SpO₂ moyenne', unit: '%', value: (row) => row.spo2Average || 0, available: (row) => row.spo2Samples > 0 || row.spo2Average > 0, format: (value) => `${formatNumber(value, 1)} %` },
  stress: { label: 'Stress moyen', unit: 'points', value: (row) => row.stressAverage || 0, available: (row) => row.stressSamples > 0 || row.stressAverage > 0, format: (value) => formatNumber(value, 1) },
}

export function MultiDayComparison({ dataset, day }) {
  const [range, setRange] = useState(7)
  const [metricKey, setMetricKey] = useState('steps')
  const metric = METRICS[metricKey]
  const days = useMemo(() => {
    const eligible = dataset.days.filter((item) => item.day <= day)
    return (range === 0 ? eligible : eligible.slice(0, range)).reverse()
  }, [dataset.days, day, range])
  const validDays = days.filter((item) => metric.available(item) && Number.isFinite(metric.value(item)))
  const latest = validDays.at(-1)
  const previous = validDays.at(-2)
  const delta = latest && previous ? metric.value(latest) - metric.value(previous) : null
  const average = validDays.length ? validDays.reduce((sum, item) => sum + metric.value(item), 0) / validDays.length : 0

  return (
    <section className="content-section comparison" aria-labelledby="comparison-title">
      <header className="section-heading comparison__heading">
        <div className="section-heading__title">
          <span className="section-heading__icon"><CalendarRange size={20} aria-hidden="true" /></span>
          <div><h2 id="comparison-title">Comparaison multi-jours</h2><p>Uniquement les journées du backup sélectionné, jusqu’à la date affichée.</p></div>
        </div>
      </header>

      <div className="comparison-controls">
        <label>Mesure<select value={metricKey} onChange={(event) => setMetricKey(event.target.value)}>
          {Object.entries(METRICS).map(([key, item]) => <option key={key} value={key}>{item.label}</option>)}
        </select></label>
        <div className="segmented-control" aria-label="Période de comparaison">
          {[7, 30, 90, 0].map((value) => (
            <button key={value} type="button" className={range === value ? 'is-active' : ''} aria-pressed={range === value} onClick={() => setRange(value)}>
              {value || 'Tout'}{value ? ' j' : ''}
            </button>
          ))}
        </div>
      </div>

      <div className="comparison-stats">
        <div><span>Moyenne</span><strong>{validDays.length ? metric.format(average) : '—'}</strong></div>
        <div><span>Dernière valeur</span><strong>{latest ? metric.format(metric.value(latest)) : '—'}</strong></div>
        <div className={delta > 0 ? 'is-up' : delta < 0 ? 'is-down' : ''}>
          <span>Écart au jour précédent</span>
          <strong>{delta == null ? '—' : <>{delta > 0 ? <TrendingUp size={17} /> : delta < 0 ? <TrendingDown size={17} /> : null}{delta > 0 ? '+' : delta < 0 ? '−' : ''}{metric.format(Math.abs(delta))}</>}</strong>
        </div>
      </div>

      {validDays.length > 1 ? (
        <LineChart
          data={validDays.map((item) => ({ value: metric.value(item), label: formatShortDay(item.day), source: item }))}
          label={`${metric.label} sur plusieurs jours`}
          unit={metric.unit}
          color="var(--primary)"
        />
      ) : <p className="chart-empty">Il faut au moins deux journées renseignées pour comparer cette mesure.</p>}
    </section>
  )
}
