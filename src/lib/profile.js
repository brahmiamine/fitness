import { loadProfileRecord, saveProfileRecord } from './storage'
import {
  PROFILE_FIELDS,
  PROFILE_SCHEMA_VERSION,
  PROFILE_SOURCES,
  REQUIRED_PROFILE_FIELDS,
  isFieldValuePresent,
  validateFieldValue,
} from './profileSchema'

function emptyField() {
  return { value: null, source: null, updatedAt: null, confidence: null }
}

export function createEmptyProfile() {
  return {
    schemaVersion: PROFILE_SCHEMA_VERSION,
    fields: Object.fromEntries(Object.keys(PROFILE_FIELDS).map((key) => [key, emptyField()])),
  }
}

function migrateProfile(stored) {
  const base = createEmptyProfile()
  if (!stored || typeof stored !== 'object') return base
  for (const key of Object.keys(PROFILE_FIELDS)) {
    const storedField = stored.fields?.[key]
    if (storedField && isFieldValuePresent(storedField.value)) {
      base.fields[key] = { ...emptyField(), ...storedField }
    }
  }
  return base
}

export async function loadProfile() {
  const stored = await loadProfileRecord()
  return migrateProfile(stored)
}

export async function persistProfile(profile) {
  await saveProfileRecord(profile)
  return profile
}

/**
 * Sets a field's value with explicit provenance. Returns a new profile
 * object; never mutates the input so callers can diff/re-render safely.
 */
export function setProfileField(profile, fieldKey, value, source, extra = {}) {
  const meta = PROFILE_FIELDS[fieldKey]
  if (!meta) throw new Error(`Champ de profil inconnu : ${fieldKey}`)
  if (!meta.allowedSources.includes(source)) {
    throw new Error(`La source "${source}" n’est pas autorisée pour le champ "${fieldKey}".`)
  }
  if (!validateFieldValue(fieldKey, value)) {
    throw new Error(`Valeur invalide pour "${fieldKey}".`)
  }
  return {
    ...profile,
    fields: {
      ...profile.fields,
      [fieldKey]: {
        value,
        source,
        updatedAt: new Date().toISOString(),
        confidence: extra.confidence ?? null,
      },
    },
  }
}

export function clearProfileField(profile, fieldKey) {
  return { ...profile, fields: { ...profile.fields, [fieldKey]: emptyField() } }
}

/**
 * Applies a fresh watch-derived measurement (e.g. the most recent manual
 * weight logged on the band) without ever touching sticky user goals such
 * as target weight, and without downgrading a newer user-entered value.
 */
export function applyWatchDerivedField(profile, fieldKey, value, { measuredAt } = {}) {
  const meta = PROFILE_FIELDS[fieldKey]
  if (!meta || !meta.allowedSources.includes(PROFILE_SOURCES.WATCH)) return profile
  if (!validateFieldValue(fieldKey, value)) return profile
  const current = profile.fields[fieldKey]
  const measuredTimestamp = measuredAt ? new Date(measuredAt).toISOString() : new Date().toISOString()
  if (current?.source === PROFILE_SOURCES.USER && current.updatedAt && current.updatedAt > measuredTimestamp) {
    return profile
  }
  if (current?.source === PROFILE_SOURCES.WATCH && current.updatedAt && current.updatedAt >= measuredTimestamp) {
    return profile
  }
  return {
    ...profile,
    fields: {
      ...profile.fields,
      [fieldKey]: { value, source: PROFILE_SOURCES.WATCH, updatedAt: measuredTimestamp, confidence: null },
    },
  }
}

export function applyDerivedField(profile, fieldKey, value, confidence = null) {
  const meta = PROFILE_FIELDS[fieldKey]
  if (!meta || !meta.allowedSources.includes(PROFILE_SOURCES.DERIVED)) return profile
  const current = profile.fields[fieldKey]
  if (current?.source === PROFILE_SOURCES.USER) return profile
  if (!validateFieldValue(fieldKey, value)) return profile
  return {
    ...profile,
    fields: {
      ...profile.fields,
      [fieldKey]: { value, source: PROFILE_SOURCES.DERIVED, updatedAt: new Date().toISOString(), confidence },
    },
  }
}

export function getFieldValue(profile, fieldKey) {
  return profile?.fields?.[fieldKey]?.value ?? null
}

export function getMissingRequiredFields(profile) {
  return REQUIRED_PROFILE_FIELDS.filter((key) => !isFieldValuePresent(getFieldValue(profile, key)))
}

export function isProfileComplete(profile) {
  return getMissingRequiredFields(profile).length === 0
}

/**
 * Flat, read-only snapshot for math/advisor engines: { sex, age, heightCm, ... }.
 * Missing values stay `null` rather than a default so downstream engines
 * must explicitly branch on "unknown" instead of silently computing on a guess.
 */
export function toProfileContext(profile) {
  return Object.fromEntries(
    Object.keys(PROFILE_FIELDS).map((key) => [key, getFieldValue(profile, key)]),
  )
}

/**
 * Finds the most recent manual weight measurement across the consolidated
 * history (dataset.weights rows use `{ day, dateTime, value }` in kg) and
 * folds it into the profile as a watch-sourced fact.
 */
export function syncWeightFromHistory(profile, weightRows = []) {
  const latest = weightRows
    .filter((row) => Number.isFinite(Number(row.value)) && Number(row.value) > 0)
    .sort((a, b) => (b.dateTime || 0) - (a.dateTime || 0))[0]
  if (!latest) return profile
  return applyWatchDerivedField(profile, 'weightKg', Number(latest.value), {
    measuredAt: latest.dateTime ? new Date(latest.dateTime).toISOString() : undefined,
  })
}

export { PROFILE_FIELDS, PROFILE_SOURCES, REQUIRED_PROFILE_FIELDS }
