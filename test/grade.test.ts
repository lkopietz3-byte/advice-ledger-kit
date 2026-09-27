import { describe, expect, it } from 'vitest'
import {
  DEFAULT_GRADE_CONFIG,
  describeGrade,
  gradeDecision,
  resolveGradeConfig,
} from '../src/grade.js'
import type {
  Decision,
  GradeConfig,
  Observation,
  ObservationState,
  Recommendation,
} from '../src/types.js'

// Neutral domain: a fleet-maintenance system recommending a procedure on a
// pump, and inspections that later report whether the fault recurred.
const SUBJECT = 'pump-14'
const CHECK = 'seal-leak'
const DECIDED_AT = '2026-02-01'

const recommendation: Recommendation = {
  id: 'rec-1',
  subjectId: SUBJECT,
  checkKey: CHECK,
  proposedAt: '2026-01-20',
}

const adopted: Decision = {
  recommendationId: 'rec-1',
  status: 'adopted',
  decidedAt: DECIDED_AT,
}

function obs(observedAt: string, state: ObservationState, exposed?: boolean): Observation {
  return {
    subjectId: SUBJECT,
    checkKey: CHECK,
    state,
    observedAt,
    ...(exposed === undefined ? {} : { exposed }),
  }
}

/** Six pre-decision inspections, four of them bad. Rate 0.667. */
function baseline4of6(): Observation[] {
  return [
    obs('2026-01-02', 'bad'),
    obs('2026-01-03', 'bad'),
    obs('2026-01-04', 'bad'),
    obs('2026-01-05', 'bad'),
    obs('2026-01-06', 'good'),
    obs('2026-01-07', 'good'),
  ]
}

/** 'YYYY-MM-DD' for the day `n + 1` days after `DECIDED_AT`, same format as every other date here. */
function dayAfterDecision(n: number): string {
  return new Date(Date.UTC(2026, 1, 2 + n)).toISOString().slice(0, 10)
}

/** `n` post-decision inspections where the procedure was actually performed. */
function exposedAfter(states: ObservationState[]): Observation[] {
  return states.map((state, i) => obs(`2026-02-${String(i + 2).padStart(2, '0')}`, state, true))
}

