import { GUIDANCE_LEVELS } from '../guidanceLevels'

export const EVIDENCE_REGISTRY_VERSION = 1

/**
 * One versioned entry per generic health reference the advisor is allowed
 * to cite. Nothing in `src/lib/advisor/**` may hardcode a population
 * threshold or guardrail without going through this registry — see
 * safetyPolicy.js, which refuses to build guidance from an unknown id.
 */
const ENTRIES = [
  {
    id: 'who-activity-2020',
    domain: 'activity',
    population: 'Adultes de 18 à 64 ans',
    organization: 'Organisation mondiale de la santé (OMS)',
    url: 'https://www.who.int/europe/publications/i/item/9789240014886',
    version: '2020',
    reviewedAt: '2020-11-25',
    rule: '150 à 300 minutes d’activité modérée par semaine (ou 75 à 150 minutes d’activité intense), et limiter les longues périodes sédentaires.',
    allowedActionClasses: [GUIDANCE_LEVELS.INFO, GUIDANCE_LEVELS.ADVICE, GUIDANCE_LEVELS.COMMITMENT],
    limitations: 'Recommandation de population ; ne remplace pas un avis médical individualisé, notamment en cas de pathologie ou blessure.',
  },
  {
    id: 'fda-pulse-oximeter-2021',
    domain: 'oxygen',
    population: 'Utilisateurs grand public d’un oxymètre ou d’un capteur SpO₂ de bracelet',
    organization: 'Food and Drug Administration (FDA)',
    url: 'https://www.fda.gov/consumers/consumer-updates/pulse-oximeter-basics',
    version: '2021',
    reviewedAt: '2021-02-19',
    rule: 'Les oxymètres grand public peuvent être faussés par le mouvement, le froid, le vernis à ongles ou la pigmentation de la peau ; une valeur isolée basse doit être recontrôlée au calme avant d’être interprétée.',
    allowedActionClasses: [GUIDANCE_LEVELS.INFO, GUIDANCE_LEVELS.RECHECK, GUIDANCE_LEVELS.MONITOR],
    limitations: 'Ne pose aucun diagnostic et ne remplace pas un oxymètre médical certifié.',
  },
  {
    id: 'who-hypertension-2021',
    domain: 'bloodPressure',
    population: 'Adultes mesurant leur tension artérielle à domicile',
    organization: 'Organisation mondiale de la santé (OMS)',
    url: 'https://www.who.int/news-room/fact-sheets/detail/hypertension',
    version: '2021',
    reviewedAt: '2021-08-25',
    rule: 'Une mesure de tension élevée isolée ne suffit pas : la confirmation repose sur des mesures répétées, comparables et correctement réalisées.',
    allowedActionClasses: [GUIDANCE_LEVELS.INFO, GUIDANCE_LEVELS.RECHECK, GUIDANCE_LEVELS.MONITOR, GUIDANCE_LEVELS.SEEK_MEDICAL_ADVICE],
    limitations: 'Repère de population ; ne pose aucun diagnostic et ne remplace pas une mesure validée par un professionnel de santé.',
  },
  {
    id: 'who-diabetes-glycaemia',
    domain: 'bloodGlucose',
    population: 'Adultes suivant une glycémie capillaire ou de capteur',
    organization: 'Organisation mondiale de la santé (OMS)',
    url: 'https://www.who.int/news-room/fact-sheets/detail/diabetes',
    version: '2023',
    reviewedAt: '2023-04-05',
    rule: 'L’interprétation d’une glycémie dépend du contexte (à jeun ou après repas) ; des valeurs répétées hors repère justifient un avis professionnel.',
    allowedActionClasses: [GUIDANCE_LEVELS.INFO, GUIDANCE_LEVELS.RECHECK, GUIDANCE_LEVELS.MONITOR, GUIDANCE_LEVELS.SEEK_MEDICAL_ADVICE],
    limitations: 'Repère de population ; ne remplace pas une mesure médicale ni un suivi individualisé.',
  },
  {
    id: 'niddk-body-weight-planner',
    domain: 'weight',
    population: 'Adultes cherchant à modifier leur poids corporel',
    organization: 'National Institute of Diabetes and Digestive and Kidney Diseases (NIDDK)',
    url: 'https://www.niddk.nih.gov/health-information/weight-management/body-weight-planner',
    version: '2023',
    reviewedAt: '2023-01-01',
    rule: 'Un déficit ou surplus calorique modéré et soutenu dans le temps est plus sûr et plus durable qu’une restriction ou un excès sévère.',
    allowedActionClasses: [GUIDANCE_LEVELS.INFO, GUIDANCE_LEVELS.ADVICE, GUIDANCE_LEVELS.COMMITMENT],
    limitations: 'Modèle de population ; ne remplace pas un suivi nutritionnel individualisé, en particulier en cas de pathologie, grossesse ou trouble alimentaire.',
  },
  {
    id: 'inserm-sleep-duration',
    domain: 'sleep',
    population: 'Adultes',
    organization: 'Institut national de la santé et de la recherche médicale (Inserm)',
    url: 'https://presse.inserm.fr/sommeil-et-immunite-des-liens-etroits-des-les-premieres-annees-de-vie/',
    version: '2022',
    reviewedAt: '2022-01-01',
    rule: 'Repère usuel de 7 à 9 heures de sommeil par nuit chez l’adulte.',
    allowedActionClasses: [GUIDANCE_LEVELS.INFO, GUIDANCE_LEVELS.ADVICE, GUIDANCE_LEVELS.COMMITMENT],
    limitations: 'Repère de population ; les besoins individuels varient et les stades de sommeil du bracelet restent des estimations.',
  },
  {
    id: 'ameli-palpitations',
    domain: 'heart',
    population: 'Grand public',
    organization: 'Assurance Maladie (Ameli)',
    url: 'https://www.ameli.fr/assure/sante/themes/palpitations-cardiaques/bons-reflexes',
    version: '2023',
    reviewedAt: '2023-01-01',
    rule: 'En cas de palpitations associées à une douleur thoracique, un malaise, un essoufflement ou des vertiges, contacter le 15 ou le 112.',
    allowedActionClasses: [GUIDANCE_LEVELS.INFO, GUIDANCE_LEVELS.MONITOR, GUIDANCE_LEVELS.SEEK_MEDICAL_ADVICE],
    limitations: 'Ne remplace pas un avis médical ; une fréquence cardiaque mesurée au poignet peut être imprécise.',
  },
]

const REGISTRY_BY_ID = new Map(ENTRIES.map((entry) => [entry.id, entry]))

export const EVIDENCE_REGISTRY = ENTRIES

export function getEvidence(id) {
  return REGISTRY_BY_ID.get(id) || null
}

export function requireEvidence(id) {
  const entry = getEvidence(id)
  if (!entry) throw new Error(`Identifiant de preuve inconnu dans le registre : "${id}".`)
  return entry
}

export function listEvidenceForDomain(domain) {
  return ENTRIES.filter((entry) => entry.domain === domain)
}

export function evidenceAllowsAction(id, actionClass) {
  const entry = getEvidence(id)
  return Boolean(entry && entry.allowedActionClasses.includes(actionClass))
}
