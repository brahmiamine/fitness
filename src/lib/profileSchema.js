export const PROFILE_SCHEMA_VERSION = 1

export const PROFILE_SOURCES = {
  USER: 'user',
  WATCH: 'watch',
  DERIVED: 'derived',
}

/**
 * Facts the advisor/math engines need that cannot be reliably derived from
 * the NXK backup. `required` fields block calculations (BMI, BMR, energy
 * needs, heart-rate zones) until the person answers once; Pulse must never
 * guess them.
 */
export const PROFILE_FIELDS = {
  sex: {
    label: 'Sexe physiologique utilisé par les formules',
    help: 'Utilisé uniquement pour les formules de calories et de fréquence cardiaque, jamais affiché comme identité.',
    type: 'enum',
    options: ['male', 'female'],
    required: true,
    allowedSources: [PROFILE_SOURCES.USER],
  },
  age: {
    label: 'Âge',
    unit: 'ans',
    type: 'number',
    min: 13,
    max: 120,
    required: true,
    allowedSources: [PROFILE_SOURCES.USER],
  },
  heightCm: {
    label: 'Taille',
    unit: 'cm',
    type: 'number',
    min: 100,
    max: 250,
    required: true,
    allowedSources: [PROFILE_SOURCES.USER],
  },
  weightKg: {
    label: 'Poids actuel',
    unit: 'kg',
    type: 'number',
    min: 30,
    max: 300,
    required: true,
    allowedSources: [PROFILE_SOURCES.USER, PROFILE_SOURCES.WATCH],
    preferredSource: PROFILE_SOURCES.WATCH,
  },
  targetWeightKg: {
    label: 'Poids cible',
    unit: 'kg',
    type: 'number',
    min: 30,
    max: 300,
    required: false,
    allowedSources: [PROFILE_SOURCES.USER],
    sticky: true,
  },
  activityLevel: {
    label: 'Niveau d’activité habituel',
    type: 'enum',
    options: ['sedentary', 'light', 'moderate', 'active', 'very_active'],
    required: false,
    allowedSources: [PROFILE_SOURCES.USER, PROFILE_SOURCES.DERIVED],
    preferredSource: PROFILE_SOURCES.DERIVED,
  },
  maritalStatus: {
    label: 'Statut personnel',
    help: 'Métadonnée de contexte uniquement : n’influence jamais un calcul physiologique.',
    type: 'enum',
    options: ['single', 'married', 'partnered', 'other'],
    required: false,
    allowedSources: [PROFILE_SOURCES.USER],
    physiological: false,
  },
}

export const REQUIRED_PROFILE_FIELDS = Object.keys(PROFILE_FIELDS).filter(
  (key) => PROFILE_FIELDS[key].required,
)

export function isFieldValuePresent(value) {
  return value !== null && value !== undefined && value !== ''
}

export function validateFieldValue(fieldKey, value) {
  const meta = PROFILE_FIELDS[fieldKey]
  if (!meta) return false
  if (!isFieldValuePresent(value)) return false
  if (meta.type === 'number') {
    const number = Number(value)
    if (!Number.isFinite(number)) return false
    if (meta.min != null && number < meta.min) return false
    if (meta.max != null && number > meta.max) return false
    return true
  }
  if (meta.type === 'enum') {
    return meta.options.includes(value)
  }
  return true
}