describe('gradeDecision — verdicts with real before/after rates', () => {
  it('returns holding, with the actual counts and rates on both sides', () => {
    const grade = gradeDecision(
      adopted,
      recommendation,
      [...baseline4of6(), ...exposedAfter(['good', 'good', 'good', 'good', 'good'])],
    )

    expect(grade.verdict).toBe('holding')
    expect(grade.refusalCodes).toEqual([])
    expect(grade.baseline).toEqual({ observations: 6, bad: 4, good: 2, badRate: 0.667 })
    expect(grade.result).toEqual({ observations: 5, bad: 0, good: 5, badRate: 0 })
    expect(grade.badRateDelta).toBe(-0.667)
    expect(grade.interpretation).toBe('association_not_causation')
    expect(describeGrade(grade)).toBe(
      'Holding: seal-leak on pump-14 was bad in 4 of 6 observations before and 0 of 5 exposed observations since the recommendation was adopted on 2026-02-01.',
    )
  })

  it('returns not-holding when the fault recurs at the refute bar', () => {
    const grade = gradeDecision(
      adopted,
      recommendation,
      [...baseline4of6(), ...exposedAfter(['good', 'bad', 'good', 'bad', 'good'])],
    )

    expect(grade.verdict).toBe('not-holding')
    expect(grade.refusalCodes).toEqual([])
    expect(grade.result).toEqual({ observations: 5, bad: 2, good: 3, badRate: 0.4 })
    expect(grade.badRateDelta).toBe(-0.267)
    expect(describeGrade(grade)).toContain('Not holding')
  })

  it('grades a dismissal the same way: recurrence means the pass did not hold', () => {
    const dismissed: Decision = { ...adopted, status: 'dismissed' }
    const observations = [...baseline4of6(), ...exposedAfter(['bad', 'bad', 'good', 'good'])]

    expect(gradeDecision(dismissed, recommendation, observations).verdict).toBe('not-holding')
    expect(
      gradeDecision(dismissed, recommendation, [
        ...baseline4of6(),
        ...exposedAfter(['good', 'good', 'good', 'good']),
      ]).verdict,
    ).toBe('holding')
  })

  it('counts observations stamped exactly at the decision in neither window', () => {
    const grade = gradeDecision(adopted, recommendation, [
      ...baseline4of6(),
      obs(DECIDED_AT, 'bad', true),
      obs(DECIDED_AT, 'bad', true),
      ...exposedAfter(['good', 'good', 'good']),
    ])

    expect(grade.atBoundaryObservations).toBe(2)
    expect(grade.baseline.observations).toBe(6)
    expect(grade.result.observations).toBe(3)
    expect(grade.verdict).toBe('holding')
  })

  it('rounds exact halves up in every rate it reports', () => {
    // 3 bad of 80 is exactly 0.0375. Rounding through binary floating point
    // gave 0.037; half-up on the exact ratio gives 0.038.
    const after = Array.from({ length: 80 }, (_, i) =>
      obs(dayAfterDecision(i), i < 3 ? 'bad' : 'good', true),
    )
    const grade = gradeDecision(adopted, recommendation, [...baseline4of6(), ...after], {
      proposeThreshold: 4,
    })

    expect(grade.result.badRate).toBe(0.038)
    expect(grade.secondary.badRate).toBe(0.038)
    expect(grade.badRateDelta).toBe(-0.629)
  })

  it('ignores observations of another subject or another check', () => {
    const foreign: Observation[] = [
      { subjectId: 'pump-15', checkKey: CHECK, state: 'bad', observedAt: '2026-02-03', exposed: true },
      { subjectId: SUBJECT, checkKey: 'bearing-wear', state: 'bad', observedAt: '2026-02-03', exposed: true },
    ]
    const grade = gradeDecision(adopted, recommendation, [
      ...baseline4of6(),
      ...foreign,
      ...exposedAfter(['good', 'good', 'good']),
    ])

    expect(grade.result).toEqual({ observations: 3, bad: 0, good: 3, badRate: 0 })
    expect(grade.verdict).toBe('holding')
  })
})

