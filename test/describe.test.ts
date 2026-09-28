import { describe, expect, it } from 'vitest'
import { computeDivergence, describeDivergence } from '../src/divergence.js'
import { describeGrade, gradeDecision } from '../src/grade.js'
import type { Decision, JudgmentPair, Observation, ObservationState, Recommendation } from '../src/types.js'

// AL-001/002/003: the text carries result -> evidence (actual and required
// counts) -> reason -> next action -> limits. The JSON is unchanged.

const recommendation: Recommendation = { id: 'rec-88', subjectId: 'pump-14', checkKey: 'seal-leak', proposedAt: '2026-01-18' }
const adopted: Decision = { recommendationId: 'rec-88', status: 'adopted', decidedAt: '2026-02-01' }
const row = (observedAt: string, state: ObservationState, exposed?: boolean): Observation => ({
  subjectId: 'pump-14',
  checkKey: 'seal-leak',
  observedAt,
  state,
  ...(exposed === undefined ? {} : { exposed }),
})

const CAUSE_LIMIT =
  'This is an association between two windows, not evidence that the recommendation caused the change.'
const DIVERGENCE_LIMIT =
  'These counts compare supplied judgments with supplied outcomes; they do not show causal benefit or general accuracy.'
const NO_CONCLUSION = 'No conclusion about the decision is available from this record.'
const COUNT_ACTION =
  'check the supplied record and exposure flags, and include more valid observations if they exist; do not infer missing exposure.'
const EXPOSED_WHY =
  'Only observations marked exposed: true count toward the headline result; unmarked ones are not assumed exposed.'

