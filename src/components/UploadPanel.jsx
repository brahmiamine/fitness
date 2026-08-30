import { useRef, useState } from 'react'
import { FileArchive, LockKeyhole, Upload, X } from 'lucide-react'

export function UploadPanel({ onImport, busy, progress, error, compact = false }) {
  const inputRef = useRef(null)
  const [dragging, setDragging] = useState(false)

  function submit(file) {
    if (file && !busy) onImport(file)
  }

  function handleDrop(event) {
    event.preventDefault()
    setDragging(false)
    submit(event.dataTransfer.files?.[0])
  }

  return (
    <section className={`upload-panel ${compact ? 'upload-panel--compact' : ''}`} aria-labelledby="upload-title">
      <div className="upload-panel__privacy">
        <LockKeyhole size={18} aria-hidden="true" />
        <span>Analyse privée, directement sur cet appareil</span>
      </div>
      <div
        className={`drop-zone ${dragging ? 'drop-zone--active' : ''}`}
        onDragEnter={(event) => {
          event.preventDefault()
          setDragging(true)
        }}
        onDragOver={(event) => event.preventDefault()}
        onDragLeave={() => setDragging(false)}
        onDrop={handleDrop}
      >
        <FileArchive size={compact ? 30 : 42} strokeWidth={1.7} aria-hidden="true" />
        <div className="drop-zone__copy">
          <h2 id="upload-title">{compact ? 'Importer une autre sauvegarde' : 'Ouvrez votre sauvegarde fitness'}</h2>
          {!compact && <p>Choisissez le fichier <strong>backup.nxk</strong> exporté depuis Notify.</p>}
        </div>
        <input
          ref={inputRef}
          className="visually-hidden"
          type="file"
          accept=".nxk,.zip,application/zip"
          onChange={(event) => {
            const [file] = event.target.files || []
            event.target.value = ''
            submit(file)
          }}
          disabled={busy}
        />
        <button className="button button--primary" type="button" onClick={() => inputRef.current?.click()} disabled={busy}>
          <Upload size={18} aria-hidden="true" />
          {busy ? progress || 'Analyse en cours…' : 'Choisir un fichier NXK'}
        </button>
        {!compact && <p className="drop-zone__hint">Vous pouvez aussi déposer le fichier ici · 50 Mo maximum</p>}
      </div>
      {error && (
        <div className="inline-error" role="alert">
          <X size={18} aria-hidden="true" />
          <span>{error}</span>
        </div>
      )}
    </section>
  )
}
