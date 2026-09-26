// grade.ts — grade one decision against what actually happened afterwards.
//
// The whole module is one function plus its config resolution. The care is in
// what it refuses to say:
//
//   - It requires a BASELINE from before the decision with enough
//     observations and at least one bad one. "No problems since you adopted
//     this" is only worth grading when there were problems to begin with.
//     The verdict itself counts bad exposed observations after the decision;
//     the before/after rate change is reported in `badRateDelta`.
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
  Recommendation,
  RecommendationBasis,
  ResolvedGradeConfig,
  SecondaryReading,
  WindowReading,
} from './types.js'
import { difference3, rate, requireCount, shown, typeFail } from './internal.js'

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

function readWindow(observations: readonly Observation[]): WindowReading {
  const bad = observations.filter((o) => o.state === 'bad').length
  return {
    observations: observations.length,
    bad,
    good: observations.length - bad,
    badRate: rate(bad, observations.length),
  }
}

const emptyWindow = (): WindowReading => ({ observations: 0, bad: 0, good: 0, badRate: null })

/**
 * Fill in defaults and reject a config that is asymmetric in the wrong
 * direction.
 *
 * `refuteThreshold` defaults to `proposeThreshold`, so the out-of-the-box
 * behavior is symmetric. A caller may raise it (harder to overturn a
 * decision) but never lower it: needing less evidence to condemn advice than
 * it took to offer it biases the grade toward "not holding".
 *
 * `null` and `undefined` fields fall back to the defaults. Returns a new
 * object; the input is not modified.
 *
 * @throws RangeError when `refuteThreshold < proposeThreshold`, when
 *   `minBaselineBadObservations` is not an integer >= 0, or when any other
 *   count is not an integer >= 1 (NaN and Infinity included).
 * @throws TypeError when `requireObservedBasis` is present and not a boolean.
 */
