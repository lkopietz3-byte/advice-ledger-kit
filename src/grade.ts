// grade.ts — grade one decision against what actually happened afterwards.
//
// The whole module is one function plus its config resolution. The care is in
// what it refuses to say:
//
//   - It requires a BASELINE from before the decision with enough
//     observations and at least one bad one. "No problems since you adopted
//     this" is only worth grading when there were problems to begin with.
//     The verdict combines a count check (fewer than `refuteThreshold` bad
//     exposed observations since the decision) with a rate check (the
//     exposed bad rate is not higher than the baseline's, compared as an
//     exact ratio, never the rounded `badRate`/`badRateDelta` shown for
//     display): either one failing makes the decision 'not-holding'.
//
//   - It applies floors to the baseline window, the post-decision window, and
//     the exposed post-decision window SEPARATELY, because they fail for
//     different reasons and the caller should be told which one is thin.
//
//   - It aligns exposure: only observations where the advice could actually
//     have applied are allowed to create or reverse the headline verdict. The
//     unaligned reading is still computed, but it is labeled as secondary and
//     structurally cannot become the headline.
//
//   - Its refute bar is symmetric with its propose bar by default. A grader
//     that needs two observations to suggest something and one to condemn it
//     is not being careful, it is biased toward condemning.

import type {
  Decision,
  DecisionGrade,
  DecisionVerdict,
  GradeConfig,
  GradeRefusalCode,
  Observation,
  DecisionStatus,
  Recommendation,
  RecommendationBasis,
  ResolvedGradeConfig,
  SecondaryReading,
  WindowReading,
} from './types.js'
import {
  denseCopy,
  describe,
  difference3,
  isBlank,
  label,
  parseInstant,
  plural,
  rate,
  rateHigherThan,
  requireCount,
  requirePlainRecord,
  text,
  typeFail,
} from './internal.js'

/**
 * The defaults every unspecified `GradeConfig` field falls back to: 3/3/3
 * observation floors, 1 bad baseline observation, propose and refute bars of
 * 2, and `requireObservedBasis: false`. Frozen.
 */
export const DEFAULT_GRADE_CONFIG: Readonly<ResolvedGradeConfig> = Object.freeze({
  minBaselineObservations: 3,
  minResultObservations: 3,
  minExposedResultObservations: 3,
  minBaselineBadObservations: 1,
  proposeThreshold: 2,
  refuteThreshold: 2,
  requireObservedBasis: false,
})

const SECONDARY_NOTE =
  'Every post-decision observation, including ones where the recommendation could not have applied. Descriptive only. It cannot create or reverse the headline verdict.'

/** One matching observation after it has been read once and validated. */
interface Reading {
  readonly bad: boolean
  readonly instant: number
  readonly exposed: boolean
}

function readWindow(observations: readonly Reading[]): WindowReading {
  const bad = observations.filter((o) => o.bad).length
  return {
    observations: observations.length,
    bad,
    good: observations.length - bad,
    badRate: rate(bad, observations.length),
  }
}

const emptyWindow = (): WindowReading => ({ observations: 0, bad: 0, good: 0, badRate: null })

/**
 * 'not-holding' when the window has at least `refuteThreshold` bad
 * observations, OR when its exact bad rate is higher than `baseline`'s,
 * even below that count. Otherwise 'holding'.
 *
 * The rate check is exact (cross-multiplication in `rateHigherThan`), not a
 * comparison of the rounded `badRate` fields, so two rates that display the
 * same 3-place value but differ underneath still compare correctly. It never
 * returns 'refused': callers only reach this once the floors that make
 * `baseline` non-empty have already passed.
 */
function verdictFor(
  window: WindowReading,
  baseline: WindowReading,
  thresholds: ResolvedGradeConfig,
): DecisionVerdict {
  if (window.bad >= thresholds.refuteThreshold) return 'not-holding'
  if (rateHigherThan(window.bad, window.observations, baseline.bad, baseline.observations)) {
    return 'not-holding'
  }
  return 'holding'
}

