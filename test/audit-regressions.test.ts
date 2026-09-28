import { describe, expect, it } from 'vitest'
import { describeGrade, gradeDecision } from '../src/grade.js'
import type { Decision, Observation, ObservationState, Recommendation } from '../src/types.js'

// Recovery and input-contract cases from the external audit (R01, R06, R07),
// pinned so the text and the counts keep agreeing.

const recommendation: Recommendation = { id: 'rec-88', subjectId: 'pump-14', checkKey: 'seal-leak', proposedAt: '2026-01-18' }
const decision: Decision = { recommendationId: 'rec-88', status: 'adopted', decidedAt: '2026-02-01' }
const row = (observedAt: string, state: ObservationState, exposed?: boolean): Observation => ({
  subjectId: 'pump-14',
  checkKey: 'seal-leak',
  observedAt,
  state,
  ...(exposed === undefined ? {} : { exposed }),
})

describe('audit recovery cases', () => {
  const thin = [row('2026-01-25', 'bad'), row('2026-02-08', 'good', true)]

  it('R01: a thin record recovers with more valid observations at unchanged floors', () => {
    expect(gradeDecision(decision, recommendation, thin).verdict).toBe('refused')
    const more = [
      ...thin,
      row('2026-01-11', 'bad'),
      row('2026-01-18', 'good'),
      row('2026-02-15', 'good', true),
      row('2026-02-22', 'good', true),
    ]
    const grade = gradeDecision(decision, recommendation, more)
    expect(grade.thresholds).toEqual(gradeDecision(decision, recommendation, thin).thresholds)
    expect(grade.verdict).toBe('holding')
    expect(grade.baseline).toEqual({ observations: 3, bad: 2, good: 1, badRate: 0.667 })
    expect(describeGrade(grade).startsWith('Holding: seal-leak on pump-14 was bad in 2 of 3 observations before and 0 of 3 exposed')).toBe(true)
  })

  it('R06: repeated rows are counted as supplied, because the kit does not deduplicate', () => {
    const repeated = [...Array.from({ length: 3 }, () => thin[0] as Observation), ...Array.from({ length: 3 }, () => thin[1] as Observation)]
    const grade = gradeDecision(decision, recommendation, repeated)
    expect(grade.verdict).toBe('holding')
    expect(grade.baseline.observations).toBe(3)
    expect(grade.result.observations).toBe(3)
  })

  it('R07: missing and false exposure stay out of the result while the all-after count stays visible', () => {
    const grade = gradeDecision(decision, recommendation, [
      row('2026-01-10', 'bad'),
      row('2026-01-11', 'bad'),
      row('2026-01-12', 'good'),
      row('2026-02-10', 'good'),
      row('2026-02-11', 'good', false),
      row('2026-02-12', 'good', false),
    ])
    expect(grade.refusalCodes).toEqual(['exposed_result_below_minimum'])
    expect(grade.secondary.observations).toBe(3)
    expect(grade.result.observations).toBe(0)
    const text = describeGrade(grade)
    expect(text).toContain('After the decision: 3 observations, 3 required (met).')
    expect(text).toContain('Confirmed exposed after the decision: 0 observations, 3 required (not met).')
  })
})
