/**
 * Personal Health Math Engine (#22). Every derived metric is versioned and
 * carries its formula metadata (source, population, units, limitations,
 * assumptions) so the UI never shows a number without an explanation.
 *
 * Critical rule: BMI/BMR require height. When height is absent from the
 * parsed profile this module returns an explicit `missingInput: 'height'`
 * and a non-computable state — it never infers height from steps, weight,
 * sex or device data. Watch calorie estimates are treated as estimates,
 * never as measured energy expenditure.
 */
export const HEALTH_MATH_VERSION = '1.0.0'

export const FORMULAS = {
  bmi: {
    id: 'bmi-who',
    version: '1.0.0',
    label: 'Indice de masse corporelle',
    source: 'Organisation mondiale de la santé (OMS) — classification de l’IMC adulte',
    url: 'https://www.who.int/news-room/fact-sheets/detail/obesity-and-overweight',
    population: 'Adultes de 18 ans et plus, hors grossesse et pratiques sportives de haut niveau',
    units: 'kg/m²',
    limitations: 'Ne distingue pas masse grasse et masse musculaire ; interprétation limitée chez les sportifs et les personnes très musclées.',
  },
  bmr: {
    id: 'bmr-mifflin-st-jeor',
    version: '1.0.0',
    label: 'Métabolisme de base estimé',
    source: 'Mifflin et al., 1990 — équation de Mifflin-St Jeor',
    url: 'https://pubmed.ncbi.nlm.nih.gov/2305711/',
    population: 'Adultes non hospitalisés',
    units: 'kcal/jour',
    limitations: 'Estimation de population, pas une mesure de calorimétrie ; l’écart individuel peut être notable.',
  },
  energyNeed: {
    id: 'tdee-activity-factor',
    version: '1.0.0',
    label: 'Besoin énergétique quotidien estimé',
    source: 'Facteurs d’activité usuels appliqués au métabolisme de base',
    url: 'https://www.niddk.nih.gov/health-information/weight-management/body-weight-planner',
    population: 'Adultes',
    units: 'kcal/jour',
    limitations: 'Le niveau d’activité est une estimation ; les calories du bracelet ne sont pas une mesure exacte de la dépense.',
  },
  weightTrend: {
    id: 'weight-trend-least-squares',
    version: '1.0.0',
    label: 'Tendance de poids',
    source: 'Régression linéaire sur les pesées horodatées',
    url: 'https://www.niddk.nih.gov/health-information/weight-management/body-weight-planner',
    population: 'Adultes avec au moins deux pesées fiables',
    units: 'kg/semaine',
    limitations: 'Sensible aux périodes trop courtes ou aux pesées trop espacées ; la variation d’hydratation n’est pas distinguée.',
  },
  energyTarget: {
    id: 'energy-target-niddk',
    version: '1.0.0',
    label: 'Cible énergétique estimée',
    source: 'National Institute of Diabetes and Digestive and Kidney Diseases (NIDDK)',
    url: 'https://www.niddk.nih.gov/health-information/weight-management/body-weight-planner',
    population: 'Adultes cherchant à maintenir ou modifier progressivement leur poids',
    units: 'kcal/jour',
    limitations: 'Approximation basée sur 7 700 kcal par kg de masse corporelle ; ne remplace pas un suivi nutritionnel individualisé.',
  },
}

const ACTIVITY_FACTORS = {
  sedentary: { factor: 1.2, label: 'Sédentaire' },
  light: { factor: 1.375, label: 'Légèrement actif' },
  moderate: { factor: 1.55, label: 'Modérément actif' },
  active: { factor: 1.725, label: 'Actif' },
  very_active: { factor: 1.9, label: 'Très actif' },
}

// Documented, moderate approximation: one kilogram of body mass ≈ 7 700 kcal.
const KCAL_PER_KG = 7700
export const PROGRESSIVE_RATE_DEFAULTS = { minimumKgPerWeek: 0.25, maximumKgPerWeek: 0.75, defaultKgPerWeek: 0.5 }

function missing(fields) {
  const list = fields.filter(Boolean)
  return {
    computable: false,
    missingInput: list[0] || null,
    missingInputs: list,
    value: null,
  }
}

function hasNumber(value) {
  return Number.isFinite(Number(value)) && Number(value) > 0
}

export function bmiCategory(bmi) {
  if (!Number.isFinite(bmi)) return null
  if (bmi < 18.5) return 'insuffisance_ponderale'
  if (bmi < 25) return 'corpulence_normale'
  if (bmi < 30) return 'surpoids'
  return 'obesite'
}

