// A named verdict table. Each case states the grade a careful reader would
// give, so a change to a rule shows up as a named row, not a diff in a large
// fixture. Cases tagged FIX pin the 2026-10-10 hunt findings; cases tagged
// GUARD pin behavior that was checked and is correct, so the fixes cannot
// loosen it.

import { describe, expect, it } from 'vitest'
import { computeDivergence, describeDivergence } from '../src/divergence.js'
import { describeGrade, gradeDecision } from '../src/grade.js'
import type {
  Decision,
  GradeConfig,
  JudgmentPair,
  Observation,
  ObservationState,
  Recommendation,
} from '../src/types.js'

const rec: Recommendation = { id: 'rec-1', subjectId: 'pump-14', checkKey: 'seal-leak', proposedAt: '2026-01-01' }
const adopted: Decision = { recommendationId: 'rec-1', status: 'adopted', decidedAt: '2026-02-01' }

const day = (offset: number): string =>
  new Date(Date.UTC(2026, 1, 1) + offset * 86_400_000).toISOString().slice(0, 10)

function row(observedAt: string, state: ObservationState, exposed?: unknown): Observation {
  return {
    subjectId: 'pump-14',
    checkKey: 'seal-leak',
    observedAt,
    state,
    ...(exposed === undefined ? {} : { exposed }),
  } as Observation
}

/** `bad` of `n` observations before the decision. */
function before(bad: number, n: number): Observation[] {
  return Array.from({ length: n }, (_, i) => row(day(-(i + 1)), i < bad ? 'bad' : 'good'))
}

/** `bad` of `n` exposed observations after the decision. */
function after(bad: number, n: number): Observation[] {
  return Array.from({ length: n }, (_, i) => row(day(i + 1), i < bad ? 'bad' : 'good', true))
}

/** Grade `baseBad/baseN` before against `bad/n` exposed since. */
const grade = (baseBad: number, baseN: number, bad: number, n: number, config?: GradeConfig) =>
  gradeDecision(adopted, rec, [...before(baseBad, baseN), ...after(bad, n)], config)