/**
 * Fill in defaults and reject a config that is asymmetric in the wrong
 * direction.
 *
 * `refuteThreshold` defaults to `proposeThreshold`, so the out-of-the-box
 * behavior is symmetric. A caller may raise it (harder to overturn a
 * decision) but never lower it: needing less evidence to condemn advice than
 * it took to offer it biases the grade toward "not holding".
 *
 * `null` and `undefined` fields fall back to the defaults, and an omitted
 * (`undefined`) config means all defaults. Returns a new object; the input is
 * not modified and each of its fields is read once.
 *
 * @throws TypeError when `config` is present but not a plain object (a Map,
 *   array, Date, class instance or `null` is not read as "use the defaults").
 * @throws RangeError when `refuteThreshold < proposeThreshold`, when
 *   `minBaselineBadObservations` is not an integer >= 0, or when any other
 *   count is not an integer >= 1 (NaN and Infinity included).
 * @throws TypeError when `requireObservedBasis` is present and not a boolean.
 */
export function resolveGradeConfig(config: GradeConfig = {}): ResolvedGradeConfig {
  const d = DEFAULT_GRADE_CONFIG
  const given = requirePlainRecord('config', config) as GradeConfig
  const proposeThreshold = requireCount(
    'proposeThreshold',
    given.proposeThreshold ?? d.proposeThreshold,
    1,
  )
  const refuteThreshold = requireCount(
    'refuteThreshold',
    given.refuteThreshold ?? proposeThreshold,
    1,
  )
  if (refuteThreshold < proposeThreshold) {
    throw new RangeError(
      `advice-ledger-kit: refuteThreshold (${refuteThreshold}) is below proposeThreshold (${proposeThreshold}). ` +
        'Overturning a decision must never take less evidence than making the recommendation took. ' +
        'Raise refuteThreshold to at least proposeThreshold, or lower proposeThreshold to match what the proposal really required.',
    )
  }
  const requireObservedBasis = given.requireObservedBasis ?? d.requireObservedBasis
  if (typeof requireObservedBasis !== 'boolean') {
    typeFail(`requireObservedBasis must be a boolean, received ${describe(requireObservedBasis)}`)
  }
  return {
    minBaselineObservations: requireCount(
      'minBaselineObservations',
      given.minBaselineObservations ?? d.minBaselineObservations,
      1,
    ),
    minResultObservations: requireCount(
      'minResultObservations',
      given.minResultObservations ?? d.minResultObservations,
      1,
    ),
    minExposedResultObservations: requireCount(
      'minExposedResultObservations',
      given.minExposedResultObservations ?? d.minExposedResultObservations,
      1,
    ),
    minBaselineBadObservations: requireCount(
      'minBaselineBadObservations',
      given.minBaselineBadObservations ?? d.minBaselineBadObservations,
      0,
    ),
    proposeThreshold,
    refuteThreshold,
    requireObservedBasis,
  }
}

const BASES: readonly unknown[] = ['observed', 'model-proposed']
const STATUSES: readonly unknown[] = ['adopted', 'dismissed']
const STATES: readonly unknown[] = ['good', 'bad']

/** A string field that must be present and show something. */
function requireIdentity(name: string, value: unknown): string {
  if (typeof value !== 'string') typeFail(`${name} must be a string, received ${describe(value)}`)
  if (isBlank(value)) {
    typeFail(`${name} must not be blank (empty, whitespace or invisible characters only), received ${describe(value)}`)
  }
  return value
}

interface RecommendationSnapshot {
  readonly id: string
  readonly subjectId: string
  readonly checkKey: unknown
  readonly basis: RecommendationBasis
}

interface DecisionSnapshot {
  readonly recommendationId: string
  readonly status: DecisionStatus
  readonly decidedAt: string
  readonly decidedInstant: number
}

// TypeScript callers cannot get these wrong, but JavaScript and JSON callers
// can, and each one used to fail silently: an unknown `state` counted as
// 'good', a missing date landed in `atBoundaryObservations` or emptied the
// baseline, and a misspelled `basis` slipped past `requireObservedBasis`.
// Every field is read exactly once here; grading uses only these snapshots.
function readRecommendation(value: unknown): RecommendationSnapshot {
  const rec = requirePlainRecord('recommendation', value)
  const { id, subjectId, checkKey, basis } = rec
  requireIdentity('recommendation.id', id)
  requireIdentity('recommendation.subjectId', subjectId)
  if (basis !== undefined && !BASES.includes(basis)) {
    typeFail(
      `recommendation.basis must be 'observed' or 'model-proposed' when present, received ${describe(basis)}`,
    )
  }
  return {
    id: id as string,
    subjectId: subjectId as string,
    checkKey,
    basis: (basis ?? 'observed') as RecommendationBasis,
  }
}