describe('describeGrade: refusals say what is missing (AL-001)', () => {
  it('shows actual and required counts for the thin fixture, with the codes and no advice to lower floors', () => {
    const grade = gradeDecision(adopted, recommendation, [row('2026-01-25', 'bad'), row('2026-02-08', 'good', true)])
    const text = describeGrade(grade)
    expect(text).toBe(
      'Not enough evidence to grade seal-leak on pump-14. ' +
        'Before the decision: 1 observation, 3 required (not met). ' +
        'After the decision: 1 observation, 3 required (not met). ' +
        'Confirmed exposed after the decision: 1 observation, 3 required (not met). ' +
        `${EXPOSED_WHY} Next: ${COUNT_ACTION} ${NO_CONCLUSION} ` +
        'Codes: baseline_below_minimum, result_below_minimum, exposed_result_below_minimum.',
    )
    expect(text).not.toMatch(/lower|reduce|relax|loosen/i)
    expect(text).not.toContain('\n')
  })

  it('uses the all-after count for "after" and the exposed-only count for "confirmed exposed" (R02)', () => {
    const grade = gradeDecision(adopted, recommendation, [
      row('2026-01-10', 'bad'),
      row('2026-01-11', 'bad'),
      row('2026-01-12', 'good'),
      row('2026-02-10', 'good', true),
      row('2026-02-11', 'bad', false),
      row('2026-02-12', 'bad', false),
      row('2026-02-13', 'bad'),
      row('2026-02-14', 'good', false),
      row('2026-02-15', 'good', false),
    ])
    expect(grade.secondary.observations).toBe(6)
    expect(grade.result.observations).toBe(1)
    expect(describeGrade(grade)).toBe(
      'Not enough evidence to grade seal-leak on pump-14. ' +
        'Before the decision: 3 observations, 3 required (met). ' +
        'After the decision: 6 observations, 3 required (met). ' +
        'Confirmed exposed after the decision: 1 observation, 3 required (not met). ' +
        `${EXPOSED_WHY} Next: ${COUNT_ACTION} ${NO_CONCLUSION} Codes: exposed_result_below_minimum.`,
    )
  })

  it('explains a baseline with no bad observation without asking for a bad one (R04)', () => {
    const grade = gradeDecision(adopted, recommendation, [
      row('2026-01-10', 'good'),
      row('2026-01-11', 'good'),
      row('2026-01-12', 'good'),
      row('2026-02-10', 'good', true),
      row('2026-02-11', 'good', true),
      row('2026-02-12', 'good', true),
    ])
    const text = describeGrade(grade)
    expect(text).toBe(
      'Not enough evidence to grade seal-leak on pump-14. ' +
        'Before the decision: 3 observations, 3 required (met). ' +
        'Bad observations before the decision: 0, 1 required (not met). ' +
        'After the decision: 3 observations, 3 required (met). ' +
        'Confirmed exposed after the decision: 3 observations, 3 required (met). ' +
        'With no bad observation before the decision, a quiet period afterward says nothing about the recommendation. ' +
        'Next: check that the record covers the time before the decision; do not add observations that did not happen. ' +
        `${NO_CONCLUSION} Codes: baseline_lacks_negative_signal.`,
    )
    expect(text).not.toMatch(/add (a|more) bad|more bad/i)
  })

  it('combines both kinds of action when count and signal floors fail together', () => {
    const grade = gradeDecision(adopted, recommendation, [])
    const text = describeGrade(grade)
    expect(text).toContain('Before the decision: 0 observations, 3 required (not met). Bad observations before the decision: 0, 1 required (not met). After the decision: 0 observations')
    expect(text).toContain(
      `Next: ${COUNT_ACTION} Also check that the record covers the time before the decision; do not add observations that did not happen.`,
    )
    expect(text.endsWith('Codes: baseline_below_minimum, baseline_lacks_negative_signal, result_below_minimum, exposed_result_below_minimum.')).toBe(true)
  })

  it('uses the configured floors as the required counts', () => {
    const grade = gradeDecision(adopted, recommendation, [row('2026-01-25', 'bad')], {
      minBaselineObservations: 5,
      minResultObservations: 4,
      minExposedResultObservations: 2,
      minBaselineBadObservations: 2,
    })
    const text = describeGrade(grade)
    expect(text).toContain('Before the decision: 1 observation, 5 required (not met).')
    expect(text).toContain('Bad observations before the decision: 1, 2 required (not met).')
    expect(text).toContain('After the decision: 0 observations, 4 required (not met).')
    expect(text).toContain('Confirmed exposed after the decision: 0 observations, 2 required (not met).')
  })

  it('explains a mismatched recommendation as invalid input, not as measured absence', () => {
    const grade = gradeDecision({ ...adopted, recommendationId: 'rec-99' }, recommendation, [])
    expect(describeGrade(grade)).toBe(
      'Cannot grade seal-leak on pump-14: the supplied record cannot be graded, so no observations were measured. ' +
        'The decision refers to a different recommendation than the one supplied. ' +
        `Next: correct the flagged input and grade again. ${NO_CONCLUSION} Codes: decision_recommendation_mismatch.`,
    )
  })

  it('explains several structural problems at once and never prints the zero placeholders (R03)', () => {
    const grade = gradeDecision(
      { ...adopted, recommendationId: 'rec-99' },
      { ...recommendation, checkKey: ' ', basis: 'model-proposed' },
      [],
      { requireObservedBasis: true },
    )
    const text = describeGrade(grade)
    expect(text).toBe(
      'Cannot grade (blank) on pump-14: the supplied record cannot be graded, so no observations were measured. ' +
        'The decision refers to a different recommendation than the one supplied. ' +
        'The recommendation names no check (its checkKey is missing or blank), so no observation can be matched to it. ' +
        'The recommendation is model-proposed and this configuration grades observed recommendations only. ' +
        `Next: correct the flagged input and grade again. ${NO_CONCLUSION} ` +
        'Codes: decision_recommendation_mismatch, no_gradeable_check_key, basis_not_gradeable.',
    )
    expect(text).not.toContain('0 observations')
    expect(text).not.toContain('required')
  })

  it('treats a missing checkKey as blank in the label', () => {
    const grade = gradeDecision(adopted, { ...recommendation, checkKey: undefined } as unknown as Recommendation, [])
    expect(describeGrade(grade)).toContain('Cannot grade (blank) on pump-14')
  })
})