describe('verdict table: FIX cases (wrong before the 2026-10-10 fixes)', () => {
  it.each([
    ['tie 3/4 vs 3/4, refuteThreshold 4: the problem did not go down', 3, 4, 3, 4, { refuteThreshold: 4 }, 'not-holding'],
    ['tie 1/3 vs 1/3, defaults', 1, 3, 1, 3, {}, 'not-holding'],
    ['tie 1/8 vs 1/8, defaults', 1, 8, 1, 8, {}, 'not-holding'],
    ['tie 2/4 vs 3/6 (equal exact ratio, different counts), refuteThreshold 4', 2, 4, 3, 6, { refuteThreshold: 4 }, 'not-holding'],
    ['tie 3/3 vs 3/3 (all bad on both sides), refuteThreshold 4', 3, 3, 3, 3, { refuteThreshold: 4 }, 'not-holding'],
  ] as const)('FIX %s', (_name, baseBad, baseN, bad, n, config, expected) => {
    expect(grade(baseBad, baseN, bad, n, config).verdict).toBe(expected)
  })

  it('FIX zero bad before and zero bad after stays holding: the problem stayed away', () => {
    // minBaselineBadObservations: 0 is the only way to get past the
    // baseline_lacks_negative_signal floor with a clean baseline.
    const g = grade(0, 5, 0, 5, { minBaselineBadObservations: 0 })
    expect(g.verdict).toBe('holding')
    expect(g.refusalCodes).toEqual([])
  })

  it.each([
    ['string "true"', 'true'],
    ['number 1', 1],
    ['string "yes"', 'yes'],
    ['string "false"', 'false'],
    ['number 0', 0],
    ['null', null],
  ])('FIX a non-boolean exposed (%s) on a post-decision row throws a TypeError', (_name, exposed) => {
    const rows = [...before(2, 4), ...after(0, 3), row(day(9), 'bad', exposed)]
    expect(() => gradeDecision(adopted, rec, rows)).toThrow(TypeError)
    expect(() => gradeDecision(adopted, rec, rows)).toThrow(/observations\[\d+\]\.exposed must be true, false or omitted/)
  })

  it('FIX a non-boolean exposed on a baseline row throws too (rows the types forbid throw)', () => {
    const rows = [row(day(-1), 'bad', 'yes'), ...before(1, 3).slice(1), ...after(0, 3)]
    expect(() => gradeDecision(adopted, rec, rows)).toThrow(TypeError)
  })

  it('FIX a hidden bad row cannot slip through as not-exposed: "true" no longer yields holding', () => {
    // Before the fix: the three bad rows with exposed "true" were silently
    // unexposed, the exposed window was three clean rows, and the grade was holding.
    const rows = [
      ...before(3, 4),
      ...after(0, 3),
      row(day(10), 'bad', 'true'),
      row(day(11), 'bad', 'true'),
      row(day(12), 'bad', 'true'),
    ]
    expect(() => gradeDecision(adopted, rec, rows)).toThrow(TypeError)
  })

  it.each([
    ['number 1', 1],
    ['boolean true', true],
    ['null', null],
    ['an object', {}],
  ])('FIX a non-string laterOutcome (%s) in divergence throws a TypeError', (_name, laterOutcome) => {
    const pairs = [
      { engineJudgment: 'remove', humanJudgment: 'keep', laterOutcome },
    ] as unknown as JudgmentPair[]
    expect(() => computeDivergence(pairs)).toThrow(TypeError)
    expect(() => computeDivergence(pairs)).toThrow(/pairs\[0\]\.laterOutcome must be a string or omitted/)
  })

  it('FIX a non-string laterOutcome throws even on a pair that agrees (the type is forbidden everywhere)', () => {
    const pairs = [{ engineJudgment: 'keep', humanJudgment: 'keep', laterOutcome: 1 }] as unknown as JudgmentPair[]
    expect(() => computeDivergence(pairs)).toThrow(TypeError)
  })

  it('FIX when the count bar decides while the rate fell sharply, describeGrade mentions the rate drop (6/6 to 2/60)', () => {
    const g = grade(6, 6, 2, 60)
    expect(g.verdict).toBe('not-holding')
    const text = describeGrade(g)
    expect(text).toContain('reached the refute threshold (2)')
    expect(text).toContain("The exposed bad rate (2 of 60) is lower than the baseline's (6 of 6)")
    expect(text).toContain('does not scale with the number of observations')
  })

  it('FIX describeGrade explains a tie: not lower than the baseline, compared as exact counts', () => {
    const text = describeGrade(grade(1, 3, 1, 3))
    expect(text).toContain("but the exposed bad rate (1 of 3) is not lower than the baseline's (1 of 3), compared as exact counts")
    expect(text).not.toContain('is higher than')
  })

  it('FIX the secondary reading follows the same tie rule', () => {
    // Exposed window: 0 of 3 against 2 of 5 before, so the headline holds.
    // Blind window (adds two unexposed bad rows): 2 of 5, a tie with the
    // baseline's 2 of 5, which is not holding under the tie rule.
    const rows = [...before(2, 5), ...after(0, 3), row(day(8), 'bad', false), row(day(9), 'bad', false)]
    const g = gradeDecision(adopted, rec, rows, { refuteThreshold: 3 })
    expect(g.verdict).toBe('holding')
    expect(g.secondary).toMatchObject({ observations: 5, bad: 2, wouldBeVerdict: 'not-holding' })
  })
})