describe('gradeDecision — floors return refusal codes, never a verdict', () => {
  it('refuses below the baseline floor, and names only that floor', () => {
    const grade = gradeDecision(adopted, recommendation, [
      obs('2026-01-02', 'bad'),
      obs('2026-01-03', 'bad'),
      ...exposedAfter(['good', 'good', 'good', 'good', 'good']),
    ])

    expect(grade.verdict).toBe('refused')
    expect(grade.refusalCodes).toEqual(['baseline_below_minimum'])
    // The counts are arithmetic and stay visible; only the verdict is withheld.
    expect(grade.baseline.observations).toBe(2)
    expect(grade.result.observations).toBe(5)
  })

  it('refuses below the post-decision floor', () => {
    const grade = gradeDecision(adopted, recommendation, [
      ...baseline4of6(),
      ...exposedAfter(['good', 'good']),
    ])

    expect(grade.verdict).toBe('refused')
    expect(grade.refusalCodes).toContain('result_below_minimum')
    // Exposed observations are a subset of all post-decision observations, so
    // this floor can never fail alone. The exposed floor fails with it.
    expect(grade.refusalCodes).toContain('exposed_result_below_minimum')
    expect(grade.refusalCodes).not.toContain('baseline_below_minimum')
  })

  it('refuses below the exposed-post-decision floor while the raw window is fine', () => {
    const grade = gradeDecision(adopted, recommendation, [
      ...baseline4of6(),
      obs('2026-02-02', 'good', true),
      obs('2026-02-03', 'good', true),
      obs('2026-02-04', 'good', false),
      obs('2026-02-05', 'good', false),
      obs('2026-02-06', 'good'),
    ])

    expect(grade.verdict).toBe('refused')
    expect(grade.refusalCodes).toEqual(['exposed_result_below_minimum'])
    expect(grade.secondary.observations).toBe(5)
    expect(grade.result.observations).toBe(2)
  })

  it('refuses when the baseline shows the fault was never occurring', () => {
    const grade = gradeDecision(adopted, recommendation, [
      obs('2026-01-02', 'good'),
      obs('2026-01-03', 'good'),
      obs('2026-01-04', 'good'),
      obs('2026-01-05', 'good'),
      ...exposedAfter(['good', 'good', 'good', 'good']),
    ])

    // Nothing was wrong before, so nothing being wrong afterwards says nothing
    // about the advice. A grader with no baseline calls this "holding".
    expect(grade.verdict).toBe('refused')
    expect(grade.refusalCodes).toEqual(['baseline_lacks_negative_signal'])
    expect(grade.refusalCodes).not.toContain('baseline_below_minimum')
  })

  it('accumulates every unmet floor rather than reporting the first', () => {
    const grade = gradeDecision(adopted, recommendation, [
      obs('2026-01-02', 'good'),
      obs('2026-02-02', 'good', true),
    ])

    expect(grade.verdict).toBe('refused')
    expect(grade.refusalCodes).toEqual([
      'baseline_below_minimum',
      'baseline_lacks_negative_signal',
      'result_below_minimum',
      'exposed_result_below_minimum',
    ])
    expect(describeGrade(grade)).toContain('Refused to grade')
  })

  it('refuses structurally when the decision does not match the recommendation', () => {
    const grade = gradeDecision(
      { recommendationId: 'rec-other', status: 'adopted', decidedAt: DECIDED_AT },
      recommendation,
      [...baseline4of6(), ...exposedAfter(['good', 'good', 'good'])],
    )

    expect(grade.verdict).toBe('refused')
    expect(grade.refusalCodes).toEqual(['decision_recommendation_mismatch'])
    expect(grade.baseline.observations).toBe(0)
  })

  it('refuses a recommendation that names no check', () => {
    const grade = gradeDecision(
      adopted,
      { ...recommendation, checkKey: '   ' },
      [...baseline4of6(), ...exposedAfter(['good', 'good', 'good'])],
    )

    expect(grade.verdict).toBe('refused')
    expect(grade.refusalCodes).toEqual(['no_gradeable_check_key'])
  })

  it('grades a model-proposed recommendation unless the caller opts out', () => {
    const modelProposed: Recommendation = { ...recommendation, basis: 'model-proposed' }
    const observations = [...baseline4of6(), ...exposedAfter(['good', 'good', 'good'])]

    const permissive = gradeDecision(adopted, modelProposed, observations)
    expect(permissive.verdict).toBe('holding')
    expect(permissive.basis).toBe('model-proposed')

    const strict = gradeDecision(adopted, modelProposed, observations, {
      requireObservedBasis: true,
    })
    expect(strict.verdict).toBe('refused')
    expect(strict.refusalCodes).toEqual(['basis_not_gradeable'])
  })
})