export function computeBmi({ heightCm, weightKg } = {}) {
  if (!hasNumber(heightCm)) return missing([!hasNumber(heightCm) && 'height'])
  if (!hasNumber(weightKg)) return missing([!hasNumber(heightCm) && 'height', !hasNumber(weightKg) && 'weight'])
  const metres = Number(heightCm) / 100
  const value = Number(weightKg) / (metres * metres)
  return {
    computable: true,
    missingInput: null,
    missingInputs: [],
    value: Math.round(value * 10) / 10,
    category: bmiCategory(value),
    formula: FORMULAS.bmi,
    inputs: { heightCm: Number(heightCm), weightKg: Number(weightKg) },
  }
}

export function computeBmr({ sex, age, heightCm, weightKg } = {}) {
  const missingFields = []
  if (!['male', 'female'].includes(sex)) missingFields.push('sex')
  if (!hasNumber(age)) missingFields.push('age')
  if (!hasNumber(heightCm)) missingFields.push('height')
  if (!hasNumber(weightKg)) missingFields.push('weight')
  if (missingFields.length) return missing(missingFields)
  const base = 10 * Number(weightKg) + 6.25 * Number(heightCm) - 5 * Number(age)
  const value = sex === 'male' ? base + 5 : base - 161
  return {
    computable: true,
    missingInput: null,
    missingInputs: [],
    value: Math.round(value),
    formula: FORMULAS.bmr,
    inputs: { sex, age: Number(age), heightCm: Number(heightCm), weightKg: Number(weightKg) },
  }
}

export function computeEnergyNeed({ bmr, activityLevel } = {}) {
  if (!Number.isFinite(Number(bmr)) || Number(bmr) <= 0) {
    return { ...missing(['bmr']), formula: FORMULAS.energyNeed }
  }
  const known = ACTIVITY_FACTORS[activityLevel]
  const factor = known ? known.factor : ACTIVITY_FACTORS.sedentary.factor
  return {
    computable: true,
    missingInput: null,
    missingInputs: [],
    value: Math.round(Number(bmr) * factor),
    assumption: known ? null : 'activityLevel_non_renseigne_sedentaire_suppose',
    factor,
    activityLevel: known ? activityLevel : null,
    confidence: known ? 0.7 : 0.4,
    formula: FORMULAS.energyNeed,
    inputs: { bmr: Number(bmr), activityLevel: activityLevel || null, factor },
  }
}

/**
 * Rolling weight trend. Uses every reliable measurement inside the window
 * (not just first/last) and a least-squares slope, so irregular spacing
 * does not let one weigh-in dominate. Returns a non-ready state rather than
 * a guessed rate when the evidence is too thin.
 */
export function modelWeightTrend(snapshots = [], targetDay, options = {}) {
  const { windowDays = 28, minimumSamples = 2, minimumSpanDays = 3 } = options
  const targetMs = Date.parse(`${targetDay}T23:59:59Z`)
  const points = snapshots
    .filter((snapshot) => snapshot.day <= targetDay && Number.isFinite(Date.parse(`${snapshot.day}T00:00:00Z`)))
    .filter((snapshot) => !targetDay || (targetMs - Date.parse(`${snapshot.day}T00:00:00Z`)) / 86_400_000 <= windowDays)
    .map((snapshot) => {
      const valueKg = Number(snapshot.weight?.valueKg)
      if (!Number.isFinite(valueKg) || valueKg <= 0) return null
      const rawMeasuredAt = snapshot.weight?.measuredAt
      const measuredAt = Number.isFinite(rawMeasuredAt) ? rawMeasuredAt : Date.parse(rawMeasuredAt || `${snapshot.day}T12:00:00Z`)
      if (!Number.isFinite(measuredAt)) return null
      return { day: snapshot.day, measuredAt, valueKg }
    })
    .filter(Boolean)
    .sort((a, b) => a.measuredAt - b.measuredAt)

  if (points.length < minimumSamples) {
    return { ready: false, reason: 'insufficient_measurements', sampleCount: points.length, latestKg: points.at(-1)?.valueKg ?? null, formula: FORMULAS.weightTrend }
  }
  const spanDays = (points.at(-1).measuredAt - points[0].measuredAt) / 86_400_000
  if (spanDays < minimumSpanDays) {
    return { ready: false, reason: 'insufficient_span', sampleCount: points.length, latestKg: points.at(-1).valueKg, formula: FORMULAS.weightTrend }
  }
  const xMean = points.reduce((sum, point) => sum + point.measuredAt, 0) / points.length
  const yMean = points.reduce((sum, point) => sum + point.valueKg, 0) / points.length
  const denominator = points.reduce((sum, point) => sum + (point.measuredAt - xMean) ** 2, 0)
  const slopePerMs = denominator ? points.reduce((sum, point) => sum + (point.measuredAt - xMean) * (point.valueKg - yMean), 0) / denominator : 0
  const ratePerWeek = slopePerMs * 7 * 86_400_000
  const confidence = Math.round(Math.min(1, points.length / 8) * Math.min(1, spanDays / 28) * 100) / 100
  return {
    ready: true,
    reason: null,
    sampleCount: points.length,
    spanDays: Math.round(spanDays),
    startKg: points[0].valueKg,
    latestKg: points.at(-1).valueKg,
    changeKg: Math.round((points.at(-1).valueKg - points[0].valueKg) * 10) / 10,
    rateKgPerWeek: Math.round(ratePerWeek * 100) / 100,
    direction: Math.abs(ratePerWeek) < 0.05 ? 'stable' : ratePerWeek > 0 ? 'up' : 'down',
    confidence,
    formula: FORMULAS.weightTrend,
  }
}

