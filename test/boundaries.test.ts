// Every floor at, one below and one above its threshold; every config error
// path; and the exact sentences the describe functions produce.

import { describe, expect, it } from 'vitest'
import {
  DEFAULT_DIVERGENCE_CONFIG,
  computeDivergence,
  describeDivergence,
  resolveDivergenceConfig,
} from '../src/divergence.js'
import { DEFAULT_GRADE_CONFIG, describeGrade, gradeDecision, resolveGradeConfig } from '../src/grade.js'
import type { Decision, GradeConfig, JudgmentPair, Observation, Recommendation } from '../src/types.js'

const rec: Recommendation = { id: 'r', subjectId: 's', checkKey: 'c', proposedAt: '2026-01-01' }
const dec: Decision = { recommendationId: 'r', status: 'adopted', decidedAt: '2026-02-01' }

/** `bad` bad and `good` good observations before the decision. */
function before(bad: number, good: number): Observation[] {
  return [...Array<string>(bad).fill('bad'), ...Array<string>(good).fill('good')].map(
    (state, i): Observation => ({
      subjectId: 's',
      checkKey: 'c',
      state: state as 'good' | 'bad',
      observedAt: `2026-01-${String(i + 1).padStart(2, '0')}`,
    }),
  )
}

/** Post-decision observations: `bad` bad exposed, `good` good exposed, `unexposed` good unexposed. */
function after(bad: number, good: number, unexposed = 0): Observation[] {
  const rows: Observation[] = []
  const day = (i: number) => `2026-02-${String(i + 2).padStart(2, '0')}`
  for (let i = 0; i < bad; i++) rows.push({ subjectId: 's', checkKey: 'c', state: 'bad', observedAt: day(rows.length), exposed: true })
  for (let i = 0; i < good; i++) rows.push({ subjectId: 's', checkKey: 'c', state: 'good', observedAt: day(rows.length), exposed: true })
  for (let i = 0; i < unexposed; i++) rows.push({ subjectId: 's', checkKey: 'c', state: 'good', observedAt: day(rows.length), exposed: false })
  return rows
}

describe('grade floors at, below and above the threshold', () => {
  const floor = 4

  it('minBaselineObservations', () => {
    const config: GradeConfig = { minBaselineObservations: floor }
    const codes = (n: number) => gradeDecision(dec, rec, [...before(1, n - 1), ...after(0, 3)], config).refusalCodes
    expect(codes(floor - 1)).toEqual(['baseline_below_minimum'])
    expect(codes(floor)).toEqual([])
    expect(codes(floor + 1)).toEqual([])
  })

  it('minBaselineBadObservations', () => {
    const config: GradeConfig = { minBaselineBadObservations: 2 }
    const codes = (bad: number) => gradeDecision(dec, rec, [...before(bad, 5), ...after(0, 3)], config).refusalCodes
    expect(codes(1)).toEqual(['baseline_lacks_negative_signal'])
    expect(codes(2)).toEqual([])
    expect(codes(3)).toEqual([])
    // A floor of 0 disables the check.
    expect(gradeDecision(dec, rec, [...before(0, 5), ...after(0, 3)], { minBaselineBadObservations: 0 }).verdict).toBe('holding')
  })

  it('minResultObservations counts exposed and unexposed together', () => {
    const config: GradeConfig = { minResultObservations: floor, minExposedResultObservations: 1 }
    const codes = (n: number) => gradeDecision(dec, rec, [...before(2, 2), ...after(0, 1, n - 1)], config).refusalCodes
    expect(codes(floor - 1)).toEqual(['result_below_minimum'])
    expect(codes(floor)).toEqual([])
    expect(codes(floor + 1)).toEqual([])
  })

  it('minExposedResultObservations counts exposed only', () => {
    const config: GradeConfig = { minExposedResultObservations: floor }
    const codes = (n: number) => gradeDecision(dec, rec, [...before(2, 2), ...after(0, n, 5)], config).refusalCodes
    expect(codes(floor - 1)).toEqual(['exposed_result_below_minimum'])
    expect(codes(floor)).toEqual([])
    expect(codes(floor + 1)).toEqual([])
  })

  it('refuteThreshold: one below holds, at and above do not', () => {
    const verdict = (bad: number) => gradeDecision(dec, rec, [...before(2, 2), ...after(bad, 3)], { refuteThreshold: 3 }).verdict
    expect(verdict(2)).toBe('holding')
    expect(verdict(3)).toBe('not-holding')
    expect(verdict(4)).toBe('not-holding')
  })

  it('returns holding while the bad rate went up, because the verdict is a count', () => {
    // 1 of 10 before, 1 of 3 exposed since: below the refute bar of 2.
    const grade = gradeDecision(dec, rec, [...before(1, 9), ...after(1, 2)])
    expect(grade.verdict).toBe('holding')
    expect(grade.badRateDelta).toBe(0.233)
  })

  it('reports badRateDelta as the difference of the rounded rates shown', () => {
    // 2/3 and 1/3 display as 0.667 and 0.333; their difference is -0.334,
    // not the unrounded -0.333.
    const grade = gradeDecision(dec, rec, [...before(2, 1), ...after(1, 2)])
    expect(grade.baseline.badRate).toBe(0.667)
    expect(grade.result.badRate).toBe(0.333)
    expect(grade.badRateDelta).toBe(-0.334)
  })
})