describe('gradeDecision — input validation at the boundary', () => {
  const cleanAfter = exposedAfter(['good', 'good', 'good'])
  const asObservation = (o: Record<string, unknown>): Observation => o as unknown as Observation

  it('throws on a matching observation whose state is not good or bad, instead of counting it as good', () => {
    for (const state of ['BAD', undefined, null, '']) {
      expect(() =>
        gradeDecision(adopted, recommendation, [
          ...baseline4of6(),
          ...cleanAfter,
          asObservation({ subjectId: SUBJECT, checkKey: CHECK, state, observedAt: '2026-02-09', exposed: true }),
        ]),
      ).toThrow(TypeError)
    }
    expect(() =>
      gradeDecision(adopted, recommendation, [
        ...baseline4of6(),
        ...cleanAfter,
        asObservation({ subjectId: SUBJECT, checkKey: CHECK, state: 'BAD', observedAt: '2026-02-09', exposed: true }),
      ]),
    ).toThrow(/state must be 'good' or 'bad', received "BAD"/)
  })

  it('throws on a matching observation with no usable observedAt, instead of parking it at the boundary', () => {
    for (const observedAt of [undefined, 20260209, '']) {
      expect(() =>
        gradeDecision(adopted, recommendation, [
          ...baseline4of6(),
          ...cleanAfter,
          asObservation({ subjectId: SUBJECT, checkKey: CHECK, state: 'bad', observedAt, exposed: true }),
        ]),
      ).toThrow(/observedAt must be a non-empty string/)
    }
  })

  it('does not validate observations of other subjects or checks, which it never reads', () => {
    const grade = gradeDecision(adopted, recommendation, [
      ...baseline4of6(),
      ...cleanAfter,
      asObservation({ subjectId: 'pump-99', checkKey: CHECK, state: 'broken' }),
    ])
    expect(grade.verdict).toBe('holding')
  })

  it('throws on a decision with no usable decidedAt, instead of refusing with misleading floor codes', () => {
    for (const decidedAt of [undefined, '', 20260201]) {
      expect(() =>
        gradeDecision(
          { ...adopted, decidedAt } as unknown as Decision,
          recommendation,
          [...baseline4of6(), ...cleanAfter],
        ),
      ).toThrow(/decision\.decidedAt must be a non-empty string/)
    }
  })

  it('throws on a decision status outside adopted or dismissed', () => {
    expect(() =>
      gradeDecision(
        { ...adopted, status: 'Adopted' } as unknown as Decision,
        recommendation,
        [...baseline4of6(), ...cleanAfter],
      ),
    ).toThrow(/decision\.status must be 'adopted' or 'dismissed'/)
  })

  it('throws on an unknown basis, so a typo cannot slip past requireObservedBasis', () => {
    expect(() =>
      gradeDecision(
        adopted,
        { ...recommendation, basis: 'model_proposed' } as unknown as Recommendation,
        [...baseline4of6(), ...cleanAfter],
        { requireObservedBasis: true },
      ),
    ).toThrow(/recommendation\.basis must be 'observed' or 'model-proposed'/)
  })

  it('throws on non-string ids and subject', () => {
    const rows = [...baseline4of6(), ...cleanAfter]
    expect(() =>
      gradeDecision(adopted, { ...recommendation, id: undefined } as unknown as Recommendation, rows),
    ).toThrow(/recommendation\.id must be a string/)
    expect(() =>
      gradeDecision(adopted, { ...recommendation, subjectId: 14 } as unknown as Recommendation, rows),
    ).toThrow(/recommendation\.subjectId must be a string/)
    expect(() =>
      gradeDecision({ ...adopted, recommendationId: undefined } as unknown as Decision, recommendation, rows),
    ).toThrow(/decision\.recommendationId must be a string/)
  })

  it('refuses a missing checkKey with no_gradeable_check_key instead of crashing', () => {
    const grade = gradeDecision(
      adopted,
      { ...recommendation, checkKey: undefined } as unknown as Recommendation,
      [...baseline4of6(), ...cleanAfter],
    )
    expect(grade.verdict).toBe('refused')
    expect(grade.refusalCodes).toEqual(['no_gradeable_check_key'])
    expect(grade.checkKey).toBe('')
  })

  it('rejects a non-boolean requireObservedBasis instead of treating the string "false" as true', () => {
    expect(() =>
      resolveGradeConfig({ requireObservedBasis: 'false' } as unknown as GradeConfig),
    ).toThrow(TypeError)
  })
})