describe('verdict table: GUARD cases (correct before, must stay correct)', () => {
  it.each([
    ['rate lower, count below the bar (README: 4/6 to 1/4)', 4, 6, 1, 4, {}, 'holding'],
    ['rate lower, count below the bar (4/8 to 1/4)', 4, 8, 1, 4, {}, 'holding'],
    ['rate lower with a raised bar, count one below it (4/5 to 3/10, bar 4)', 4, 5, 3, 10, { refuteThreshold: 4 }, 'holding'],
    ['count reaches the default bar even though the rate fell (4/8 to 2/10)', 4, 8, 2, 10, {}, 'not-holding'],
    ['count at a raised bar', 4, 5, 4, 20, { refuteThreshold: 4 }, 'not-holding'],
    ['rate higher below the count bar (1/10 to 1/3)', 1, 10, 1, 3, {}, 'not-holding'],
    ['zero bad since, after a bad baseline (2/4 to 0/3)', 2, 4, 0, 3, {}, 'holding'],
    ['exact ratio: 81/650 before vs 1/8 since is higher though both display 0.125', 81, 650, 1, 8, {}, 'not-holding'],
  ] as const)('GUARD %s', (_name, baseBad, baseN, bad, n, config, expected) => {
    expect(grade(baseBad, baseN, bad, n, config).verdict).toBe(expected)
  })

  it('GUARD a clean baseline with the floor at 0 and a recurrence is not-holding, not holding', () => {
    expect(grade(0, 5, 1, 5, { minBaselineBadObservations: 0 }).verdict).toBe('not-holding')
  })

  it('GUARD the default floors refuse a clean baseline (nothing to improve on)', () => {
    const g = grade(0, 5, 0, 5)
    expect(g.verdict).toBe('refused')
    expect(g.refusalCodes).toEqual(['baseline_lacks_negative_signal'])
  })

  it('GUARD each floor at, and one below, its minimum', () => {
    expect(grade(1, 3, 0, 3).verdict).toBe('holding')
    expect(grade(1, 2, 0, 3).refusalCodes).toEqual(['baseline_below_minimum'])
    expect(gradeDecision(adopted, rec, [...before(1, 3), ...after(0, 2)]).refusalCodes).toEqual([
      'result_below_minimum',
      'exposed_result_below_minimum',
    ])
  })

  it('GUARD unexposed and omitted-exposure rows never decide the headline (README pump example)', () => {
    const rows = [
      ...before(3, 4),
      row(day(1), 'good', true), row(day(2), 'good', true), row(day(3), 'good', true),
      row(day(4), 'bad', false), row(day(5), 'bad'),
    ]
    const g = gradeDecision(adopted, rec, rows)
    expect(g.verdict).toBe('holding')
    expect(g.result).toEqual({ observations: 3, bad: 0, good: 3, badRate: 0 })
    expect(g.secondary.wouldBeVerdict).toBe('not-holding')
  })

  it('GUARD exposed on a baseline row may be true or false and is ignored there', () => {
    const rows = [row(day(-1), 'bad', true), row(day(-2), 'bad', false), row(day(-3), 'good'), ...after(0, 3)]
    expect(gradeDecision(adopted, rec, rows).baseline).toEqual({ observations: 3, bad: 2, good: 1, badRate: 0.667 })
  })

  it('GUARD window boundaries are exclusive and compared as instants', () => {
    const decidedAt = '2026-02-01T00:00:00.000Z'
    const dec: Decision = { ...adopted, decidedAt }
    const rows = [
      ...before(2, 3),
      row('2026-02-01T00:00:00Z', 'bad', true),
      row('2026-02-01T01:00:00+01:00', 'bad', true),
      row('2026-02-01', 'bad', true),
      row('2026-02-01T00:00:00.001Z', 'good', true),
      row('2026-02-01T00:00:00.002Z', 'good', true),
      row('2026-02-01T00:00:00.003Z', 'good', true),
    ]
    const g = gradeDecision(dec, rec, rows)
    expect(g.atBoundaryObservations).toBe(3)
    expect(g.baseline.observations).toBe(3)
    expect(g.result).toEqual({ observations: 3, bad: 0, good: 3, badRate: 0 })
    expect(g.verdict).toBe('holding')
  })

  it('GUARD strict parsing: bad dates are a RangeError, empty or non-string dates a TypeError', () => {
    const at = (observedAt: unknown) => () =>
      gradeDecision(adopted, rec, [row(observedAt as string, 'bad', true)])
    expect(at('2026-02-01T09:30:00')).toThrow(RangeError)
    expect(at('2026-02-01T09:30Z')).toThrow(RangeError)
    expect(at('2026-99-99')).toThrow(RangeError)
    expect(at('2025-02-29')).toThrow(RangeError)
    expect(at('')).toThrow(TypeError)
    expect(at(20260201)).toThrow(TypeError)
    expect(() => gradeDecision({ ...adopted, decidedAt: '' }, rec, [])).toThrow(TypeError)
  })

  it('GUARD strict parsing of state and plain-object rows', () => {
    expect(() => gradeDecision(adopted, rec, [row(day(1), 'maybe' as ObservationState, true)])).toThrow(TypeError)
    expect(() => gradeDecision(adopted, rec, [new Map() as unknown as Observation])).toThrow(TypeError)
  })

  it('GUARD observations for another subject or check are not read, so their exposed values are not validated', () => {
    const stray = { subjectId: 'pump-99', checkKey: 'seal-leak', observedAt: day(1), state: 'bad', exposed: 'yes' }
    expect(() => gradeDecision(adopted, rec, [...before(2, 4), ...after(0, 3), stray as unknown as Observation])).not.toThrow()
  })

  it('GUARD the result does not depend on the order of observations', () => {
    const rows = [...before(2, 4), ...after(1, 4), row(day(7), 'bad', false)]
    const forward = gradeDecision(adopted, rec, rows)
    const backward = gradeDecision(adopted, rec, [...rows].reverse())
    expect(backward).toEqual(forward)
  })

  it('GUARD refuteThreshold below proposeThreshold is a RangeError', () => {
    expect(() => grade(2, 4, 0, 3, { proposeThreshold: 3, refuteThreshold: 2 })).toThrow(RangeError)
  })

  it('GUARD README quickstart: holding, 4/6 to 1/4, delta -0.417, secondary not-holding', () => {
    const r = (observedAt: string, state: ObservationState, exposed?: boolean) =>
      row(observedAt, state, exposed)
    const log = [
      r('2026-01-04', 'bad'), r('2026-01-11', 'bad'), r('2026-01-18', 'good'),
      r('2026-01-25', 'bad'), r('2026-01-29', 'bad'), r('2026-01-31', 'good'),
      r('2026-02-08', 'good', true), r('2026-02-15', 'good', true), r('2026-02-22', 'good', true),
      r('2026-03-01', 'bad', true),
      r('2026-03-08', 'bad', false),
    ]
    const g = gradeDecision(adopted, { ...rec, id: 'rec-1' }, log)
    expect(g.verdict).toBe('holding')
    expect(g.baseline).toEqual({ observations: 6, bad: 4, good: 2, badRate: 0.667 })
    expect(g.result).toEqual({ observations: 4, bad: 1, good: 3, badRate: 0.25 })
    expect(g.badRateDelta).toBe(-0.417)
    expect(g.secondary.observations).toBe(5)
    expect(g.secondary.bad).toBe(2)
    expect(g.secondary.wouldBeVerdict).toBe('not-holding')
    expect(describeGrade(g)).toContain("is below the refute threshold (2) and its rate is not higher than the baseline's.")
  })

  it('GUARD a count-decided grade whose rate rose or tied gets no "rate fell" sentence', () => {
    expect(describeGrade(grade(2, 4, 2, 3))).not.toContain('is lower than')
    expect(describeGrade(grade(2, 4, 2, 4))).not.toContain('is lower than')
  })
})