describe('resolveGradeConfig error paths', () => {
  it('fills every default and returns a new object', () => {
    const resolved = resolveGradeConfig()
    expect(resolved).toEqual(DEFAULT_GRADE_CONFIG)
    expect(resolved).not.toBe(DEFAULT_GRADE_CONFIG)
    expect(Object.isFrozen(DEFAULT_GRADE_CONFIG)).toBe(true)
  })

  it('treats null like an omitted field', () => {
    expect(resolveGradeConfig({ minBaselineObservations: null } as unknown as GradeConfig).minBaselineObservations).toBe(3)
  })

  it.each([
    ['minBaselineObservations', 0],
    ['minResultObservations', Number.NaN],
    ['minExposedResultObservations', Number.POSITIVE_INFINITY],
    ['minBaselineBadObservations', -1],
    ['minBaselineBadObservations', 0.5],
    ['proposeThreshold', 0],
    ['refuteThreshold', 0],
  ])('rejects %s = %s with a RangeError naming the field', (field, value) => {
    expect(() => resolveGradeConfig({ [field]: value })).toThrow(RangeError)
    expect(() => resolveGradeConfig({ [field]: value })).toThrow(new RegExp(`${field} must be an integer >=`))
  })

  it('accepts minBaselineBadObservations = 0 and refuteThreshold equal to proposeThreshold', () => {
    expect(resolveGradeConfig({ minBaselineBadObservations: 0 }).minBaselineBadObservations).toBe(0)
    expect(resolveGradeConfig({ proposeThreshold: 3, refuteThreshold: 3 }).refuteThreshold).toBe(3)
  })
})

describe('describeGrade sentences', () => {
  it('names the verdict, both windows, and the decision', () => {
    const notHolding = gradeDecision({ ...dec, status: 'dismissed' }, rec, [...before(2, 2), ...after(2, 1, 1)])
    expect(describeGrade(notHolding)).toBe(
      'Not holding: c on s was bad in 2 of 4 observations before and 2 of 3 exposed observations since the recommendation was dismissed on 2026-02-01.',
    )
  })

  it('lists refusal codes verbatim', () => {
    expect(describeGrade(gradeDecision(dec, rec, []))).toBe(
      'Refused to grade c on s: baseline_below_minimum, baseline_lacks_negative_signal, result_below_minimum, exposed_result_below_minimum.',
    )
  })
})

const agree = (n: number): JudgmentPair[] => Array.from({ length: n }, () => ({ engineJudgment: 'a', humanJudgment: 'a' }))
const differ = (n: number, laterOutcome?: string): JudgmentPair[] =>
  Array.from({ length: n }, () => ({ engineJudgment: 'a', humanJudgment: 'b', ...(laterOutcome === undefined ? {} : { laterOutcome }) }))

