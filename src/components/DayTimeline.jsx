import { useId, useMemo } from 'react'
import { localMinutes } from '../lib/format'
import { preferredHeartSeries } from '../lib/analysis'

function hourBuckets(records) {
  const buckets = Array.from({ length: 24 }, () => 0)
  records.forEach((record) => {
    const hour = Math.min(23, Math.floor(localMinutes(record.dateTime, record.tz) / 60))
    buckets[hour] += record.steps || 0
  })
  const maximum = Math.max(...buckets, 1)
  return buckets.map((value, hour) => ({ hour, value, ratio: value / maximum }))
}

export function DayTimeline({ dataset, day }) {
  const titleId = useId()
  const descriptionId = useId()
  const records = useMemo(() => dataset.records.filter((row) => row.day === day), [dataset, day])
  const sleep = useMemo(() => dataset.sleep.filter((row) => row.day === day), [dataset, day])
  const heart = useMemo(
    () => preferredHeartSeries(dataset.heart.filter((row) => row.day === day)),
    [dataset, day],
  )
  const activity = hourBuckets(records)
  const width = 720
  const left = 28
  const right = 16
  const usable = width - left - right
  const hourX = (minutes) => left + (Math.max(0, Math.min(1440, minutes)) / 1440) * usable
  const heartValues = heart.map((row) => row.value)
  const heartMin = Math.min(...heartValues, 40)
  const heartMax = Math.max(...heartValues, 100)
  const heartY = (value) => 126 - ((value - heartMin) / Math.max(1, heartMax - heartMin)) * 45
  const heartPoints = heart
    .filter((_, index) => index % Math.max(1, Math.floor(heart.length / 100)) === 0)
    .map((row) => `${hourX(localMinutes(row.dateTime, row.tz))},${heartY(row.value)}`)
    .join(' ')

  return (
    <div className="timeline-scroll">
      <svg className="day-timeline" viewBox={`0 0 ${width} 170`} role="img" aria-labelledby={`${titleId} ${descriptionId}`}>
        <title id={titleId}>Ligne de la journée</title>
        <desc id={descriptionId}>Sommeil, activité horaire et évolution de la fréquence cardiaque sur 24 heures.</desc>
        {[0, 6, 12, 18, 24].map((hour) => (
          <g key={hour}>
            <line className="timeline-grid" x1={hourX(hour * 60)} y1="24" x2={hourX(hour * 60)} y2="145" />
            <text className="timeline-label" x={hourX(hour * 60)} y="161" textAnchor={hour === 0 ? 'start' : hour === 24 ? 'end' : 'middle'}>
              {String(hour).padStart(2, '0')} h
            </text>
          </g>
        ))}
        <text className="timeline-row-label" x="0" y="43">Sommeil</text>
        {sleep.map((session, index) => {
          const rawStart = localMinutes(session.start, session.tz)
          const end = localMinutes(session.end, session.tz)
          const start = end < rawStart ? 0 : rawStart
          return (
            <rect
              key={`${session.start}-${index}`}
              className="timeline-sleep"
              x={hourX(start)}
              y="29"
              width={Math.max(3, hourX(end) - hourX(start))}
              height="19"
              rx="5"
            />
          )
        })}
        <text className="timeline-row-label" x="0" y="73">Pas</text>
        {activity.map((bucket) => (
          <rect
            key={bucket.hour}
            className="timeline-activity"
            x={hourX(bucket.hour * 60) + 1}
            y={76 - bucket.ratio * 22}
            width={Math.max(2, usable / 24 - 2)}
            height={Math.max(1, bucket.ratio * 22)}
            rx="2"
          />
        ))}
        <text className="timeline-row-label" x="0" y="112">Cœur</text>
        {heartPoints && <polyline className="timeline-heart" points={heartPoints} fill="none" />}
      </svg>
    </div>
  )
}
