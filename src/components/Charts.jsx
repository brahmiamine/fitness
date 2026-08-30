import { useId, useState } from 'react'
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
  const [selectedIndex, setSelectedIndex] = useState(null)
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
  const activeIndex = selectedIndex == null ? null : Math.min(selectedIndex, points.length - 1)
  const activePoint = activeIndex == null ? null : points[activeIndex]
  const activeX = activeIndex == null ? 0 : x(activeIndex)
  const tooltipX = Math.min(width - 152, Math.max(left + 4, activeX - 70))

  const selectFromPointer = (event) => {
    const bounds = event.currentTarget.getBoundingClientRect()
    const ratio = Math.min(1, Math.max(0, (event.clientX - bounds.left) / bounds.width))
    setSelectedIndex(Math.round(ratio * (points.length - 1)))
  }

  const navigate = (event) => {
    if (!['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) return
    event.preventDefault()
    if (event.key === 'Home') setSelectedIndex(0)
    else if (event.key === 'End') setSelectedIndex(points.length - 1)
    else setSelectedIndex((current) => Math.min(points.length - 1, Math.max(0, (current ?? 0) + (event.key === 'ArrowRight' ? 1 : -1))))
  }

  return (
    <div className="line-chart">
      <svg
        viewBox={`0 0 ${width} ${height}`}
        role="img"
        tabIndex="0"
        aria-labelledby={`${titleId} ${descriptionId}`}
        onPointerMove={selectFromPointer}
        onPointerDown={selectFromPointer}
        onPointerLeave={() => setSelectedIndex(null)}
        onFocus={() => setSelectedIndex((current) => current ?? 0)}
        onBlur={() => setSelectedIndex(null)}
        onKeyDown={navigate}
      >
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
        {activePoint && (
          <g className="chart-selection" aria-hidden="true">
            <line x1={activeX} y1={top} x2={activeX} y2={top + chartHeight} />
            <circle cx={activeX} cy={y(activePoint.value)} r="6" fill={color} />
            <g transform={`translate(${tooltipX} ${Math.max(top + 3, y(activePoint.value) - 55)})`}>
              <rect width="148" height="43" rx="7" />
              <text x="10" y="17">{activePoint.label || `Point ${activeIndex + 1}`}</text>
              <text x="10" y="34" className="chart-tooltip-value">{formatNumber(activePoint.value, 1)} {unit}</text>
            </g>
          </g>
        )}
        <text className="chart-axis-text" x={left} y={height - 7}>{points[0]?.label || 'Début'}</text>
        <text className="chart-axis-text" x={width - right} y={height - 7} textAnchor="end">{points.at(-1)?.label || 'Fin'}</text>
      </svg>
      <p className="chart-interaction-hint">Touchez ou survolez la courbe. Au clavier : flèches gauche et droite.</p>
      <p className="visually-hidden" aria-live="polite">{activePoint ? `${activePoint.label}, ${formatNumber(activePoint.value, 1)} ${unit}` : ''}</p>
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