describe('divergence floors at, below and above the threshold', () => {
  it('minComparablePairs', () => {
    const codes = (n: number) =>
      computeDivergence([...agree(n - 3), ...differ(3)], { minComparablePairs: 12, minDivergentRate: 0 }).overall.refusalCodes
    expect(codes(11)).toEqual(['comparable_pairs_below_minimum'])
    expect(codes(12)).toEqual([])
    expect(codes(13)).toEqual([])
  })

  it('minDivergentCount', () => {
    const codes = (d: number) => computeDivergence([...agree(30), ...differ(d)], { minDivergentCount: 4 }).overall.refusalCodes
    expect(codes(3)).toEqual(['divergent_count_below_minimum'])
    expect(codes(4)).toEqual([])
    expect(codes(5)).toEqual([])
  })

  it('minResolvedDivergent', () => {
    const status = (resolved: number) =>
      computeDivergence([...agree(30), ...differ(resolved, 'a'), ...differ(2)], { minResolvedDivergent: 4 }).overall.calibration.status
    expect(status(3)).toBe('refused')
    expect(status(4)).toBe('reportable')
    expect(status(5)).toBe('reportable')
  })

  it('reports calibration independently of a refused parent report', () => {
    const { overall } = computeDivergence([...agree(97), ...differ(3, 'a')])
    expect(overall.status).toBe('refused')
    expect(overall.calibration.status).toBe('reportable')
    expect(describeDivergence(overall)).not.toContain('engine was right')
  })

  it('treats missing, empty and non-string judgments as not spoken, and whitespace as a judgment', () => {
    const { overall } = computeDivergence([
      { engineJudgment: 'a', humanJudgment: '' },
      { engineJudgment: 'a' } as JudgmentPair,
      { engineJudgment: 1, humanJudgment: 1 } as unknown as JudgmentPair,
      { engineJudgment: 'a', humanJudgment: ' ' },
    ])
    expect(overall.totalPairs).toBe(4)
    expect(overall.comparablePairs).toBe(1)
    expect(overall.divergentCount).toBe(1)
  })

  it('allows exampleLimit 0', () => {
    expect(computeDivergence(differ(5), { exampleLimit: 0 }).overall.examples).toEqual([])
  })
})

describe('resolveDivergenceConfig error paths', () => {
  it('fills every default and returns a new object', () => {
    const resolved = resolveDivergenceConfig()
    expect(resolved).toEqual(DEFAULT_DIVERGENCE_CONFIG)
    expect(resolved).not.toBe(DEFAULT_DIVERGENCE_CONFIG)
    expect(Object.isFrozen(DEFAULT_DIVERGENCE_CONFIG)).toBe(true)
    expect(Object.keys(resolveDivergenceConfig({ groupBy: () => null }))).not.toContain('groupBy')
  })

  it.each([Number.NaN, -0.01, 1.01, Number.POSITIVE_INFINITY])('rejects minDivergentRate = %s', (value) => {
    expect(() => resolveDivergenceConfig({ minDivergentRate: value })).toThrow(/minDivergentRate must be a number between 0 and 1/)
  })

  it('accepts minDivergentRate at 0 and at 1', () => {
    expect(resolveDivergenceConfig({ minDivergentRate: 0 }).minDivergentRate).toBe(0)
    expect(resolveDivergenceConfig({ minDivergentRate: 1 }).minDivergentRate).toBe(1)
  })

  it.each([
    ['minComparablePairs', 0],
    ['minDivergentCount', 1.5],
    ['minResolvedDivergent', 0],
    ['exampleLimit', -1],
  ])('rejects %s = %s with a RangeError', (field, value) => {
    expect(() => resolveDivergenceConfig({ [field]: value })).toThrow(RangeError)
  })
})

describe('describeDivergence sentences', () => {
  it('reports divergence and both hit counts separately', () => {
    const { overall } = computeDivergence([...agree(20), ...differ(3, 'a'), ...differ(2, 'b')])
    expect(describeDivergence(overall)).toBe(
      'Overall: the human disagreed on 5 of 25 comparable pairs. Of the 5 with a later outcome, the engine was right 3 and the human was right 2.',
    )
  })

  it('says why calibration is withheld', () => {
    const { overall } = computeDivergence([...agree(20), ...differ(2, 'a'), ...differ(3)])
    expect(describeDivergence(overall)).toBe(
      'Overall: the human disagreed on 5 of 25 comparable pairs. Who was right is not reported yet (resolved_divergent_below_minimum); 2 disagreements have an outcome.',
    )
  })

  it('names a refused group', () => {
    const { groups } = computeDivergence(differ(2).map((p) => ({ ...p, group: 'text' })))
    expect(describeDivergence(groups[0] as (typeof groups)[number])).toBe(
      'Group text: refused to report divergence (comparable_pairs_below_minimum, divergent_count_below_minimum); 2 of 2 comparable pairs diverged.',
    )
  })
})
