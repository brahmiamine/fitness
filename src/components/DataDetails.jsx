import { useEffect, useMemo, useState } from 'react'
import { ArrowDown, ArrowUp, ChevronDown, Database, Search, ShieldCheck, X } from 'lucide-react'
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

function comparableValue(column, row, index) {
  const value = column.sortValue ? column.sortValue(row, index) : column.render(row, index)
  if (typeof value === 'number') return value
  return String(value ?? '').toLocaleLowerCase()
}

function searchableValue(columns, row, index) {
  return columns.map((column) => {
    const value = column.searchValue ? column.searchValue(row, index) : column.render(row, index)
    return typeof value === 'string' || typeof value === 'number' ? String(value) : ''
  }).join(' ').toLocaleLowerCase()
}

export function DetailTable({ title, description, rows = [], columns, initial = 20, empty = 'Aucune donnée dans cette sauvegarde.', searchable = true }) {
  const [limit, setLimit] = useState(initial)
  const [query, setQuery] = useState('')
  const [sort, setSort] = useState({ index: null, direction: 'asc' })
  const filteredRows = useMemo(() => {
    const normalized = query.trim().toLocaleLowerCase()
    const filtered = normalized ? rows.filter((row, index) => searchableValue(columns, row, index).includes(normalized)) : [...rows]
    if (sort.index == null) return filtered
    const column = columns[sort.index]
    return filtered.sort((first, second) => {
      const a = comparableValue(column, first, 0)
      const b = comparableValue(column, second, 0)
      const result = typeof a === 'number' && typeof b === 'number' ? a - b : String(a).localeCompare(String(b), 'fr', { numeric: true })
      return sort.direction === 'asc' ? result : -result
    })
  }, [rows, columns, query, sort])
  const visible = filteredRows.slice(0, limit)

  useEffect(() => setLimit(initial), [query, sort, initial])

  const toggleSort = (index) => {
    setSort((current) => current.index === index
      ? { index, direction: current.direction === 'asc' ? 'desc' : 'asc' }
      : { index, direction: 'asc' })
  }

  return (
    <section className="detail-block">
      <header className="detail-block__header">
        <div>
          <h3>{title}</h3>
          {description && <p>{description}</p>}
        </div>
        <span className="count-badge">{formatNumber(filteredRows.length)}{filteredRows.length !== rows.length ? `/${formatNumber(rows.length)}` : ''}</span>
      </header>
      {!rows.length ? <p className="empty-data">{empty}</p> : (
        <>
          {searchable && (
            <div className="table-tools">
              <label><Search size={18} aria-hidden="true" /><span className="visually-hidden">Rechercher dans {title}</span><input type="search" value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Rechercher dans les mesures…" /></label>
              {query && <button type="button" className="icon-button" aria-label="Effacer la recherche" onClick={() => setQuery('')}><X size={18} aria-hidden="true" /></button>}
            </div>
          )}
          {!filteredRows.length ? <p className="empty-data">Aucune ligne ne correspond à « {query} ».</p> : <>
          <div className="data-table-scroll" tabIndex="0" aria-label={`${title}, tableau défilant`}>
            <table className="data-table">
              <thead><tr>{columns.map((column, index) => <th key={column.label} scope="col" aria-sort={sort.index === index ? (sort.direction === 'asc' ? 'ascending' : 'descending') : 'none'}><button type="button" onClick={() => toggleSort(index)}>{column.label}{sort.index === index ? sort.direction === 'asc' ? <ArrowUp size={14} /> : <ArrowDown size={14} /> : null}</button></th>)}</tr></thead>
              <tbody>
                {visible.map((row, index) => (
                  <tr key={row.id || `${title}-${index}`}>
                    {columns.map((column) => <td key={column.label}>{column.render(row, index)}</td>)}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {limit < filteredRows.length && (
            <button className="button button--secondary show-more" type="button" onClick={() => setLimit((value) => value + 50)}>
              Afficher 50 lignes de plus <ChevronDown size={17} aria-hidden="true" />
            </button>
          )}
          <p className="table-progress">{formatNumber(visible.length)} ligne{visible.length > 1 ? 's' : ''} affichée{visible.length > 1 ? 's' : ''} sur {formatNumber(filteredRows.length)}</p>
          </>}
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