describe('verdict table: divergence GUARD cases', () => {
  const times = (n: number, pair: JudgmentPair): JudgmentPair[] => Array.from({ length: n }, () => pair)

  it('GUARD README example: 20 comparable pairs, 5 divergent, engine 3, human 2, neither 0', () => {
    const pairs = [
      ...times(15, { engineJudgment: 'keep', humanJudgment: 'keep' }),
      ...times(3, { engineJudgment: 'remove', humanJudgment: 'keep', laterOutcome: 'remove' }),
      ...times(2, { engineJudgment: 'remove', humanJudgment: 'keep', laterOutcome: 'keep' }),
    ]
    const { overall } = computeDivergence(pairs)
    expect(overall.comparablePairs).toBe(20)
    expect(overall.divergentCount).toBe(5)
    expect(overall.calibration).toMatchObject({ resolvedDivergent: 5, engineRight: 3, humanRight: 2, neitherRight: 0 })
    expect(describeDivergence(overall)).toContain('the engine was right 3, the human was right 2 and neither was right 0')
  })

  it('GUARD engineRight + humanRight + neitherRight equals resolvedDivergent', () => {
    const pairs = [
      ...times(10, { engineJudgment: 'a', humanJudgment: 'a' }),
      ...times(2, { engineJudgment: 'a', humanJudgment: 'b', laterOutcome: 'a' }),
      ...times(3, { engineJudgment: 'a', humanJudgment: 'b', laterOutcome: 'b' }),
      ...times(4, { engineJudgment: 'a', humanJudgment: 'b', laterOutcome: 'c' }),
      ...times(1, { engineJudgment: 'a', humanJudgment: 'b' }),
      ...times(1, { engineJudgment: 'a', humanJudgment: 'b', laterOutcome: '' }),
    ]
    const c = computeDivergence(pairs).overall.calibration
    expect(c.resolvedDivergent).toBe(9)
    expect(c.engineRight + c.humanRight + c.neitherRight).toBe(c.resolvedDivergent)
    expect(c).toMatchObject({ engineRight: 2, humanRight: 3, neitherRight: 4 })
  })

  it('GUARD the rate floor uses the exact ratio: 5 of 101 displays 0.05 and is still refused', () => {
    const pairs = [
      ...times(96, { engineJudgment: 'a', humanJudgment: 'a' }),
      ...times(5, { engineJudgment: 'a', humanJudgment: 'b' }),
    ]
    const { overall } = computeDivergence(pairs)
    expect(overall.divergentRate).toBe(0.05)
    expect(overall.refusalCodes).toEqual(['divergent_rate_below_minimum'])
  })

  it('GUARD pairs missing a judgment are counted in totalPairs but are not comparable', () => {
    const pairs = [
      ...times(10, { engineJudgment: 'a', humanJudgment: 'a' }),
      { engineJudgment: 'a' }, { humanJudgment: 'a' }, { engineJudgment: '', humanJudgment: 'a' },
    ] as JudgmentPair[]
    const { overall } = computeDivergence(pairs)
    expect(overall.totalPairs).toBe(13)
    expect(overall.comparablePairs).toBe(10)
  })

  it('GUARD a string laterOutcome, an omitted one and an empty one are all accepted', () => {
    const pairs: JudgmentPair[] = [
      { engineJudgment: 'a', humanJudgment: 'b', laterOutcome: 'a' },
      { engineJudgment: 'a', humanJudgment: 'b', laterOutcome: '' },
      { engineJudgment: 'a', humanJudgment: 'b' },
    ]
    expect(computeDivergence(pairs).overall.calibration.resolvedDivergent).toBe(1)
  })

  it('GUARD the counts do not depend on the order of pairs', () => {
    const pairs: JudgmentPair[] = [
      ...times(8, { engineJudgment: 'a', humanJudgment: 'a', group: 'x' }),
      ...times(4, { engineJudgment: 'a', humanJudgment: 'b', laterOutcome: 'b', group: 'y' }),
      ...times(4, { engineJudgment: 'a', humanJudgment: 'b', laterOutcome: 'a', group: 'x' }),
    ]
    // `examples` keep input order by design, so compare everything else.
    const counts = (list: JudgmentPair[]) => {
      const { overall, groups, thresholds } = computeDivergence(list)
      const strip = <T extends { examples: unknown }>(r: T) => ({ ...r, examples: undefined })
      return { overall: strip(overall), groups: groups.map(strip), thresholds }
    }
    expect(counts([...pairs].reverse())).toEqual(counts(pairs))
  })
})

