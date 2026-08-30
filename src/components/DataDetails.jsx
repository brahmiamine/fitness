import { useState } from 'react'
import { ChevronDown, Database, ShieldCheck } from 'lucide-react'
import { formatNumber } from '../lib/format'

const TABLE_LABELS = {
  DailyAppStats: 'Notifications par application',
  android_metadata: 'Configuration Android',
  appSetting: 'Paramètres internes Notify',
  blood_glucose: 'Glycémie manuelle',
  blood_pressure: 'Tension artérielle manuelle',
  day: 'Synthèses quotidiennes',
  gps: 'Points GPS',
  health_reminder: 'Rappels santé',
  heart: 'Fréquence cardiaque',
  profile: 'Profil du bracelet',
  record: 'Mesures minute par minute',
  room_master_table: 'Version interne de la base',
  sleep: 'Périodes de sommeil',
  sleepIntervals: 'Intervalles des stades de sommeil',
  spo2: 'Saturation en oxygène',
  sqlite_sequence: 'Compteurs internes SQLite',
  stats: 'Statistiques Notify',
  statsApp: 'Compteurs par application',
  statsLogs: 'Journal batterie et notifications',
  stress: 'Stress estimé',
  syncRecord: 'Synchronisations',
  weight: 'Poids manuel',
  workout: 'Séances sportives',
  workoutCurrent: 'Séance courante technique',
}

export function DetailTable({ title, description, rows = [], columns, initial = 20, empty = 'Aucune donnée dans cette sauvegarde.' }) {
  const [limit, setLimit] = useState(initial)
  const visible = rows.slice(0, limit)

  return (
    <section className="detail-block">
      <header className="detail-block__header">
        <div>
          <h3>{title}</h3>
          {description && <p>{description}</p>}
        </div>
        <span className="count-badge">{formatNumber(rows.length)}</span>
      </header>
      {!rows.length ? <p className="empty-data">{empty}</p> : (
        <>
          <div className="data-table-scroll" tabIndex="0" aria-label={`${title}, tableau défilant`}>
            <table className="data-table">
              <thead><tr>{columns.map((column) => <th key={column.label} scope="col">{column.label}</th>)}</tr></thead>
              <tbody>
                {visible.map((row, index) => (
                  <tr key={row.id || `${title}-${index}`}>
                    {columns.map((column) => <td key={column.label}>{column.render(row, index)}</td>)}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {limit < rows.length && (
            <button className="button button--secondary show-more" type="button" onClick={() => setLimit((value) => value + 50)}>
              Afficher 50 lignes de plus <ChevronDown size={17} aria-hidden="true" />
            </button>
          )}
          <p className="table-progress">{formatNumber(visible.length)} ligne{visible.length > 1 ? 's' : ''} affichée{visible.length > 1 ? 's' : ''} sur {formatNumber(rows.length)}</p>
        </>
      )}
    </section>
  )
}

export function ArchiveInventory({ dataset }) {
  const inventory = dataset.metadata?.inventory || []
  const protectedFields = dataset.metadata?.protectedFields || []
  return (
    <details className="archive-inventory">
      <summary><Database size={18} aria-hidden="true" /> Inventaire complet de la sauvegarde <span>{formatNumber(inventory.length)} tables</span></summary>
      <div className="archive-inventory__body">
        <p>Chaque table détectée est listée, y compris lorsqu’elle est vide. Les structures internes sont comptées sans être interprétées comme des mesures de santé.</p>
        <div className="inventory-list">
          {inventory.map((table) => (
            <div key={table.name}>
              <span><strong>{TABLE_LABELS[table.name] || table.name}</strong><small>{table.name}</small></span>
              <b>{formatNumber(table.rows)}</b>
            </div>
          ))}
        </div>
        {protectedFields.length > 0 && (
          <div className="protected-note"><ShieldCheck size={19} aria-hidden="true" /><p><strong>Données protégées</strong><br />{protectedFields.join(', ')} ne sont ni conservées dans l’historique ni affichées.</p></div>
        )}
      </div>
    </details>
  )
}