describe('describeGrade: verdicts keep the association boundary and explain the rule (AL-003)', () => {
  const quickstart = [
    row('2026-01-04', 'bad'), row('2026-01-11', 'bad'), row('2026-01-18', 'good'),
    row('2026-01-25', 'bad'), row('2026-01-29', 'bad'), row('2026-01-31', 'good'),
    row('2026-02-08', 'good', true), row('2026-02-15', 'good', true), row('2026-02-22', 'good', true),
    row('2026-03-01', 'bad', true),
    row('2026-03-08', 'bad', false),
  ]

  it('holding: the standalone sentence says it is an association', () => {
    expect(describeGrade(gradeDecision(adopted, recommendation, quickstart))).toBe(
      'Holding: seal-leak on pump-14 was bad in 4 of 6 observations before and 1 of 4 exposed observations since the recommendation was adopted on 2026-02-01. ' +
        "The exposed bad count (1) is below the refute threshold (2) and its rate is not higher than the baseline's. " +
        CAUSE_LIMIT,
    )
  })

  it('not holding by count: names the threshold that was reached', () => {
    const rows = [
      ...Array.from({ length: 2 }, (_, i) => row(`2026-01-0${i + 1}`, 'bad')),
      ...Array.from({ length: 2 }, (_, i) => row(`2026-01-1${i}`, 'good')),
      row('2026-02-02', 'bad', true),
      row('2026-02-03', 'bad', true),
      row('2026-02-04', 'good', true),
    ]
    expect(describeGrade(gradeDecision({ ...adopted, status: 'dismissed' }, recommendation, rows))).toBe(
      'Not holding: seal-leak on pump-14 was bad in 2 of 4 observations before and 2 of 3 exposed observations since the recommendation was dismissed on 2026-02-01. ' +
        'The exposed bad count (2) reached the refute threshold (2). ' +
        CAUSE_LIMIT,
    )
  })

  it('not holding by the exact rate while both display 0.125: explains why (81/650 vs 1/8)', () => {
    const isoDay = (offset: number) => new Date(Date.UTC(2026, 1, 1) + offset * 86_400_000).toISOString().slice(0, 10)
    const before = Array.from({ length: 650 }, (_, i) => row(isoDay(-(i + 1)), i < 81 ? 'bad' : 'good'))
    const after = Array.from({ length: 8 }, (_, i) => row(isoDay(i + 1), i === 0 ? 'bad' : 'good', true))
    const grade = gradeDecision(adopted, recommendation, [...before, ...after])
    expect(grade.verdict).toBe('not-holding')
    expect(grade.baseline.badRate).toBe(0.125)
    expect(grade.result.badRate).toBe(0.125)
    expect(grade.badRateDelta).toBe(0)
    expect(describeGrade(grade)).toBe(
      'Not holding: seal-leak on pump-14 was bad in 81 of 650 observations before and 1 of 8 exposed observations since the recommendation was adopted on 2026-02-01. ' +
        "The exposed bad count (1) is below the refute threshold (2), but the exposed bad rate (1 of 8) is higher than the baseline's (81 of 650), compared as exact counts. " +
        'Both display as 0.125; the exact counts decide, not the rounded display. ' +
        CAUSE_LIMIT,
    )
  })

  it('not holding by a rate that also displays higher: no "both display" sentence', () => {
    const rows = [
      ...Array.from({ length: 10 }, (_, i) => row(`2026-01-${String(i + 1).padStart(2, '0')}`, i === 0 ? 'bad' : 'good')),
      row('2026-02-02', 'bad', true),
      row('2026-02-03', 'good', true),
      row('2026-02-04', 'good', true),
    ]
    const text = describeGrade(gradeDecision(adopted, recommendation, rows))
    expect(text).toContain("but the exposed bad rate (1 of 3) is higher than the baseline's (1 of 10), compared as exact counts. This is an association")
    expect(text).not.toContain('Both display')
  })

  it('leaves every JSON field of the grade unchanged', () => {
    const grade = gradeDecision(adopted, recommendation, quickstart)
    expect(Object.keys(grade)).toEqual([
      'recommendationId', 'subjectId', 'checkKey', 'status', 'basis', 'decidedAt', 'thresholds', 'method',
      'interpretation', 'verdict', 'refusalCodes', 'baseline', 'result', 'badRateDelta', 'secondary', 'atBoundaryObservations',
    ])
    expect(grade.interpretation).toBe('association_not_causation')
    expect(grade.baseline).toEqual({ observations: 6, bad: 4, good: 2, badRate: 0.667 })
    expect(grade.result).toEqual({ observations: 4, bad: 1, good: 3, badRate: 0.25 })
    expect(grade.badRateDelta).toBe(-0.417)
  })
})

const times = (n: number, pair: JudgmentPair): JudgmentPair[] => Array.from({ length: n }, () => pair)
const agree = (n: number, group?: string) =>
  times(n, { engineJudgment: 'keep', humanJudgment: 'keep', ...(group === undefined ? {} : { group }) })
const split = (n: number, laterOutcome?: string, group?: string) =>
  times(n, {
    engineJudgment: 'keep',
    humanJudgment: 'remove',
    ...(laterOutcome === undefined ? {} : { laterOutcome }),
    ...(group === undefined ? {} : { group }),
  })