// Probes written after the fixes, trying to get a false holding or a false
// not-holding out of them. Each one passes; they stay as regression cases.
describe('verdict table: self-hunt probes after the fixes', () => {
  it('PROBE all-bad on both sides (5/5 vs 4/4, bar 5) is a tie at 1.0 and does not hold', () => {
    expect(grade(5, 5, 4, 4, { refuteThreshold: 5 }).verdict).toBe('not-holding')
  })

  it('PROBE a tie holds nothing for a dismissed decision either', () => {
    const g = gradeDecision({ ...adopted, status: 'dismissed' }, rec, [...before(1, 3), ...after(1, 3)])
    expect(g.verdict).toBe('not-holding')
  })

  it('PROBE a hair below the baseline holds: 1/8 before, 1/9 since', () => {
    expect(grade(1, 8, 1, 9).verdict).toBe('holding')
  })

  it('PROBE a hair above the baseline still does not hold: 1/9 before, 1/8 since', () => {
    expect(grade(1, 9, 1, 8).verdict).toBe('not-holding')
  })

  it('PROBE a tie is decided on exact counts when the rounded rates also match (9/72 vs 1/8, both 0.125)', () => {
    const g = grade(9, 72, 1, 8)
    expect(g.baseline.badRate).toBe(0.125)
    expect(g.result.badRate).toBe(0.125)
    expect(g.verdict).toBe('not-holding')
    expect(describeGrade(g)).toContain('is not lower than')
  })

  it('PROBE the exact side of a rounding boundary decides: 126/1000 before holds against 1/8, 1249/10000 does not', () => {
    // 1/8 is 0.125. A baseline of 0.126 is higher, so 1/8 is strictly lower: holding.
    expect(grade(126, 1000, 1, 8).verdict).toBe('holding')
    // A baseline of 0.1249 also displays 0.125, but 1/8 is exactly higher: not-holding.
    expect(grade(1249, 10000, 1, 8).verdict).toBe('not-holding')
  })

  it('PROBE clean baseline (floor 0) with a recurrence stays not-holding, with exposed rows only', () => {
    const g = grade(0, 4, 1, 3, { minBaselineBadObservations: 0 })
    expect(g.verdict).toBe('not-holding')
    expect(describeGrade(g)).toContain('is higher than the baseline')
  })

  it('PROBE count bar boundary on a falling rate: 1/60 holds, 2/60 does not, both from 6/6', () => {
    expect(grade(6, 6, 1, 60).verdict).toBe('holding')
    const g = grade(6, 6, 2, 60)
    expect(g.verdict).toBe('not-holding')
    expect(g.result.badRate).toBe(0.033)
  })

  it('PROBE the rate-drop sentence appears for a raised bar too, and names the configured threshold', () => {
    const text = describeGrade(grade(6, 6, 5, 60, { refuteThreshold: 5 }))
    expect(text).toContain('reached the refute threshold (5)')
    expect(text).toContain("The exposed bad rate (5 of 60) is lower than the baseline's (6 of 6)")
  })

  it('PROBE the describeGrade text stays on one line for every verdict path', () => {
    for (const g of [grade(6, 6, 2, 60), grade(1, 3, 1, 3), grade(1, 10, 1, 3), grade(4, 6, 1, 4)]) {
      expect(describeGrade(g)).not.toMatch(/[\n\r]/)
    }
  })

  it('PROBE an explicit exposed: undefined is accepted like an omitted one', () => {
    const rows = [...before(2, 4), ...after(0, 3), { ...row(day(9), 'bad'), exposed: undefined }] as unknown as Observation[]
    expect(gradeDecision(adopted, rec, rows).result.observations).toBe(3)
  })

  it.each([
    ['NaN', Number.NaN],
    ['an array', []],
    ['an object', {}],
    ['a Boolean object', Object(true)],
    ['a symbol', Symbol('x')],
    ['a bigint', 1n],
  ])('PROBE exposed as %s throws a TypeError', (_name, exposed) => {
    expect(() => gradeDecision(adopted, rec, [...before(2, 4), ...after(0, 3), row(day(9), 'bad', exposed)])).toThrow(TypeError)
  })

  it('PROBE a hostile exposed value cannot break the error message', () => {
    const hostile = { toString() { throw new Error('boom') }, [Symbol.toPrimitive]() { throw new Error('boom') } }
    expect(() => gradeDecision(adopted, rec, [row(day(1), 'bad', hostile)])).toThrow(/exposed must be true, false or omitted, received an object/)
  })

  it('PROBE a bad exposed on a row stamped exactly at the decision still throws (boundary rows are validated)', () => {
    expect(() => gradeDecision(adopted, rec, [...before(2, 4), ...after(0, 3), row('2026-02-01', 'bad', 'yes')])).toThrow(TypeError)
  })

  it('PROBE a getter that returns a non-string laterOutcome is read once and rejected', () => {
    let reads = 0
    const pair = {
      engineJudgment: 'a',
      humanJudgment: 'b',
      get laterOutcome() { reads++; return 1 },
    } as unknown as JudgmentPair
    expect(() => computeDivergence([pair])).toThrow(TypeError)
    expect(reads).toBe(1)
  })

  it('PROBE an explicit laterOutcome: undefined and a whitespace-only string behave as documented', () => {
    const pairs = [
      { engineJudgment: 'a', humanJudgment: 'b', laterOutcome: undefined },
      { engineJudgment: 'a', humanJudgment: 'b', laterOutcome: ' ' },
    ] as unknown as JudgmentPair[]
    // Whitespace is a (non-empty) outcome that matches neither judge.
    expect(computeDivergence(pairs).overall.calibration).toMatchObject({ resolvedDivergent: 1, neitherRight: 1 })
  })

  it('PROBE a bad laterOutcome in a pair that groupBy would drop still throws', () => {
    const pairs = [{ engineJudgment: 'a', humanJudgment: 'b', laterOutcome: 7 }] as unknown as JudgmentPair[]
    expect(() => computeDivergence(pairs, { groupBy: () => null })).toThrow(TypeError)
  })
})