describe('gradeDecision — exposure alignment', () => {
  it('does not let unexposed observations flip the headline verdict', () => {
    // Three inspections where the procedure was actually performed, all clean.
    // Two where the pump was out of the line and the procedure never ran, both
    // reporting the fault. Without exposure alignment those two flip it.
    const grade = gradeDecision(adopted, recommendation, [
      ...baseline4of6(),
      obs('2026-02-02', 'good', true),
      obs('2026-02-03', 'good', true),
      obs('2026-02-04', 'good', true),
      obs('2026-02-05', 'bad', false),
      obs('2026-02-06', 'bad', false),
    ])

    expect(grade.verdict).toBe('holding')
    expect(grade.result).toEqual({ observations: 3, bad: 0, good: 3, badRate: 0 })

    // The unaligned reading is still computed, still visible, and explicitly
    // labelled as the thing that is not the headline.
    expect(grade.secondary.label).toBe('secondary-not-the-headline')
    expect(grade.secondary).toMatchObject({ observations: 5, bad: 2, badRate: 0.4 })
    expect(grade.secondary.wouldBeVerdict).toBe('not-holding')
    expect(grade.secondary.interpretation).toBe('exposure_unaligned_descriptive_only')

    // The sentence must not present the exposed count as everything since.
    expect(describeGrade(grade)).toContain('0 of 3 exposed observations since')
  })

  it('says the exposure-blind grade would also refuse when its floors fail', () => {
    // No post-decision observations at all. Ignoring exposure changes nothing,
    // so the would-be verdict is a refusal, not 'holding'.
    const noAfter = gradeDecision(adopted, recommendation, baseline4of6())
    expect(noAfter.verdict).toBe('refused')
    expect(noAfter.secondary.wouldBeVerdict).toBe('refused')

    // Thin baseline: the exposure-blind grader has the same baseline floor.
    const thinBaseline = gradeDecision(adopted, recommendation, [
      obs('2026-01-02', 'bad'),
      obs('2026-02-02', 'bad', false),
      obs('2026-02-03', 'bad', false),
      obs('2026-02-04', 'bad', false),
    ])
    expect(thinBaseline.secondary.wouldBeVerdict).toBe('refused')

    // A structural refusal has no window to read at all.
    const mismatch = gradeDecision(
      { ...adopted, recommendationId: 'rec-other' },
      recommendation,
      [...baseline4of6(), ...exposedAfter(['good', 'good', 'good'])],
    )
    expect(mismatch.secondary.wouldBeVerdict).toBe('refused')
  })

  it('gives the exposure-blind verdict when only the exposed floor fails', () => {
    const grade = gradeDecision(adopted, recommendation, [
      ...baseline4of6(),
      obs('2026-02-02', 'bad', false),
      obs('2026-02-03', 'bad', false),
      obs('2026-02-04', 'good', true),
    ])
    expect(grade.refusalCodes).toEqual(['exposed_result_below_minimum'])
    expect(grade.secondary.wouldBeVerdict).toBe('not-holding')
  })

  it('applies the exposed floor to the exposure-blind window too', () => {
    // With exposure ignored, every post-decision observation counts as
    // exposed, so a raised exposed floor applies to all of them.
    const grade = gradeDecision(
      adopted,
      recommendation,
      [...baseline4of6(), ...exposedAfter(['good', 'good', 'good', 'good'])],
      { minExposedResultObservations: 5 },
    )
    expect(grade.refusalCodes).toEqual(['exposed_result_below_minimum'])
    expect(grade.secondary.wouldBeVerdict).toBe('refused')
  })

  it('treats an omitted exposed flag as not-exposed, never as exposed', () => {
    const grade = gradeDecision(adopted, recommendation, [
      ...baseline4of6(),
      obs('2026-02-02', 'good', true),
      obs('2026-02-03', 'good', true),
      obs('2026-02-04', 'good', true),
      obs('2026-02-05', 'bad'),
      obs('2026-02-06', 'bad'),
    ])

    expect(grade.result.observations).toBe(3)
    expect(grade.verdict).toBe('holding')
    expect(grade.secondary.bad).toBe(2)
  })

  it('lets exposed observations reverse the verdict, which is the point', () => {
    const grade = gradeDecision(adopted, recommendation, [
      ...baseline4of6(),
      obs('2026-02-02', 'good', true),
      obs('2026-02-03', 'good', true),
      obs('2026-02-04', 'good', true),
      obs('2026-02-05', 'bad', true),
      obs('2026-02-06', 'bad', true),
    ])

    expect(grade.verdict).toBe('not-holding')
    expect(grade.result).toEqual({ observations: 5, bad: 2, good: 3, badRate: 0.4 })
  })

  it('never applies exposure to the baseline window', () => {
    // Nothing before the decision carries an exposed flag, because there was no
    // recommendation in force for anything to be exposed to.
    const grade = gradeDecision(
      adopted,
      recommendation,
      [...baseline4of6(), ...exposedAfter(['good', 'good', 'good'])],
    )

    expect(grade.baseline.observations).toBe(6)
    expect(grade.baseline.bad).toBe(4)
  })
})

