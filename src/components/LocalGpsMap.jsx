import { useMemo, useState } from 'react'
import { LockKeyhole, Map, MapPin, Route } from 'lucide-react'
import { downsample, formatNumber, formatTime } from '../lib/format'

function project(points, width, height, padding) {
  const latitudes = points.map((point) => point.latitude)
  const longitudes = points.map((point) => point.longitude)
  const minLat = Math.min(...latitudes)
  const maxLat = Math.max(...latitudes)
  const minLng = Math.min(...longitudes)
  const maxLng = Math.max(...longitudes)
  const latSpan = Math.max(0.000001, maxLat - minLat)
  const lngSpan = Math.max(0.000001, maxLng - minLng)
  return points.map((point) => ({
    ...point,
    x: padding + ((point.longitude - minLng) / lngSpan) * (width - padding * 2),
    y: padding + (1 - (point.latitude - minLat) / latSpan) * (height - padding * 2),
  }))
}

export function LocalGpsMap({ points = [] }) {
  const [enabled, setEnabled] = useState(false)
  const width = 680
  const height = 360
  const projected = useMemo(() => project(downsample(points, 500), width, height, 32), [points])
  const path = projected.map((point) => `${point.x},${point.y}`).join(' ')

  return (
    <section className="local-map">
      <header>
        <div><span><Map size={19} aria-hidden="true" /></span><div><h3>Carte GPS locale facultative</h3><p>Trace schématique calculée dans cette session, sans fond de carte ni réseau.</p></div></div>
        {points.length > 0 && <button type="button" className="button button--secondary" aria-pressed={enabled} onClick={() => setEnabled((value) => !value)}>{enabled ? 'Masquer' : 'Afficher la trace'}</button>}
      </header>
      {!points.length ? (
        <p className="empty-data">Les coordonnées ne sont jamais enregistrées. Réimportez le backup pour activer temporairement la carte pendant cette session.</p>
      ) : !enabled ? (
        <div className="map-consent"><LockKeyhole size={21} aria-hidden="true" /><p><strong>{formatNumber(points.length)} coordonnées disponibles temporairement.</strong><br />L’affichage ne les copie pas dans IndexedDB et elles disparaissent au rechargement.</p></div>
      ) : (
        <div className="map-canvas">
          <svg viewBox={`0 0 ${width} ${height}`} role="img" aria-label={`Trace GPS locale de ${formatNumber(points.length)} points`}>
            <defs><pattern id="map-grid" width="40" height="40" patternUnits="userSpaceOnUse"><path d="M 40 0 L 0 0 0 40" fill="none" stroke="currentColor" strokeWidth="1" /></pattern></defs>
            <rect width={width} height={height} className="map-grid" fill="url(#map-grid)" />
            <polyline points={path} className="map-route" />
            {projected[0] && <circle cx={projected[0].x} cy={projected[0].y} r="7" className="map-start"><title>Départ {formatTime(projected[0].dateTime, projected[0].tz)}</title></circle>}
            {projected.at(-1) && <circle cx={projected.at(-1).x} cy={projected.at(-1).y} r="7" className="map-end"><title>Arrivée {formatTime(projected.at(-1).dateTime, projected.at(-1).tz)}</title></circle>}
            <text x={width - 28} y="30" textAnchor="middle" className="map-north">N</text>
          </svg>
          <div className="map-legend"><span><MapPin size={16} /> Départ</span><span><Route size={16} /> Arrivée</span><span><LockKeyhole size={16} /> Éphémère</span></div>
        </div>
      )}
    </section>
  )
}
