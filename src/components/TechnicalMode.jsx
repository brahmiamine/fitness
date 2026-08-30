import { useMemo, useState } from 'react'
import { Binary, Braces, EyeOff, Search, ShieldCheck } from 'lucide-react'
import { formatBytes, formatNumber } from '../lib/format'

export function TechnicalMode({ dataset }) {
  const [enabled, setEnabled] = useState(false)
  const [query, setQuery] = useState('')
  const technical = dataset.technical
  const schema = useMemo(() => {
    const normalized = query.trim().toLocaleLowerCase()
    if (!normalized) return technical?.schema || []
    return (technical?.schema || []).filter((table) =>
      table.table.toLocaleLowerCase().includes(normalized)
      || table.columns.some((column) => column.name.toLocaleLowerCase().includes(normalized)),
    )
  }, [technical, query])
  if (!technical) return null

  return (
    <section className="content-section technical-mode" aria-labelledby="technical-title">
      <header className="technical-mode__header">
        <div><span><Binary size={21} aria-hidden="true" /></span><div><h2 id="technical-title">Mode technique avancé</h2><p>Structure des données obfusquées, sans révéler leurs valeurs ni les secrets.</p></div></div>
        <button type="button" className="button button--secondary" aria-pressed={enabled} onClick={() => setEnabled((value) => !value)}>{enabled ? 'Désactiver' : 'Activer'}</button>
      </header>
      {!enabled ? (
        <div className="protected-note"><EyeOff size={20} aria-hidden="true" /><p><strong>Masqué par défaut</strong><br />Ce mode expose uniquement noms de tables, colonnes, types, tailles et état de décodage.</p></div>
      ) : (
        <div className="technical-mode__body">
          <div className="technical-policy"><ShieldCheck size={20} aria-hidden="true" /><p>{technical.policy?.description}</p></div>
          <div className="obfuscated-list">
            {(technical.obfuscatedFields || []).map((field) => (
              <article key={field.source}><Braces size={18} aria-hidden="true" /><div><strong>{field.label}</strong><code>{field.source}</code></div><span>{formatBytes(field.totalBytes)} · {formatNumber(field.count)} bloc{field.count > 1 ? 's' : ''}</span></article>
            ))}
          </div>
          <label className="technical-search"><Search size={18} aria-hidden="true" /><span className="visually-hidden">Rechercher une table ou colonne</span><input type="search" value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Table ou colonne…" /></label>
          <div className="schema-catalog">
            {schema.map((table) => (
              <details key={table.table}>
                <summary><strong>{table.table}</strong><span>{formatNumber(table.columns.length)} colonnes</span></summary>
                <div className="schema-columns">
                  {table.columns.map((column) => (
                    <div key={column.name}><code>{column.name}</code><span>{column.type}</span><small>{column.primaryKey ? 'clé primaire' : column.nullable ? 'nullable' : 'obligatoire'}{column.adapted ? ' · adaptée' : ''}{column.protected ? ' · valeur protégée' : ''}</small></div>
                  ))}
                </div>
              </details>
            ))}
          </div>
        </div>
      )}
    </section>
  )
}
