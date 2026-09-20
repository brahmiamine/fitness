import { useEffect, useMemo, useRef, useState } from 'react'
import { CalendarDays, ChevronDown, Database, FileClock, LockKeyhole, Menu, Trash2, X } from 'lucide-react'
import { Dashboard } from './components/dashboard'
import { UploadPanel } from './components/UploadPanel'
import { InstallApp } from './components/InstallApp'
import { formatDay, formatShortDay } from './lib/format'
import { parseNxk } from './lib/nxk'
import { deleteImport, listImports, loadImportDay, prepareStorage, saveImport } from './lib/storage'

function Brand() {
  return (
    <a className="brand" href={import.meta.env.BASE_URL} aria-label="Pulse, accueil">
      <span className="brand__mark" aria-hidden="true"><i /><i /><i /></span>
      <span>Pulse</span>
    </a>
  )
}

function HistoryDialog({ dialogRef, imports, currentId, onSelect, onDelete, onImport, importState }) {
  return (
    <dialog ref={dialogRef} className="history-dialog" aria-labelledby="history-title" aria-describedby="history-description" onClick={(event) => {
      if (event.target === event.currentTarget) event.currentTarget.close()
    }}>
      <div className="history-panel">
        <header>
          <div>
            <h2 id="history-title">Historique privé</h2>
            <p id="history-description">Conservé uniquement dans ce navigateur.</p>
          </div>
          <button className="icon-button" type="button" aria-label="Fermer l’historique" onClick={() => dialogRef.current?.close()}>
            <X size={21} aria-hidden="true" />
          </button>
        </header>

        <InstallApp />

        <UploadPanel
          compact
          onImport={onImport}
          busy={importState.busy}
          progress={importState.progress}
          error={importState.error}
        />

        <div className="history-list" aria-label="Sauvegardes importées">
          {imports.map((item) => (
            <article key={item.id} className={`history-item ${currentId === item.id ? 'history-item--active' : ''}`}>
              <button type="button" className="history-item__select" onClick={() => {
                onSelect(item.id)
                dialogRef.current?.close()
              }}>
                <FileClock size={20} aria-hidden="true" />
                <span>
                  <strong>{formatShortDay(item.days[0]?.day)}</strong>
                  <small>{item.fileName} · {item.days.length} jour{item.days.length > 1 ? 's' : ''}</small>
                </span>
              </button>
              <button className="icon-button icon-button--danger" type="button" aria-label={`Supprimer ${item.fileName}`} onClick={() => onDelete(item.id)}>
                <Trash2 size={18} aria-hidden="true" />
              </button>
            </article>
          ))}
        </div>
      </div>
    </dialog>
  )
}

function EmptyState({ onImport, importState }) {
  return (
    <div className="empty-app">
      <header className="empty-header"><Brand /><InstallApp compact /></header>
      <main className="empty-main">
        <section className="empty-intro">
          <span className="empty-intro__label"><Database size={17} aria-hidden="true" /> Conseiller personnel</span>
          <h1>Importez vos données. Pulse vous dit quoi faire.</h1>
          <p>Pulse lit votre sauvegarde localement, compare vos habitudes et affiche seulement les décisions utiles pour aujourd’hui, demain et les prochains jours.</p>
          <div className="privacy-points">
            <span><LockKeyhole size={17} aria-hidden="true" /> Aucun envoi vers un serveur</span>
            <span><FileClock size={17} aria-hidden="true" /> Historique conservé localement</span>
          </div>
        </section>
        <UploadPanel onImport={onImport} {...importState} />
      </main>
      <footer className="empty-footer">Les données de la montre restent des estimations de bien-être et ne remplacent pas un professionnel de santé.</footer>
    </div>
  )
}

