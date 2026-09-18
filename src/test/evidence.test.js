import { describe, expect, it } from 'vitest'
import {
  EVIDENCE_REGISTRY,
  evidenceAllowsAction,
  getEvidence,
  listEvidenceForDomain,
  requireEvidence,
} from '../lib/advisor/evidence'
import { GUIDANCE_LEVELS, guidancePriority } from '../lib/advisor/guidanceLevels'
import { assertSafeGuidanceText, createGuidance, sortGuidanceByPriority } from '../lib/advisor/safetyPolicy'

describe('evidence registry', () => {
  it('exposes every required field for each entry', () => {
    expect(EVIDENCE_REGISTRY.length).toBeGreaterThan(0)
    for (const entry of EVIDENCE_REGISTRY) {
      expect(entry.id).toBeTruthy()
      expect(entry.domain).toBeTruthy()
      expect(entry.population).toBeTruthy()
      expect(entry.rule).toBeTruthy()
      expect(entry.organization).toBeTruthy()
      expect(entry.url).toMatch(/^https:\/\//)
      expect(entry.version).toBeTruthy()
      expect(Array.isArray(entry.allowedActionClasses)).toBe(true)
      expect(entry.allowedActionClasses.length).toBeGreaterThan(0)
      expect(entry.limitations).toBeTruthy()
    }
  })

  it('includes the three initial official references from the issue', () => {
    expect(getEvidence('who-activity-2020')?.url).toBe('https://www.who.int/europe/publications/i/item/9789240014886')
    expect(getEvidence('fda-pulse-oximeter-2021')?.url).toBe('https://www.fda.gov/consumers/consumer-updates/pulse-oximeter-basics')
    expect(getEvidence('niddk-body-weight-planner')?.url).toBe(
      'https://www.niddk.nih.gov/health-information/weight-management/body-weight-planner',
    )
  })

  it('returns null for an unknown id but throws with requireEvidence', () => {
    expect(getEvidence('does-not-exist')).toBeNull()
    expect(() => requireEvidence('does-not-exist')).toThrow(/inconnue|inconnu/i)
  })

  it('filters by domain', () => {
    const sleepEntries = listEvidenceForDomain('sleep')
    expect(sleepEntries.every((entry) => entry.domain === 'sleep')).toBe(true)
    expect(sleepEntries.length).toBeGreaterThan(0)
  })

  it('exposes which action classes each evidence entry allows', () => {
    expect(evidenceAllowsAction('ameli-palpitations', GUIDANCE_LEVELS.SEEK_MEDICAL_ADVICE)).toBe(true)
    expect(evidenceAllowsAction('who-activity-2020', GUIDANCE_LEVELS.SEEK_MEDICAL_ADVICE)).toBe(false)
    expect(evidenceAllowsAction('unknown-id', GUIDANCE_LEVELS.INFO)).toBe(false)
  })
})

describe('safety policy: createGuidance', () => {
  it('builds a valid guidance object referencing a known evidence id', () => {
    const guidance = createGuidance({
      id: 'sleep-catch-up',
      level: GUIDANCE_LEVELS.ADVICE,
      reason: 'Vous avez dormi 5 h 40 cette nuit, en dessous de votre repère habituel.',
      action: 'Essayez de vous coucher avant 22 h 30 ce soir.',
      evidenceId: 'inserm-sleep-duration',
      confidence: 0.7,
      sourceDay: '2026-09-17',
    })
    expect(guidance.level).toBe(GUIDANCE_LEVELS.ADVICE)
    expect(guidance.domain).toBe('sleep')
    expect(guidance.priority).toBe(guidancePriority(GUIDANCE_LEVELS.ADVICE))
  })

  it('rejects an unknown evidence id instead of citing nothing silently', () => {
    expect(() =>
      createGuidance({
        id: 'x',
        level: GUIDANCE_LEVELS.ADVICE,
        reason: 'texte',
        evidenceId: 'not-a-real-evidence-id',
      }),
    ).toThrow(/preuve inconnue/i)
  })

  it('rejects a guidance level the cited evidence does not allow', () => {
    expect(() =>
      createGuidance({
        id: 'x',
        level: GUIDANCE_LEVELS.SEEK_MEDICAL_ADVICE,
        reason: 'texte',
        evidenceId: 'who-activity-2020',
      }),
    ).toThrow(/n’autorise pas/i)
  })

  it('rejects an unknown guidance level', () => {
    expect(() => createGuidance({ id: 'x', level: 'not-a-level', reason: 'texte' })).toThrow(/inconnu/i)
  })

  it('requires an id and a reason', () => {
    expect(() => createGuidance({ level: GUIDANCE_LEVELS.INFO, reason: 'texte' })).toThrow(/identifiant/i)
    expect(() => createGuidance({ id: 'x', level: GUIDANCE_LEVELS.INFO })).toThrow(/motif/i)
  })

  it('allows guidance with no evidence citation (e.g. a pure data observation)', () => {
    const guidance = createGuidance({ id: 'x', level: GUIDANCE_LEVELS.INFO, reason: 'Vous avez marché 8 120 pas hier.' })
    expect(guidance.evidenceId).toBeNull()
  })

  it('screens reason/action text for diagnosis or medication language', () => {
    expect(() => assertSafeGuidanceText('Vous avez un diabète non traité.')).toThrow(/diagnostic/i)
    expect(() => assertSafeGuidanceText('Augmentez votre dose de médicament ce soir.')).toThrow(/médicamenteuse/i)
    expect(assertSafeGuidanceText('Essayez de marcher 20 minutes de plus demain.')).toBe(true)
  })

  it('never lets an unsafe reason/action through createGuidance', () => {
    expect(() =>
      createGuidance({ id: 'x', level: GUIDANCE_LEVELS.ADVICE, reason: 'Ce résultat pose un diagnostic de trouble.' }),
    ).toThrow()
  })
})

describe('guidance priority ordering', () => {
  it('ranks seek-medical-advice above recheck above monitor above commitment above advice above info', () => {
    expect(guidancePriority(GUIDANCE_LEVELS.SEEK_MEDICAL_ADVICE)).toBeLessThan(guidancePriority(GUIDANCE_LEVELS.RECHECK))
    expect(guidancePriority(GUIDANCE_LEVELS.RECHECK)).toBeLessThan(guidancePriority(GUIDANCE_LEVELS.MONITOR))
    expect(guidancePriority(GUIDANCE_LEVELS.MONITOR)).toBeLessThan(guidancePriority(GUIDANCE_LEVELS.COMMITMENT))
    expect(guidancePriority(GUIDANCE_LEVELS.COMMITMENT)).toBeLessThan(guidancePriority(GUIDANCE_LEVELS.ADVICE))
    expect(guidancePriority(GUIDANCE_LEVELS.ADVICE)).toBeLessThan(guidancePriority(GUIDANCE_LEVELS.INFO))
  })

  it('sorts a mixed list with safety guidance first', () => {
    const items = [
      createGuidance({ id: 'a', level: GUIDANCE_LEVELS.ADVICE, reason: 'Marchez un peu plus demain.' }),
      createGuidance({ id: 'b', level: GUIDANCE_LEVELS.SEEK_MEDICAL_ADVICE, reason: 'Palpitations avec essoufflement.', evidenceId: 'ameli-palpitations' }),
      createGuidance({ id: 'c', level: GUIDANCE_LEVELS.INFO, reason: 'Vous avez dormi 8 h.' }),
    ]
    const sorted = sortGuidanceByPriority(items)
    expect(sorted[0].id).toBe('b')
    expect(sorted.at(-1).id).toBe('c')
  })
})