describe('describeDivergence: every resolved outcome is accounted for (AL-002)', () => {
  it('counts neither-right outcomes (the all-neither fixture)', () => {
    const { overall } = computeDivergence([...agree(7), ...split(3, 'defer')])
    expect(overall.calibration.neitherRight).toBe(3)
    expect(describeDivergence(overall)).toBe(
      'Overall: the human disagreed on 3 of 10 comparable pairs. ' +
        'Of the 3 with a later outcome, the engine was right 0, the human was right 0 and neither was right 3. ' +
        `No disagreement is still unresolved. ${DIVERGENCE_LIMIT}`,
    )
  })

  it('keeps engine, human, neither and unresolved distinct in a mixed fixture', () => {
    const { overall } = computeDivergence([
      ...agree(15),
      ...split(1, 'keep'),
      ...split(1, 'remove'),
      ...split(1, 'defer'),
      ...split(2),
    ])
    expect(describeDivergence(overall)).toBe(
      'Overall: the human disagreed on 5 of 20 comparable pairs. ' +
        'Of the 3 with a later outcome, the engine was right 1, the human was right 1 and neither was right 1. ' +
        `2 more have no later outcome yet. ${DIVERGENCE_LIMIT}`,
    )
  })

  it('uses the singular for one unresolved disagreement', () => {
    const { overall } = computeDivergence([...agree(15), ...split(3, 'keep'), ...split(1)])
    expect(describeDivergence(overall)).toContain('1 more has no later outcome yet.')
  })

  it('does not present calibration counts when calibration is refused (R08)', () => {
    const { overall } = computeDivergence([...agree(20), ...split(2, 'keep'), ...split(3)])
    const text = describeDivergence(overall)
    expect(text).toBe(
      'Overall: the human disagreed on 5 of 25 comparable pairs. ' +
        'Who was right is not reported yet (resolved_divergent_below_minimum): 2 of 5 disagreements have a later outcome. ' +
        DIVERGENCE_LIMIT,
    )
    expect(text).not.toContain('was right 2')
    expect(text).not.toContain('neither was right')
  })

  it('shows the required count for calibration when thresholds are passed', () => {
    const result = computeDivergence([...agree(20), ...split(2, 'keep'), ...split(3)])
    expect(describeDivergence(result.overall, result.thresholds)).toContain(
      '2 of 5 disagreements have a later outcome (3 required).',
    )
  })

  it('the calibration recovers at the floor while the numbers stay separate (R08)', () => {
    const before = computeDivergence([...agree(7), ...split(1, 'keep'), ...split(1, 'remove'), ...split(1)]).overall
    const after = computeDivergence([...agree(7), ...split(1, 'keep'), ...split(1, 'remove'), ...split(1, 'defer')]).overall
    expect(describeDivergence(before)).toContain('Who was right is not reported yet')
    expect(describeDivergence(after)).toContain(
      'Of the 3 with a later outcome, the engine was right 1, the human was right 1 and neither was right 1.',
    )
  })

  it('refused reports keep the counts, list the shortfalls and reach no conclusion', () => {
    const empty = computeDivergence([]).overall
    expect(describeDivergence(empty)).toBe(
      'Overall: refused to report divergence (comparable_pairs_below_minimum, divergent_count_below_minimum, divergent_rate_below_minimum); 0 of 0 comparable pairs diverged. ' +
        'Short on: comparable pairs (0), disagreements (0), disagreement rate (no comparable pairs). ' +
        'No conclusion about the engine or the human is available from these pairs.',
    )
    const result = computeDivergence([])
    expect(describeDivergence(result.overall, result.thresholds)).toBe(
      'Overall: refused to report divergence (comparable_pairs_below_minimum, divergent_count_below_minimum, divergent_rate_below_minimum); 0 of 0 comparable pairs diverged. ' +
        'Short on: comparable pairs (0, 10 required), disagreements (0, 3 required), disagreement rate (no comparable pairs, 0.05 required). ' +
        'No conclusion about the engine or the human is available from these pairs.',
    )
  })

  it('explains a rate that displays at the floor but is refused on the exact ratio', () => {
    const result = computeDivergence([...agree(96), ...split(5, 'keep')])
    expect(result.overall.divergentRate).toBe(0.05)
    expect(describeDivergence(result.overall, result.thresholds)).toBe(
      'Overall: refused to report divergence (divergent_rate_below_minimum); 5 of 101 comparable pairs diverged. ' +
        'Short on: disagreement rate (5 of 101, 0.05 required; it displays as 0.05 but the exact ratio is lower). ' +
        'No conclusion about the engine or the human is available from these pairs.',
    )
    expect(describeDivergence(result.overall)).toContain('Short on: disagreement rate (5 of 101).')
  })

  it('names a refused group', () => {
    const { groups } = computeDivergence(split(2, undefined, 'text'))
    expect(describeDivergence(groups[0] as (typeof groups)[number])).toBe(
      'Group text: refused to report divergence (comparable_pairs_below_minimum, divergent_count_below_minimum); 2 of 2 comparable pairs diverged. ' +
        'Short on: comparable pairs (2), disagreements (2). ' +
        'No conclusion about the engine or the human is available from these pairs.',
    )
  })

  it('leaves every JSON field of the report unchanged', () => {
    const { overall } = computeDivergence([...agree(7), ...split(3, 'defer')])
    expect(Object.keys(overall)).toEqual([
      'group', 'totalPairs', 'comparablePairs', 'agreements', 'divergentCount', 'divergentRate', 'status',
      'refusalCodes', 'calibration', 'examples', 'interpretation',
    ])
    expect(overall.calibration).toMatchObject({ resolvedDivergent: 3, engineRight: 0, humanRight: 0, neitherRight: 3 })
    expect(overall.interpretation).toBe('disagreement_is_a_signal_not_a_verdict')
  })
})

