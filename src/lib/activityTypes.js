/**
 * `record.type`, `record.activityType` et `workout.type` stockent des codes numériques internes
 * au bracelet. Leur catalogue exact n’est pas publié par le fabricant : plutôt que d’inventer une
 * liste de sports non vérifiable, ces fonctions rendent les codes bruts lisibles (contexte
 * standard vs séance identifiée) sans jamais leur attribuer un nom de sport non confirmé.
 */

export function describeRecordType(type) {
  const code = Number(type) || 0
  if (code === 0) return 'Suivi standard'
  return `Suivi standard (contexte ${code})`
}

export function describeSportType(code, title) {
  const numericCode = Number(code) || 0
  const cleanTitle = String(title || '').trim()
  if (cleanTitle) return cleanTitle
  if (numericCode === 0) return 'Séance sans type enregistré'
  return `Séance sportive (code ${numericCode})`
}