function readDecision(value: unknown): DecisionSnapshot {
  const dec = requirePlainRecord('decision', value)
  const { recommendationId, status, decidedAt } = dec
  requireIdentity('decision.recommendationId', recommendationId)
  if (!STATUSES.includes(status)) {
    typeFail(`decision.status must be 'adopted' or 'dismissed', received ${describe(status)}`)
  }
  if (typeof decidedAt !== 'string' || decidedAt.length === 0) {
    typeFail(`decision.decidedAt must be a non-empty string, received ${describe(decidedAt)}`)
  }
  return {
    recommendationId: recommendationId as string,
    status: status as DecisionStatus,
    decidedAt,
    decidedInstant: parseInstant('decision.decidedAt', decidedAt),
  }
}

function readReading(row: Record<string, unknown>, index: number): Reading {
  const { state, observedAt, exposed } = row
  if (!STATES.includes(state)) {
    typeFail(`observations[${index}].state must be 'good' or 'bad', received ${describe(state)}`)
  }
  if (typeof observedAt !== 'string' || observedAt.length === 0) {
    typeFail(`observations[${index}].observedAt must be a non-empty string, received ${describe(observedAt)}`)
  }
  return {
    bad: state === 'bad',
    instant: parseInstant(`observations[${index}].observedAt`, observedAt),
    exposed: exposed === true,
  }
}

function secondaryFrom(window: WindowReading, wouldBeVerdict: DecisionVerdict): SecondaryReading {
  return {
    label: 'secondary-not-the-headline',
    ...window,
    wouldBeVerdict,
    interpretation: 'exposure_unaligned_descriptive_only',
    note: SECONDARY_NOTE,
  }
}

/**
 * Grade one decision against the observations that came after it.
 *
 * The verdict grades the DECISION, not the recommendation, and it means the
 * same thing either way the human called it:
 *
 *   adopted   + the problem stayed away  -> 'holding'
 *   adopted   + the problem came back    -> 'not-holding'
 *   dismissed + the problem stayed away  -> 'holding'      (the pass looks fine)
 *   dismissed + the problem came back    -> 'not-holding'  (the evidence sided with the advice)
 *
 * "The problem came back" means at least `refuteThreshold` bad observations in
 * the exposed post-decision window, OR the exposed bad rate is higher than
 * the baseline's, even below that count. The rate comparison is exact
 * (cross-multiplication, see `rateHigherThan` in `internal.ts`), so it can
 * disagree with a comparison of the rounded `badRate` fields, or with the
 * sign of `badRateDelta`, right at a rounding boundary. Because the
 * post-decision window is every observation you pass, a long enough window
 * with any recurrence rate will eventually reach the count bar. Pass a
 * bounded window if that matters. Anything short of every floor being met
 * returns 'refused' with the specific codes attached, and no verdict at all.
 *
 * Pure: reads its inputs, never modifies them, and gives the same result for
 * any order of `observations`. Observations are not deduplicated.
 *
 * @param decision - the human's call. Its `recommendationId` must match `recommendation.id`.
 * @param recommendation - the advice being graded.
 * @param observations - every observation available; this function does the
 *   filtering by `subjectId` and `checkKey` (exact equality) itself, so passing
 *   the whole log is fine. Only matching observations are read and validated.
 * @param config - floors and thresholds. See `resolveGradeConfig`.
 * @throws RangeError or TypeError from `resolveGradeConfig`.
 * @throws RangeError when `decision.decidedAt`, or `observedAt` on a matching
 *   observation, is a non-empty string that is not a date ('YYYY-MM-DD', read
 *   as UTC midnight) or a timestamp with seconds and an explicit zone (`Z` or
 *   `+hh:mm`), or names a day that does not exist. Windows compare parsed
 *   instants, so `...T00:00:00Z`, `...T00:00:00.000Z` and `...T01:00:00+01:00`
 *   are the same moment.
 * @throws TypeError when `recommendation.id`, `recommendation.subjectId` or
 *   `decision.recommendationId` is not a string, `recommendation.basis` is
 *   present and not 'observed' or 'model-proposed', `decision.status` is not
 *   'adopted' or 'dismissed', `decision.decidedAt` is not a non-empty string,
 *   or a matching observation has a `state` other than 'good'/'bad' or an
 *   empty or non-string `observedAt`.
 */
