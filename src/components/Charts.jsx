import { useId } from 'react'
import { downsample, formatNumber } from '../lib/format'

function extent(values) {
  if (!values.length) return [0, 1]
  const minimum = Math.min(...values)
  const maximum = Math.max(...values)
  if (minimum === maximum) return [minimum - 1, maximum + 1]
  const padding = (maximum - minimum) * 0.12
  return [minimum - padding, maximum + padding]
}

export function LineChart({ data, label, unit, color = 'var(--accent)', emptyLabel = 'Aucune mesure disponible' }) {
  const titleId = useId()
  const descriptionId = useId()
  const points = downsample(data.filter((point) => Number.isFinite(point.value)), 100)
  if (!points.length) return <div className="chart-empty">{emptyLabel}</div>

  const [minimum, maximum] = extent(points.map((point) => point.value))
  const width = 640
  const height = 220
  const left = 34
  const right = 12
  const top = 14
  const bottom = 28
  const chartWidth = width - left - right
  const chartHeight = height - top - bottom
  const x = (index) => left + (index / Math.max(1, points.length - 1)) * chartWidth
  const y = (value) => top + (1 - (value - minimum) / (maximum - minimum)) * chartHeight
  const coordinates = points.map((point, index) => `${x(index)},${y(point.value)}`).join(' ')
  const average = points.reduce((sum, point) => sum + point.value, 0) / points.length

  return (
    <div className="line-chart">
      <svg viewBox={`0 0 ${width} ${height}`} role="img" aria-labelledby={`${titleId} ${descriptionId}`}>
        <title id={titleId}>{label}</title>
        <desc id={descriptionId}>
          {points.length} points affichés, de {formatNumber(Math.min(...points.map((point) => point.value)), 1)} à{' '}
          {formatNumber(Math.max(...points.map((point) => point.value)), 1)} {unit}.
        </desc>
        {[0, 0.5, 1].map((ratio) => {
          const lineY = top + ratio * chartHeight
          const value = maximum - ratio * (maximum - minimum)
          return (
            <g key={ratio}>
              <line className="chart-grid-line" x1={left} y1={lineY} x2={width - right} y2={lineY} />
              <text className="chart-axis-text" x={left - 7} y={lineY + 4} textAnchor="end">
                {Math.round(value)}
              </text>
            </g>
          )
        })}
        <line className="chart-average-line" x1={left} y1={y(average)} x2={width - right} y2={y(average)} />
        <polygon
          points={`${left},${top + chartHeight} ${coordinates} ${width - right},${top + chartHeight}`}
          fill={color}
          opacity="0.09"
        />
        <polyline points={coordinates} fill="none" stroke={color} strokeWidth="3" strokeLinejoin="round" strokeLinecap="round" />
        <text className="chart-axis-text" x={left} y={height - 7}>{points[0]?.label || 'Début'}</text>
        <text className="chart-axis-text" x={width - right} y={height - 7} textAnchor="end">{points.at(-1)?.label || 'Fin'}</text>
      </svg>
    </div>
  )
}

export function StageBar({ sleep }) {
  const total = sleep.light + sleep.deep + sleep.rem + sleep.awake
  if (!total) return <div className="chart-empty">Aucun stade de sommeil disponible</div>
  const segments = [
    { key: 'deep', label: 'Profond', value: sleep.deep },
    { key: 'light', label: 'Léger', value: sleep.light },
    { key: 'rem', label: 'Paradoxal', value: sleep.rem },
    { key: 'awake', label: 'Éveillé', value: sleep.awake },
  ].filter((segment) => segment.value > 0)

  return (
    <div className="stage-chart">
      <div className="stage-bar" role="img" aria-label={segments.map((segment) => `${segment.label} ${segment.value} minutes`).join(', ')}>
        {segments.map((segment) => (
          <span
            key={segment.key}
            className={`stage-bar__segment stage-bar__segment--${segment.key}`}
            style={{ width: `${(segment.value / total) * 100}%` }}
          />
        ))}
      </div>
      <div className="stage-legend">
        {segments.map((segment) => (
          <span key={segment.key} className={`stage-legend__item stage-legend__item--${segment.key}`}>
            <i aria-hidden="true" /> {segment.label} · {segment.value} min
          </span>
        ))}
      </div>
    </div>
  )
}