/**
 * Progress toward the profile's target weight and an estimated daily
 * energy target. Values come from the profile/trend; nothing (82→75) is
 * hardcoded. The rate is clamped to a progressive, moderate range so the
 * planner can never suggest aggressive one-day compensation.
 */
export function modelWeightGoal({ profileContext = {}, trend, tdee } = {}) {
  const targetWeightKg = hasNumber(profileContext.targetWeightKg) ? Number(profileContext.targetWeightKg) : null
  const currentWeightKg = trend?.latestKg ?? (hasNumber(profileContext.weightKg) ? Number(profileContext.weightKg) : null)
  const startWeightKg = trend?.startKg ?? currentWeightKg
  if (targetWeightKg == null || currentWeightKg == null) {
    return { computable: false, missingInput: targetWeightKg == null ? 'targetWeightKg' : 'weightKg', targetWeightKg, currentWeightKg, trend: trend || null, formula: FORMULAS.energyTarget }
  }
  const remainingKg = Math.round((currentWeightKg - targetWeightKg) * 10) / 10
  const direction = Math.abs(remainingKg) < 0.5 ? 'maintain' : remainingKg > 0 ? 'loss' : 'gain'
  const requestedRate = trend?.ready ? Math.min(Math.abs(trend.rateKgPerWeek), PROGRESSIVE_RATE_DEFAULTS.maximumKgPerWeek) : PROGRESSIVE_RATE_DEFAULTS.defaultKgPerWeek
  const rateKgPerWeek = direction === 'maintain' ? 0 : Math.max(PROGRESSIVE_RATE_DEFAULTS.minimumKgPerWeek, requestedRate)
  const dailyEnergyDelta = Math.round((rateKgPerWeek * KCAL_PER_KG) / 7)
  const totalKg = Math.abs(startWeightKg - targetWeightKg)
  const progressRatio = totalKg ? Math.max(0, Math.min(1, (startWeightKg - currentWeightKg) / (startWeightKg - targetWeightKg))) : (direction === 'maintain' ? 1 : 0)
  return {
    computable: true,
    missingInput: null,
    targetWeightKg,
    currentWeightKg,
    startWeightKg,
    remainingKg,
    direction,
    rateKgPerWeek: Math.round(rateKgPerWeek * 100) / 100,
    estimatedWeeks: direction === 'maintain' ? 0 : Math.ceil(Math.abs(remainingKg) / rateKgPerWeek),
    progressRatio: Math.round(progressRatio * 100) / 100,
    energyTargetKcal: Number.isFinite(Number(tdee)) ? Math.round(Number(tdee) + (direction === 'loss' ? -dailyEnergyDelta : direction === 'gain' ? dailyEnergyDelta : 0)) : null,
    dailyEnergyDeltaKcal: direction === 'maintain' ? 0 : (direction === 'loss' ? -dailyEnergyDelta : dailyEnergyDelta),
    isEstimate: true,
    trend: trend || null,
    formula: FORMULAS.energyTarget,
    rateBounds: PROGRESSIVE_RATE_DEFAULTS,
  }
}

/**
 * One entry point returning every derived metric with its computable state.
 */
export function buildHealthMath({ profileContext = {}, snapshots = [], targetDay } = {}) {
  const bmi = computeBmi({ heightCm: profileContext.heightCm, weightKg: profileContext.weightKg })
  const bmr = computeBmr({ sex: profileContext.sex, age: profileContext.age, heightCm: profileContext.heightCm, weightKg: profileContext.weightKg })
  const energyNeed = bmr.computable ? computeEnergyNeed({ bmr: bmr.value, activityLevel: profileContext.activityLevel }) : { ...missing(['bmr']), formula: FORMULAS.energyNeed }
  const trend = modelWeightTrend(snapshots, targetDay)
  const weightGoal = modelWeightGoal({ profileContext, trend, tdee: energyNeed.computable ? energyNeed.value : null })
  return { version: HEALTH_MATH_VERSION, targetDay, bmi, bmr, energyNeed, weightTrend: trend, weightGoal }
}