const hasRawUnsafe = (value: string): boolean => ['\u001b', '\u202E', '\n', '\r'].some((c) => value.includes(c))

describe('bug class 8: caller strings are escaped in text output', () => {
  const evil = 'x\nRefused to grade: forged\u001b[31m\u202Eeman'
  const escaped = 'x\\nRefused to grade: forged\\u{1B}[31m\\u{202E}eman'

  it('escapes checkKey, subjectId and decidedAt in a grade sentence and keeps it on one line', () => {
    const grade = gradeDecision(adopted, recommendation, [])
    const hostile = { ...grade, checkKey: evil, subjectId: evil, decidedAt: evil }
    const text = describeGrade(hostile)
    expect(text).toContain(`${escaped} on ${escaped}`)
    expect(hasRawUnsafe(text)).toBe(false)
    const holding = gradeDecision(adopted, recommendation, [
      row('2026-01-10', 'bad'), row('2026-01-11', 'bad'), row('2026-01-12', 'good'),
      row('2026-02-10', 'good', true), row('2026-02-11', 'good', true), row('2026-02-12', 'good', true),
    ])
    const holdingText = describeGrade({ ...holding, checkKey: evil, decidedAt: evil })
    expect(holdingText).toContain(`Holding: ${escaped} on pump-14`)
    expect(holdingText).toContain(`adopted on ${escaped}.`)
    expect(hasRawUnsafe(holdingText)).toBe(false)
  })

  it('escapes a hostile checkKey that was really graded', () => {
    const key = 'seal\n\u202Eleak'
    const grade = gradeDecision(adopted, { ...recommendation, checkKey: key }, [])
    expect(describeGrade(grade)).toContain('grade seal\\n\\u{202E}leak on pump-14.')
  })

  it('escapes refusal codes, group names and counts that are not numbers', () => {
    const grade = gradeDecision(adopted, recommendation, [])
    const text = describeGrade({ ...grade, refusalCodes: ['a\nb' as never] })
    expect(text).toContain('Codes: a\\nb.')
    const { overall } = computeDivergence([...agree(7), ...split(3, 'defer')])
    expect(describeDivergence({ ...overall, group: evil })).toContain(`Group ${escaped}: the human disagreed`)
    const grouped = computeDivergence(split(2), { groupBy: () => 'g\nh\u202E' })
    expect(describeDivergence(grouped.groups[0] as (typeof grouped.groups)[number])).toContain('Group g\\nh\\u{202E}:')
    const odd = describeGrade({ ...grade, baseline: { ...grade.baseline, observations: 'a\nb' as never } })
    expect(odd).not.toContain('\n')
  })

  it('leaves ordinary long identifiers whole', () => {
    const longId = `pump-${'x'.repeat(200)}`
    const grade = gradeDecision(adopted, { ...recommendation, subjectId: longId }, [])
    expect(describeGrade(grade)).toContain(`seal-leak on ${longId}.`)
  })

  it('leaves structured data raw: the JSON keeps the caller string exactly', () => {
    const key = 'seal\n\u202Eleak'
    const grade = gradeDecision(adopted, { ...recommendation, checkKey: key }, [])
    expect(grade.checkKey).toBe(key)
    const { groups } = computeDivergence(split(2), { groupBy: () => 'g\nh' })
    expect(groups[0]?.group).toBe('g\nh')
  })
})
