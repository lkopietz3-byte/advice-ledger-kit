// Consumer probe: run by scripts/verify-package.mjs from a clean project that
// installed the packed tarball. Imports the package by name, the way a user
// would, and checks real outputs of every export.
import assert from 'node:assert/strict';
import {
  DEFAULT_DIVERGENCE_CONFIG,
  DEFAULT_GRADE_CONFIG,
  computeDivergence,
  describeDivergence,
  describeGrade,
  gradeDecision,
  resolveDivergenceConfig,
  resolveGradeConfig,
} from 'advice-ledger-kit';

// --- gradeDecision: the README quickstart ----------------------------------
const recommendation = { id: 'rec-88', subjectId: 'pump-14', checkKey: 'seal-leak', proposedAt: '2026-01-18' };
const decision = { recommendationId: 'rec-88', status: 'adopted', decidedAt: '2026-02-01' };
const row = (observedAt, state, exposed) => ({
  subjectId: 'pump-14', checkKey: 'seal-leak', state, observedAt, ...(exposed === undefined ? {} : { exposed }),
});
const log = [
  row('2026-01-04', 'bad'), row('2026-01-11', 'bad'), row('2026-01-18', 'good'),
  row('2026-01-25', 'bad'), row('2026-01-29', 'bad'), row('2026-01-31', 'good'),
  row('2026-02-08', 'good', true), row('2026-02-15', 'good', true), row('2026-02-22', 'good', true),
  row('2026-03-01', 'bad', true), row('2026-03-08', 'bad', false),
];

const grade = gradeDecision(decision, recommendation, log);
assert.equal(grade.verdict, 'holding');
assert.deepEqual(grade.refusalCodes, []);
assert.deepEqual(grade.baseline, { observations: 6, bad: 4, good: 2, badRate: 0.667 });
assert.deepEqual(grade.result, { observations: 4, bad: 1, good: 3, badRate: 0.25 });
assert.equal(grade.badRateDelta, -0.417);
assert.equal(grade.secondary.observations, 5);
assert.equal(grade.secondary.wouldBeVerdict, 'not-holding');
assert.equal(
  describeGrade(grade),
  'Holding: seal-leak on pump-14 was bad in 4 of 6 observations before and 1 of 4 exposed observations since the recommendation was adopted on 2026-02-01. ' +
    "The exposed bad count (1) is below the refute threshold (2) and its rate is not higher than the baseline's. " +
    'This is an association between two windows, not evidence that the recommendation caused the change.',
);

// A thin log is refused with every unmet floor named.
const thin = gradeDecision(decision, recommendation, [row('2026-01-25', 'bad'), row('2026-02-08', 'good', true)]);
assert.equal(thin.verdict, 'refused');
assert.deepEqual(thin.refusalCodes, ['baseline_below_minimum', 'result_below_minimum', 'exposed_result_below_minimum']);
assert.equal(thin.secondary.wouldBeVerdict, 'refused');
// The sentence carries the actual and required counts, not only the codes.
assert.equal(
  describeGrade(thin),
  'Not enough evidence to grade seal-leak on pump-14. ' +
    'Before the decision: 1 observation, 3 required (not met). ' +
    'After the decision: 1 observation, 3 required (not met). ' +
    'Confirmed exposed after the decision: 1 observation, 3 required (not met). ' +
    'Only observations marked exposed: true count toward the headline result; unmarked ones are not assumed exposed. ' +
    'Next: check the supplied record and exposure flags, and include more valid observations if they exist; do not infer missing exposure. ' +
    'No conclusion about the decision is available from this record. ' +
    'Codes: baseline_below_minimum, result_below_minimum, exposed_result_below_minimum.',
);

// Timestamps compare as instants: 00:30+01:00 is the day before 00:00Z, and an
// impossible date throws instead of grading.
const mixed = gradeDecision(
  { ...decision, decidedAt: '2026-02-01T00:00:00Z' },
  recommendation,
  [row('2026-02-01T00:30:00+01:00', 'bad'), row('2026-02-01T00:00:00.000Z', 'bad', true)],
);
assert.equal(mixed.baseline.observations, 1);
assert.equal(mixed.atBoundaryObservations, 1);
assert.throws(() => gradeDecision(decision, recommendation, [row('2026-99-99', 'bad')]), RangeError);

// Refuting more cheaply than proposing throws.
assert.throws(() => resolveGradeConfig({ proposeThreshold: 3, refuteThreshold: 2 }), RangeError);
assert.equal(resolveGradeConfig({ proposeThreshold: 4 }).refuteThreshold, 4);
assert.equal(DEFAULT_GRADE_CONFIG.refuteThreshold, DEFAULT_GRADE_CONFIG.proposeThreshold);
assert.ok(Object.isFrozen(DEFAULT_GRADE_CONFIG));

// Bad rows throw instead of being miscounted.
assert.throws(() => gradeDecision(decision, recommendation, [row('2026-02-08', 'BAD', true)]), TypeError);

// --- computeDivergence: the README moderation example ----------------------
const times = (n, pair) => Array.from({ length: n }, () => pair);
const queue = [
  ...times(34, { engineJudgment: 'remove', humanJudgment: 'remove', group: 'images' }),
  ...times(4, { engineJudgment: 'remove', humanJudgment: 'keep', laterOutcome: 'remove', group: 'images' }),
  ...times(2, { engineJudgment: 'remove', humanJudgment: 'keep', laterOutcome: 'keep', group: 'images' }),
  ...times(28, { engineJudgment: 'keep', humanJudgment: 'keep', group: 'text' }),
  ...times(1, { engineJudgment: 'remove', humanJudgment: 'keep', laterOutcome: 'keep', group: 'text' }),
  ...times(1, { engineJudgment: 'keep', humanJudgment: 'remove', laterOutcome: 'remove', group: 'text' }),
];
const { overall, groups, thresholds } = computeDivergence(queue);
assert.equal(overall.comparablePairs, 70);
assert.equal(overall.divergentCount, 8);
assert.equal(overall.divergentRate, 0.114);
assert.equal(overall.status, 'reportable');
assert.equal(overall.calibration.engineRight, 4);
assert.equal(overall.calibration.humanRight, 4);
assert.deepEqual(groups.map((g) => [g.group, g.status]), [['images', 'reportable'], ['text', 'refused']]);
assert.deepEqual(groups[1].refusalCodes, ['divergent_count_below_minimum']);
assert.deepEqual(thresholds, resolveDivergenceConfig());
assert.deepEqual(resolveDivergenceConfig(), { ...DEFAULT_DIVERGENCE_CONFIG });
assert.equal(
  describeDivergence(groups[0]),
  'Group images: the human disagreed on 6 of 40 comparable pairs. ' +
    'Of the 6 with a later outcome, the engine was right 4, the human was right 2 and neither was right 0. ' +
    'No disagreement is still unresolved. ' +
    'These counts compare supplied judgments with supplied outcomes; they do not show causal benefit or general accuracy.',
);

// The rate floor uses the exact ratio: 5 of 101 displays as 0.05 but is refused.
const edge = computeDivergence([
  ...times(96, { engineJudgment: 'a', humanJudgment: 'a' }),
  ...times(5, { engineJudgment: 'a', humanJudgment: 'b' }),
]).overall;
assert.equal(edge.divergentRate, 0.05);
assert.deepEqual(edge.refusalCodes, ['divergent_rate_below_minimum']);

console.log('consumer probe: ok');