export function resolveGradeConfig(config: GradeConfig = {}): ResolvedGradeConfig {
  const d = DEFAULT_GRADE_CONFIG
  const proposeThreshold = requireCount(
    'proposeThreshold',
    config.proposeThreshold ?? d.proposeThreshold,
    1,
  )
  const refuteThreshold = requireCount(
    'refuteThreshold',
    config.refuteThreshold ?? proposeThreshold,
    1,
  )
  if (refuteThreshold < proposeThreshold) {
    throw new RangeError(
      `advice-ledger-kit: refuteThreshold (${refuteThreshold}) is below proposeThreshold (${proposeThreshold}). ` +
        'Overturning a decision must never take less evidence than making the recommendation took. ' +
        'Raise refuteThreshold to at least proposeThreshold, or lower proposeThreshold to match what the proposal really required.',
    )
  }
  const requireObservedBasis = config.requireObservedBasis ?? d.requireObservedBasis
  if (typeof requireObservedBasis !== 'boolean') {
    typeFail(`requireObservedBasis must be a boolean, received ${shown(requireObservedBasis)}`)
  }
  return {
    minBaselineObservations: requireCount(
      'minBaselineObservations',
      config.minBaselineObservations ?? d.minBaselineObservations,
      1,
    ),
    minResultObservations: requireCount(
      'minResultObservations',
      config.minResultObservations ?? d.minResultObservations,
      1,
    ),
    minExposedResultObservations: requireCount(
      'minExposedResultObservations',
      config.minExposedResultObservations ?? d.minExposedResultObservations,
      1,
    ),
    minBaselineBadObservations: requireCount(
      'minBaselineBadObservations',
      config.minBaselineBadObservations ?? d.minBaselineBadObservations,
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

// TypeScript callers cannot get these wrong, but JavaScript and JSON callers
// can, and each one used to fail silently: an unknown `state` counted as
// 'good', a missing date landed in `atBoundaryObservations` or emptied the
// baseline, and a misspelled `basis` slipped past `requireObservedBasis`.
function validateLedgerRows(decision: Decision, recommendation: Recommendation): void {
  if (typeof recommendation.id !== 'string') {
    typeFail(`recommendation.id must be a string, received ${shown(recommendation.id)}`)
  }
  if (typeof recommendation.subjectId !== 'string') {
    typeFail(`recommendation.subjectId must be a string, received ${shown(recommendation.subjectId)}`)
  }
  if (recommendation.basis !== undefined && !BASES.includes(recommendation.basis)) {
    typeFail(
      `recommendation.basis must be 'observed' or 'model-proposed' when present, received ${shown(recommendation.basis)}`,
    )
  }
  if (typeof decision.recommendationId !== 'string') {
    typeFail(`decision.recommendationId must be a string, received ${shown(decision.recommendationId)}`)
  }
  if (!STATUSES.includes(decision.status)) {
    typeFail(`decision.status must be 'adopted' or 'dismissed', received ${shown(decision.status)}`)
  }
  if (typeof decision.decidedAt !== 'string' || decision.decidedAt.length === 0) {
    typeFail(`decision.decidedAt must be a non-empty string, received ${shown(decision.decidedAt)}`)
  }
}

function validateObservation(o: Observation, index: number): void {
  if (!STATES.includes(o.state)) {
    typeFail(`observations[${index}].state must be 'good' or 'bad', received ${shown(o.state)}`)
  }
  if (typeof o.observedAt !== 'string' || o.observedAt.length === 0) {
    typeFail(`observations[${index}].observedAt must be a non-empty string, received ${shown(o.observedAt)}`)
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
 * the exposed post-decision window. It is a count, not a rate: 'holding' does
 * not mean the bad rate went down (see `badRateDelta`), and because the
 * post-decision window is every observation you pass, a long enough window
 * with any recurrence rate will eventually reach the bar. Pass a bounded
 * window if that matters. Anything short of every floor being met returns
 * 'refused' with the specific codes attached, and no verdict at all.
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
  validateLedgerRows(decision, recommendation)
  const basis: RecommendationBasis = recommendation.basis ?? 'observed'

  const base = {
    recommendationId: recommendation.id,
    subjectId: recommendation.subjectId,
    // Keep the result's declared `string` type true for JavaScript callers
    // that omit checkKey; that case is refused with no_gradeable_check_key.
    checkKey: typeof recommendation.checkKey === 'string' ? recommendation.checkKey : '',
    status: decision.status,
    basis,
    decidedAt: decision.decidedAt,
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
  if (decision.recommendationId !== recommendation.id) {
    structural.push('decision_recommendation_mismatch')
  }
  // A missing or non-string checkKey names no check either.
  const checkKey: unknown = recommendation.checkKey
  if (typeof checkKey !== 'string' || checkKey.trim().length === 0) {
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

  const relevant: Observation[] = []
  observations.forEach((o, index) => {
    if (o.subjectId === recommendation.subjectId && o.checkKey === recommendation.checkKey) {
      validateObservation(o, index)
      relevant.push(o)
    }
  })
  const before = relevant.filter((o) => o.observedAt < decision.decidedAt)
  const after = relevant.filter((o) => o.observedAt > decision.decidedAt)
  // An observation stamped exactly at the decision is ambiguous: part of that
  // moment is before the advice was in force and part is after. It is counted
  // and reported, and it grades nothing.
  const atBoundaryObservations = relevant.length - before.length - after.length

  // Exposure alignment. `exposed === true` and nothing else: an unanswered
  // exposure question is not a confirmed exposure. Baseline observations are
  // NOT filtered this way, because before the decision there was no advice for
  // anything to be exposed to.
  const exposedAfter = after.filter((o) => o.exposed === true)

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
    unalignedRefused
      ? 'refused'
      : unaligned.bad >= thresholds.refuteThreshold
        ? 'not-holding'
        : 'holding',
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
    verdict: result.bad >= thresholds.refuteThreshold ? 'not-holding' : 'holding',
    refusalCodes: [],
    baseline,
    result,
    badRateDelta,
    secondary,
    atBoundaryObservations,
  }
}

/**
 * Render a grade as one plain sentence.
 *
 * A verdict reads "Holding: <check> on <subject> was bad in B of N
 * observations before and b of n exposed observations since the
 * recommendation was <status> on <decidedAt>." A refusal reads "Refused to
 * grade <check> on <subject>: <codes>." with the codes verbatim. Makes no
 * causal claim.
 */
export function describeGrade(grade: DecisionGrade): string {
  const where = `${grade.checkKey} on ${grade.subjectId}`
  if (grade.verdict === 'refused') {
    return `Refused to grade ${where}: ${grade.refusalCodes.join(', ')}.`
  }
  const b = grade.baseline
  const r = grade.result
  // "exposed" matters: `result` counts only exposed post-decision
  // observations, and calling that "since" would hide the unexposed ones.
  const window = `bad in ${b.bad} of ${b.observations} observations before and ${r.bad} of ${r.observations} exposed observations since`
  const label = grade.verdict === 'holding' ? 'Holding' : 'Not holding'
  return `${label}: ${where} was ${window} the recommendation was ${grade.status} on ${grade.decidedAt}.`
}