export function gradeDecision(
  decision: Decision,
  recommendation: Recommendation,
  observations: readonly Observation[],
  config: GradeConfig = {},
): DecisionGrade {
  const thresholds = resolveGradeConfig(config)
  const rec = readRecommendation(recommendation)
  const dec = readDecision(decision)
  const basis = rec.basis

  const base = {
    recommendationId: rec.id,
    subjectId: rec.subjectId,
    // Keep the result's declared `string` type true for JavaScript callers
    // that omit checkKey; that case is refused with no_gradeable_check_key.
    checkKey: typeof rec.checkKey === 'string' ? rec.checkKey : '',
    status: dec.status,
    basis,
    decidedAt: dec.decidedAt,
    thresholds,
    method: 'exposure_aligned_before_after_on_matched_check',
    interpretation: 'association_not_causation',
  } as const

  // Structural refusals come first and short-circuit. If the ledger rows do
  // not even refer to each other, or the recommendation names no check, then
  // every count downstream would be zero for a reason that has nothing to do
  // with the evidence, and reporting "baseline below minimum" on top of that
  // would be a misleading second sentence about a first problem.
  const structural: GradeRefusalCode[] = []
  if (dec.recommendationId !== rec.id) {
    structural.push('decision_recommendation_mismatch')
  }
  // A missing, non-string or visibly empty checkKey names no check either.
  if (typeof rec.checkKey !== 'string' || isBlank(rec.checkKey)) {
    structural.push('no_gradeable_check_key')
  }
  if (thresholds.requireObservedBasis && basis === 'model-proposed') {
    structural.push('basis_not_gradeable')
  }
  if (structural.length > 0) {
    return {
      ...base,
      verdict: 'refused',
      refusalCodes: structural,
      baseline: emptyWindow(),
      result: emptyWindow(),
      badRateDelta: null,
      secondary: secondaryFrom(emptyWindow(), 'refused'),
      atBoundaryObservations: 0,
    }
  }

  // One indexed pass over a dense copy. Each row is read once; only matching
  // rows are validated, and everything below computes from these snapshots.
  const rows = denseCopy('observations', observations)
  const relevant: Reading[] = []
  for (let index = 0; index < rows.length; index++) {
    const row = requirePlainRecord(`observations[${index}]`, rows[index])
    const { subjectId, checkKey } = row
    if (subjectId === rec.subjectId && checkKey === rec.checkKey) {
      relevant.push(readReading(row, index))
    }
  }
  // Compared as instants, so '...00Z', '...00.000Z' and '...+00:00' agree.
  const before = relevant.filter((o) => o.instant < dec.decidedInstant)
  const after = relevant.filter((o) => o.instant > dec.decidedInstant)
  // An observation stamped exactly at the decision is ambiguous: part of that
  // moment is before the advice was in force and part is after. It is counted
  // and reported, and it grades nothing.
  const atBoundaryObservations = relevant.length - before.length - after.length

  // Exposure alignment. `exposed === true` and nothing else: an unanswered
  // exposure question is not a confirmed exposure. Baseline observations are
  // NOT filtered this way, because before the decision there was no advice for
  // anything to be exposed to.
  const exposedAfter = after.filter((o) => o.exposed)

  const baseline = readWindow(before)
  const result = readWindow(exposedAfter)
  const unaligned = readWindow(after)

  // What the same grader would say with exposure ignored: every post-decision
  // observation counts as exposed, and every floor still applies. A grader
  // that ignores exposure but keeps its floors would refuse here too, so the
  // would-be verdict is 'refused', never a 'holding' read off an empty window.
  const unalignedRefused =
    baseline.observations < thresholds.minBaselineObservations ||
    baseline.bad < thresholds.minBaselineBadObservations ||
    after.length < thresholds.minResultObservations ||
    after.length < thresholds.minExposedResultObservations
  const secondary = secondaryFrom(
    unaligned,
    unalignedRefused ? 'refused' : verdictFor(unaligned, baseline, thresholds),
  )

  const refusalCodes: GradeRefusalCode[] = []
  if (baseline.observations < thresholds.minBaselineObservations) {
    refusalCodes.push('baseline_below_minimum')
  }
  if (baseline.bad < thresholds.minBaselineBadObservations) {
    // Nothing was going wrong before the decision, so nothing going wrong
    // after it is not evidence about the advice. This is the flaw a
    // "no gap observed since adoption" grader cannot see.
    refusalCodes.push('baseline_lacks_negative_signal')
  }
  if (after.length < thresholds.minResultObservations) {
    refusalCodes.push('result_below_minimum')
  }
  if (exposedAfter.length < thresholds.minExposedResultObservations) {
    refusalCodes.push('exposed_result_below_minimum')
  }

  const badRateDelta =
    result.badRate !== null && baseline.badRate !== null
      ? difference3(result.badRate, baseline.badRate)
      : null

  if (refusalCodes.length > 0) {
    return {
      ...base,
      verdict: 'refused',
      refusalCodes,
      baseline,
      result,
      badRateDelta,
      secondary,
      atBoundaryObservations,
    }
  }

  return {
    ...base,
    verdict: verdictFor(result, baseline, thresholds),
    refusalCodes: [],
    baseline,
    result,
    badRateDelta,
    secondary,
    atBoundaryObservations,
  }
}