describe('gradeDecision — symmetric propose and refute thresholds', () => {
  it('defaults the refute bar to the propose bar', () => {
    expect(DEFAULT_GRADE_CONFIG.refuteThreshold).toBe(DEFAULT_GRADE_CONFIG.proposeThreshold)
    expect(resolveGradeConfig({}).refuteThreshold).toBe(resolveGradeConfig({}).proposeThreshold)
    expect(resolveGradeConfig({ proposeThreshold: 4 }).refuteThreshold).toBe(4)
  })

  it('does not overturn a decision on a single recurrence at the default bar', () => {
    const grade = gradeDecision(
      adopted,
      recommendation,
      [...baseline4of6(), ...exposedAfter(['good', 'bad', 'good', 'good'])],
    )

    // One recurrence is below the bar it took to propose the rule, so it
    // cannot condemn it. A grader that flips here refutes more cheaply than it
    // proposes.
    expect(grade.verdict).toBe('holding')
    expect(grade.result.bad).toBe(1)
    expect(grade.thresholds.refuteThreshold).toBe(2)
  })

  it('raises the refute bar with the propose bar', () => {
    const twoBad = [...baseline4of6(), ...exposedAfter(['bad', 'bad', 'good', 'good', 'good'])]
    const threeBad = [...baseline4of6(), ...exposedAfter(['bad', 'bad', 'bad', 'good', 'good'])]

    expect(gradeDecision(adopted, recommendation, twoBad, { proposeThreshold: 3 }).verdict).toBe(
      'holding',
    )
    expect(gradeDecision(adopted, recommendation, threeBad, { proposeThreshold: 3 }).verdict).toBe(
      'not-holding',
    )
  })

  it('allows a refute bar above the propose bar', () => {
    const config = { proposeThreshold: 2, refuteThreshold: 4 }
    expect(resolveGradeConfig(config).refuteThreshold).toBe(4)
    // 3 bad of 5 (0.6) stays below the baseline rate (4 of 6, 0.667), so only
    // the count bar is being exercised here, not the rate check.
    expect(
      gradeDecision(
        adopted,
        recommendation,
        [...baseline4of6(), ...exposedAfter(['bad', 'bad', 'bad', 'good', 'good'])],
        config,
      ).verdict,
    ).toBe('holding')
  })

  it('throws when the refute bar is below the propose bar', () => {
    expect(() => resolveGradeConfig({ proposeThreshold: 3, refuteThreshold: 1 })).toThrow(RangeError)
    expect(() =>
      gradeDecision(adopted, recommendation, baseline4of6(), {
        proposeThreshold: 2,
        refuteThreshold: 1,
      }),
    ).toThrow(/refuteThreshold \(1\) is below proposeThreshold \(2\)/)
  })

  it('rejects floors that are not non-negative integers', () => {
    expect(() => resolveGradeConfig({ minBaselineObservations: 0 })).toThrow(RangeError)
    expect(() => resolveGradeConfig({ minResultObservations: 2.5 })).toThrow(RangeError)
  })

  it('honours floors of 1, which is the documented way to defeat the library', () => {
    const grade = gradeDecision(
      adopted,
      recommendation,
      [obs('2026-01-02', 'bad'), obs('2026-02-02', 'good', true)],
      {
        minBaselineObservations: 1,
        minResultObservations: 1,
        minExposedResultObservations: 1,
        proposeThreshold: 1,
      },
    )

    expect(grade.verdict).toBe('holding')
    expect(grade.baseline.observations).toBe(1)
    expect(grade.result.observations).toBe(1)
  })
})