export default function App() {
  const [imports, setImports] = useState([])
  const [currentId, setCurrentId] = useState(() => localStorage.getItem('pulse-current-import') || '')
  const [day, setDay] = useState('')
  const [loading, setLoading] = useState(true)
  const [dataset, setDataset] = useState(null)
  const [dayLoading, setDayLoading] = useState(false)
  const [privateGps, setPrivateGps] = useState({ importId: '', rows: [] })
  const [importState, setImportState] = useState({ busy: false, progress: '', error: '' })
  const historyRef = useRef(null)

  const current = useMemo(
    () => imports.find((item) => item.id === currentId) || imports[0] || null,
    [imports, currentId],
  )

  useEffect(() => {
    listImports()
      .then((items) => {
        setImports(items)
        if (items.length && !items.some((item) => item.id === currentId)) setCurrentId(items[0].id)
      })
      .catch(() => setImportState((state) => ({ ...state, error: 'Impossible d’ouvrir l’historique local.' })))
      .finally(() => setLoading(false))
  }, [])

  useEffect(() => {
    if (!current) return
    localStorage.setItem('pulse-current-import', current.id)
    if (!current.days.some((item) => item.day === day)) setDay(current.days[0]?.day || '')
  }, [current, day])

  useEffect(() => {
    if (!current || !day) return
    let active = true
    setDayLoading(true)
    loadImportDay(current, day)
      .then((loaded) => {
        if (active) setDataset(loaded)
      })
      .catch(() => {
        if (active) setImportState((state) => ({ ...state, error: 'Impossible de charger cette journée depuis l’historique local.' }))
      })
      .finally(() => {
        if (active) setDayLoading(false)
      })
    return () => { active = false }
  }, [current?.id, current?.importedAt, day])

  async function handleImport(file) {
    setImportState({ busy: true, progress: 'Lecture du fichier…', error: '' })
    try {
      await prepareStorage(file.size)
      const parsed = await parseNxk(file, (progress) => setImportState({ busy: true, progress, error: '' }))
      await saveImport(parsed)
      setPrivateGps({ importId: parsed.id, rows: parsed.gpsPrivate || [] })
      const items = await listImports()
      setImports(items)
      setCurrentId(parsed.id)
      setDay(parsed.days[0]?.day || '')
      setImportState({ busy: false, progress: '', error: '' })
      historyRef.current?.close()
    } catch (error) {
      setImportState({ busy: false, progress: '', error: error instanceof Error ? error.message : 'La sauvegarde n’a pas pu être analysée.' })
    }
  }

  async function handleDelete(id) {
    const item = imports.find((entry) => entry.id === id)
    if (!item || !window.confirm(`Supprimer l’import « ${item.fileName} » de ce navigateur ?`)) return
    await deleteImport(id)
    if (privateGps.importId === id) setPrivateGps({ importId: '', rows: [] })
    const items = await listImports()
    setImports(items)
    if (currentId === id) setCurrentId(items[0]?.id || '')
  }

  if (loading) {
    return <div className="app-loading" role="status"><span className="loader" aria-hidden="true" /> Ouverture de votre historique…</div>
  }

  if (!current) return <EmptyState onImport={handleImport} importState={importState} />

  return (
    <div className="app-shell app-shell--single">
      <div className="app-content">
        <header className="topbar">
          <div className="topbar__mobile-brand"><Brand /></div>
          <div className="day-picker">
            <CalendarDays size={18} aria-hidden="true" />
            <label htmlFor="day-select">Journée</label>
            <select id="day-select" value={day} onChange={(event) => setDay(event.target.value)}>
              {current.days.map((item) => <option key={item.day} value={item.day}>{formatDay(item.day)}</option>)}
            </select>
            <ChevronDown size={17} aria-hidden="true" />
          </div>
          <button className="topbar__history" type="button" onClick={() => historyRef.current?.showModal()}>
            <Menu size={20} aria-hidden="true" />
            <span>Imports</span>
          </button>
        </header>

        <main className="main-content" id="main-content" aria-busy={dayLoading}>
          {dataset && dataset.id === current.id && (dataset.storageMode !== 'day-partitioned' || dataset.day === day)
            ? <Dashboard dataset={dataset} day={day} history={imports} />
            : <div className="app-loading app-loading--inline" role="status"><span className="loader" aria-hidden="true" /> Calcul des décisions…</div>}
        </main>
      </div>

      <HistoryDialog
        dialogRef={historyRef}
        imports={imports}
        currentId={current.id}
        onSelect={setCurrentId}
        onDelete={handleDelete}
        onImport={handleImport}
        importState={importState}
      />
    </div>
  )
}