const CAUSE_LIMIT =
  'This is an association between two windows, not evidence that the recommendation caused the change.'

const STRUCTURAL_REASONS: Partial<Record<GradeRefusalCode, string>> = {
  decision_recommendation_mismatch:
    'The decision refers to a different recommendation than the one supplied.',
  no_gradeable_check_key:
    'The recommendation names no check (its checkKey is missing or blank), so no observation can be matched to it.',
  basis_not_gradeable:
    'The recommendation is model-proposed and this configuration grades observed recommendations only.',
}

/** `<prefix>: <count> [noun], <required> required (met|not met).` */
function floorLine(prefix: string, count: number, required: number, noun?: string): string {
  const met = count >= required
  const shown = noun === undefined ? text(count) : plural(count, noun)
  return `${prefix}: ${shown}, ${text(required)} required (${met ? 'met' : 'not met'}).`
}

function describeRefusal(grade: DecisionGrade, where: string): string {
  const codes: readonly GradeRefusalCode[] = grade.refusalCodes
  const codeList = `Codes: ${codes.map((c) => text(c)).join(', ')}.`
  const noConclusion = 'No conclusion about the decision is available from this record.'
  const structural = codes.filter((c) => STRUCTURAL_REASONS[c] !== undefined)
  if (structural.length > 0) {
    // Structural refusals never read an observation, so the zero windows in
    // the result are placeholders. Say so instead of printing them as counts.
    const reasons = structural.map((c) => STRUCTURAL_REASONS[c]).join(' ')
    return (
      `Cannot grade ${where}: the supplied record cannot be graded, so no observations were measured. ` +
      `${reasons} Next: correct the flagged input and grade again. ${noConclusion} ${codeList}`
    )
  }

  const t = grade.thresholds
  const lacksSignal = codes.includes('baseline_lacks_negative_signal')
  const exposedShort = codes.includes('exposed_result_below_minimum')
  const countShort =
    codes.includes('baseline_below_minimum') ||
    codes.includes('result_below_minimum') ||
    exposedShort
  const parts = [
    `Not enough evidence to grade ${where}.`,
    floorLine('Before the decision', grade.baseline.observations, t.minBaselineObservations, 'observation'),
  ]
  if (lacksSignal) {
    parts.push(floorLine('Bad observations before the decision', grade.baseline.bad, t.minBaselineBadObservations))
  }
  // `secondary` counts every post-decision observation; `result` counts only
  // the confirmed-exposed ones. They are different windows with different floors.
  parts.push(
    floorLine('After the decision', grade.secondary.observations, t.minResultObservations, 'observation'),
    floorLine('Confirmed exposed after the decision', grade.result.observations, t.minExposedResultObservations, 'observation'),
  )
  if (exposedShort) {
    parts.push('Only observations marked exposed: true count toward the headline result; unmarked ones are not assumed exposed.')
  }
  if (lacksSignal) {
    parts.push(
      'With no bad observation before the decision, a quiet period afterward says nothing about the recommendation.',
    )
  }
  const countAction =
    'check the supplied record and exposure flags, and include more valid observations if they exist; do not infer missing exposure.'
  const signalAction =
    'check that the record covers the time before the decision; do not add observations that did not happen.'
  if (countShort && lacksSignal) parts.push(`Next: ${countAction} Also ${signalAction}`)
  else if (countShort) parts.push(`Next: ${countAction}`)
  else if (lacksSignal) parts.push(`Next: ${signalAction}`)
  parts.push(noConclusion, codeList)
  return parts.join(' ')
}

/**
 * Render a grade as plain text on one line: result, then evidence, then the
 * reason, the next step and the limits. The JSON stays the source of truth;
 * this is what to show a reader who will not open it.
 *
 * - A verdict reads "Holding: <check> on <subject> was bad in B of N
 *   observations before and b of n exposed observations since the
 *   recommendation was <status> on <decidedAt>." It then says which rule
 *   decided (the count reaching `refuteThreshold`, or the exact rate being
 *   higher than the baseline's, with a note when both rates display the
 *   same) and that the reading is an association, not proof the
 *   recommendation caused anything.
 * - A refusal for missing evidence reads "Not enough evidence to grade ...",
 *   then each floor with its actual and required count (before, after, and
 *   confirmed exposed after, plus bad-before when that floor failed), why it
 *   matters, what to check, and the codes. It never suggests lowering a floor
 *   or adding observations that did not happen.
 * - A structural refusal reads "Cannot grade ..." and explains the invalid
 *   input; the zero windows are placeholders and are not printed as counts.
 *
 * Caller strings (check, subject, dates, codes) are escaped, so control,
 * newline and bidi characters cannot forge structure or reorder the text. The
 * wording is deterministic. It changed in 0.2.0; anything that matched the old
 * sentences needs to match the new ones or read the JSON instead.
 */
export function describeGrade(grade: DecisionGrade): string {
  const { checkKey, subjectId, verdict, status, decidedAt, baseline: b, result: r, thresholds } = grade
  const where = `${label(checkKey)} on ${label(subjectId)}`
  if (verdict === 'refused') return describeRefusal(grade, where)

  // "exposed" matters: `result` counts only exposed post-decision
  // observations, and calling that "since" would hide the unexposed ones.
  const window = `bad in ${text(b.bad)} of ${text(b.observations)} observations before and ${text(r.bad)} of ${text(r.observations)} exposed observations since`
  const head = `${verdict === 'holding' ? 'Holding' : 'Not holding'}: ${where} was ${window} the recommendation was ${text(status)} on ${text(decidedAt)}.`
  const count = `The exposed bad count (${text(r.bad)})`
  const refute = `the refute threshold (${text(thresholds.refuteThreshold)})`
  let reason: string
  if (verdict === 'holding') {
    reason = `${count} is below ${refute} and its rate is not higher than the baseline's.`
  } else if (r.bad >= thresholds.refuteThreshold) {
    reason = `${count} reached ${refute}.`
  } else {
    // Only the exact rate rule can be responsible here. Two rates can round to
    // the same 3-place display while the counts still differ.
    reason =
      `${count} is below ${refute}, but the exposed bad rate (${text(r.bad)} of ${text(r.observations)}) is higher than the baseline's (${text(b.bad)} of ${text(b.observations)}), compared as exact counts.` +
      (r.badRate !== null && r.badRate === b.badRate
        ? ` Both display as ${text(r.badRate)}; the exact counts decide, not the rounded display.`
        : '')
  }
  return `${head} ${reason} ${CAUSE_LIMIT}`
}
