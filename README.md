# advice-ledger-kit

A small, zero-dependency TypeScript library for checking a recommender
against what happened after people acted on its advice. It has two parts:

- **`gradeDecision`** grades one decision (a person adopted or dismissed a
  recommendation) against later observations of the same check on the same
  subject. It will not give a verdict unless the data clears explicit floors.
  Below a floor it returns `verdict: 'refused'` and a list of
  machine-readable refusal codes that say which floor failed.
- **`computeDivergence`** measures how often an engine and a human disagreed
  about the same items. Where a later outcome settles a disagreement, it
  reports "engine was right" and "human was right" as two separate counts and
  never blends them into one accuracy number.

The shapes are generic: a recommendation is `{ subjectId, checkKey }`, an
observation is `good` or `bad`, and judgments are strings from your own
vocabulary.

**Use it when** you log recommendations, the human call on each one, and
dated outcomes afterward, and you want a grade that refuses rather than
guesses when the log is thin.

**Do not use it when** you need a causal effect estimate (use a randomized
experiment), a significance test or confidence interval (this library has
none), probability calibration of a model's scores, or deduplication and
cleaning of your log (it counts exactly what you pass).

## Install

```bash
npm install advice-ledger-kit
```

Or build from source: clone the repository and run `npm install && npm run build`.
It has no runtime dependencies and ships TypeScript declarations.

It is an ESM package (`"type": "module"`). `import` is the supported way to
load it. `require()` also works where Node can `require(esm)`:

| How you load it | Node 20.19+ | Node 22.12+ | Node 24 and 26 | Older Node 20 or 22 |
| --- | --- | --- | --- | --- |
| `import { gradeDecision } from 'advice-ledger-kit'` | works | works | works | works |
| `require('advice-ledger-kit')` | works | works | works | fails (no `require(esm)`); use `import()` |

Recommended runtimes are Node 22 and 24 (LTS) and Node 26 (current). Node 20 is
end-of-life. CI still runs the tests on Node 20.19.0 and 22.12.0 (the
`require(esm)` floors) to catch regressions, but that is compatibility
testing, not a recommendation. `engines` in `package.json` is `>=20`.

## Quickstart

A maintenance system saw pump-14's seal leaking and recommended a weekly
re-torque. The technician adopted it on February 1. Each later inspection
records whether the re-torque was actually done that week (`exposed`).

```js
import { gradeDecision, describeGrade, computeDivergence, describeDivergence } from 'advice-ledger-kit'

const recommendation = { id: 'rec-88', subjectId: 'pump-14', checkKey: 'seal-leak', proposedAt: '2026-01-18' }
const decision = { recommendationId: 'rec-88', status: 'adopted', decidedAt: '2026-02-01' }
const row = (observedAt, state, exposed) => ({ subjectId: 'pump-14', checkKey: 'seal-leak', observedAt, state, exposed })

const log = [
  // Before the decision (exposure does not apply here)
  row('2026-01-04', 'bad'), row('2026-01-11', 'bad'), row('2026-01-18', 'good'),
  row('2026-01-25', 'bad'), row('2026-01-29', 'bad'), row('2026-01-31', 'good'),
  // After the decision
  row('2026-02-08', 'good', true), row('2026-02-15', 'good', true), row('2026-02-22', 'good', true),
  row('2026-03-01', 'bad', true),
  row('2026-03-08', 'bad', false), // the re-torque was not done that week
]

const grade = gradeDecision(decision, recommendation, log)
console.log(grade.verdict)      // 'holding'
console.log(grade.baseline)     // { observations: 6, bad: 4, good: 2, badRate: 0.667 }
console.log(grade.result)       // { observations: 4, bad: 1, good: 3, badRate: 0.25 }
console.log(grade.badRateDelta) // -0.417
console.log(grade.secondary.observations, grade.secondary.bad, grade.secondary.wouldBeVerdict)
// 5 2 'not-holding'
console.log(describeGrade(grade))
// Holding: seal-leak on pump-14 was bad in 4 of 6 observations before and
// 1 of 4 exposed observations since the recommendation was adopted on 2026-02-01.
// The exposed bad count (1) is below the refute threshold (2) and its rate is
// not higher than the baseline's. This is an association between two windows,
// not evidence that the recommendation caused the change.

// The same call on a two-row log refuses and says why.
const thin = gradeDecision(decision, recommendation, [row('2026-01-25', 'bad'), row('2026-02-08', 'good', true)])
console.log(thin.verdict, thin.refusalCodes)
// refused [ 'baseline_below_minimum', 'result_below_minimum', 'exposed_result_below_minimum' ]
console.log(describeGrade(thin))
// Not enough evidence to grade seal-leak on pump-14. Before the decision: 1
// observation, 3 required (not met). After the decision: 1 observation, 3
// required (not met). Confirmed exposed after the decision: 1 observation, 3
// required (not met). Only observations marked exposed: true count toward the
// headline result; unmarked ones are not assumed exposed. Next: check the
// supplied record and exposure flags, and include more valid observations if
// they exist; do not infer missing exposure. No conclusion about the decision
// is available from this record. Codes: baseline_below_minimum,
// result_below_minimum, exposed_result_below_minimum.

// Divergence: 20 items both judges rated, 5 disagreements, all later settled.
const pairs = [
  ...Array.from({ length: 15 }, () => ({ engineJudgment: 'keep', humanJudgment: 'keep' })),
  ...Array.from({ length: 3 }, () => ({ engineJudgment: 'remove', humanJudgment: 'keep', laterOutcome: 'remove' })),
  ...Array.from({ length: 2 }, () => ({ engineJudgment: 'remove', humanJudgment: 'keep', laterOutcome: 'keep' })),
]
console.log(describeDivergence(computeDivergence(pairs).overall))
// Overall: the human disagreed on 5 of 20 comparable pairs. Of the 5 with a
// later outcome, the engine was right 3, the human was right 2 and neither was
// right 0. No disagreement is still unresolved. These counts compare supplied
// judgments with supplied outcomes; they do not show causal benefit or general
// accuracy.
```

The text is on one line (wrapped here for reading). Every caller string in it
is escaped, and the full JSON carries the same numbers, so show either or
both.

Read the output closely. The verdict is `holding` even though the problem
recurred once: one bad exposed reading is below the default refute bar of 2.
The unexposed March 8 reading is not graded, and `secondary` shows that an
exposure-blind grader would have said `not-holding`.

## How `gradeDecision` works

1. **Structural checks first.** If `decision.recommendationId` does not equal
   `recommendation.id`, the `checkKey` shows nothing (empty, whitespace, or
   only invisible characters such as a zero-width space), or
   `requireObservedBasis` is on and the basis is `'model-proposed'`, the grade
   is refused with only those codes. Nothing else is read, and the windows in
   the result are all-zero placeholders, not measurements.
2. **Matching.** Only observations whose `subjectId` and `checkKey` exactly
   equal the recommendation's are graded, and only those are validated field
   by field. You can pass your whole log, but every row must be a plain
   object (see "Input rules").
3. **Windows.** Timestamps are parsed and compared as instants. Observations
   before `decidedAt` form the **baseline**. Observations after `decidedAt`
   form the post-decision window, and those with `exposed === true` form the
   **result** (the headline). `exposed: false` and a missing flag both count
   as not exposed. Observations at the same instant as `decidedAt`, however
   the two are written, grade neither window and are counted in
   `atBoundaryObservations`.
4. **Floors.** Each failing floor adds a code, and all failing floors are
   listed together.
5. **Verdict.** If no floor fails: `not-holding` when EITHER the result has
   at least `refuteThreshold` bad observations OR its bad rate is higher than
   the baseline's, otherwise `holding`.

The rate check is exact: it compares the raw counts by cross-multiplication
(`result.bad * baseline.observations` against
`baseline.bad * result.observations`), never the rounded `badRate` fields or
the sign of `badRateDelta`. That matters right at a rounding boundary: 81 bad
of 650 before (0.1246...) and 1 bad of 8 exposed since (0.125 exactly) both
display as `badRate: 0.125`, so `badRateDelta` shows `0`, and yet the exposed
rate is a hair higher than the baseline's, so the verdict is `not-holding`.
Show `badRateDelta` and the raw counts next to the verdict; do not re-derive
the verdict from `badRateDelta`'s sign.

The verdict grades the decision and reads the same either way the human
called it:

| Decision | Exposed bad count and rate after | Verdict |
| --- | --- | --- |
| adopted | count below `refuteThreshold` AND rate not above baseline | `holding` |
| adopted | count at/above `refuteThreshold` OR rate above baseline | `not-holding` |
| dismissed | count below `refuteThreshold` AND rate not above baseline | `holding` (the pass looks fine) |
| dismissed | count at/above `refuteThreshold` OR rate above baseline | `not-holding` (the evidence sided with the advice) |

For a dismissed recommendation, set `exposed: true` on occasions where the
advice would have applied had it been adopted.

### Input rules

Timestamps (`decidedAt`, and `observedAt` on a matching observation) must be
one of:

- a calendar date, `2026-02-01`, read as UTC midnight;
- a timestamp with seconds and an explicit zone: `2026-02-01T09:30:00Z`,
  `2026-02-01T10:30:00+01:00`, at most three fractional digits.

Anything else is a caller error, not a thin log: a non-empty string that does
not fit (`2026-02-01T09:30:00` with no zone, `2026-02-01T09:30Z` with no
seconds, `2026-99-99`, `2025-02-29`) throws a `RangeError`, and an empty or
non-string value throws a `TypeError`. Nothing is guessed, so a missing zone is
never read as local or UTC time. Two strings for the same moment are the same
moment: with a decision at `2026-02-01T00:00:00.000Z`, observations at
`2026-02-01T00:00:00Z`, `2026-02-01T00:00:00+00:00`,
`2026-02-01T01:00:00+01:00` and `2026-02-01` all land on the boundary, and
`2026-02-01T00:30:00+01:00` is half an hour before `2026-02-01T00:00:00Z`.
The strings you pass are echoed back unchanged (`decidedAt` in the grade).

```js
// Uses `recommendation`, `decision` and `row` from the quickstart.
const at = (observedAt) =>
  gradeDecision({ ...decision, decidedAt: '2026-02-01T00:00:00.000Z' }, recommendation, [row(observedAt, 'bad', true)])

console.log(at('2026-02-01T00:00:00Z').atBoundaryObservations)      // 1: same instant, different text
console.log(at('2026-02-01T01:00:00+01:00').atBoundaryObservations) // 1
console.log(at('2026-02-01T00:30:00+01:00').baseline.observations)  // 1: that is 23:30Z the day before
try { at('2026-99-99') } catch (e) { console.log(e.name) }         // RangeError: fix the input, this is not a refusal
```

Other input rules, all `TypeError`s:

- Rows and configs must be plain objects (or null-prototype objects). A `Map`,
  `Date`, array, or class instance is rejected instead of being read as empty
  or as "use the defaults". `observations` and `pairs` must be arrays with no
  holes. Each field of each row is read once, and the result comes from that
  single read.
- `recommendation.id`, `recommendation.subjectId` and
  `decision.recommendationId` must be strings that show something. A blank id
  cannot match another blank id.
- `groupBy`, when given, must be a function that returns a string, `null` or
  `undefined`. A promise is not awaited; it is rejected.

Repeated rows are counted as supplied; deduplicate before calling (see Honest
limits).

### Refusal codes

| Code | Kind | Fires when |
| --- | --- | --- |
| `baseline_below_minimum` | floor | baseline observations < `minBaselineObservations` (default 3) |
| `baseline_lacks_negative_signal` | floor | baseline bad observations < `minBaselineBadObservations` (default 1). With a full baseline this means the problem was not happening before, so its absence afterward says nothing. An empty baseline triggers it too. |
| `result_below_minimum` | floor | post-decision observations, exposed or not, < `minResultObservations` (default 3) |
| `exposed_result_below_minimum` | floor | exposed post-decision observations < `minExposedResultObservations` (default 3) |
| `no_gradeable_check_key` | structural | `checkKey` is missing, not a string, or shows nothing (empty, whitespace, zero-width or bidi control characters only) |
| `basis_not_gradeable` | structural | `requireObservedBasis` is true and `basis` is `'model-proposed'` |
| `decision_recommendation_mismatch` | structural | `decision.recommendationId !== recommendation.id` |

Structural codes short-circuit: when any is present, floor codes are not
computed. Floor codes accumulate.

### Exposure alignment

Only exposed observations can create or reverse the headline verdict. Here
is the failure that prevents. After adoption there are five inspections:
three with the re-torque done, all clean, and two while the pump was pulled
for unrelated work, both leaking.

```js
const pulled = gradeDecision(decision, recommendation, [
  row('2026-01-04', 'bad'), row('2026-01-11', 'bad'), row('2026-01-18', 'good'), row('2026-01-25', 'bad'),
  row('2026-02-08', 'good', true), row('2026-02-15', 'good', true), row('2026-02-22', 'good', true),
  row('2026-03-01', 'bad', false), row('2026-03-08', 'bad', false),
])
console.log(pulled.verdict)                  // 'holding'
console.log(pulled.result)                   // { observations: 3, bad: 0, good: 3, badRate: 0 }
console.log(pulled.secondary.wouldBeVerdict) // 'not-holding'
```

An exposure-blind grader would blame the advice for two readings taken while
it could not apply. That reading is still returned in `secondary`, labeled
`'secondary-not-the-headline'`, so the gap is visible. Its `wouldBeVerdict`
applies the same floors to all post-decision observations, and is
`'refused'` when that grade would also refuse.

If your domain has no exposure concept, set `exposed: true` on every
post-decision observation. Leaving the flag off everywhere makes every grade
that passes the structural checks refuse with `exposed_result_below_minimum`,
on purpose.

### Why `refuteThreshold` cannot be below `proposeThreshold`

`proposeThreshold` is how many bad observations it took to justify the
recommendation (default 2; the library does not check that the proposal met
it). `refuteThreshold` is how many bad exposed observations overturn the
decision. It defaults to `proposeThreshold`, may be raised, and setting it
lower throws a `RangeError`. A grader that needs two readings to suggest
something and one to condemn it is biased toward "not holding".

Symmetry does not bound the window. The post-decision window is every
observation you pass, so over a long enough period any nonzero recurrence
reaches any fixed count. If that matters, pass a bounded window (for
example, the first N weeks after the decision).

## How `computeDivergence` works

A pair is **comparable** when both `engineJudgment` and `humanJudgment` are
non-empty strings. Pairs missing a judgment are counted in `totalPairs` but
are not agreements. A comparable pair **diverges** when the two strings
differ (exact comparison, case and whitespace included).

Divergence is `reportable` only when all three floors pass:

- `minComparablePairs` (default 10): three disagreements out of three pairs
  is a 100% rate and still noise.
- `minDivergentCount` (default 3): one odd call is not a pattern.
- `minDivergentRate` (default 0.05): three disagreements out of a thousand
  is not either. This floor is checked against the exact ratio;
  `divergentRate` is rounded to 3 places for display, so 5 of 101 shows as
  0.05 and is still refused at a 0.05 floor.

Counts and rates are always returned. The floors gate `status`.

**Calibration.** For divergent pairs with a non-empty `laterOutcome`,
`engineRight`, `humanRight` and `neitherRight` partition the resolved pairs
exactly (the two judgments differ, so at most one can match). There is no
blended accuracy field. Calibration has its own floor,
`minResolvedDivergent` (default 3), and its own `status`, which is
independent of the report's status: a report can be refused on the rate
floor while its calibration is reportable. `describeDivergence` leaves
calibration counts out of the text for a refused report.

**Groups.** Pairs are bucketed by `group`, or by your `groupBy(pair)`, which
receives a shallow copy of the pair (with any extra fields you put on it).
`examples` are those copies, not your own objects. Return
`null` or `undefined` to leave a pair out of the breakdown (it still counts
in `overall`); any other non-string return throws a `TypeError`. Groups are
sorted by key (plain `Array.prototype.sort`, not locale-aware) and each gets
every floor independently.

```js
const times = (n, pair) => Array.from({ length: n }, () => pair)
const queue = [
  ...times(34, { engineJudgment: 'remove', humanJudgment: 'remove', group: 'images' }),
  ...times(4, { engineJudgment: 'remove', humanJudgment: 'keep', laterOutcome: 'remove', group: 'images' }),
  ...times(2, { engineJudgment: 'remove', humanJudgment: 'keep', laterOutcome: 'keep', group: 'images' }),
  ...times(28, { engineJudgment: 'keep', humanJudgment: 'keep', group: 'text' }),
  ...times(1, { engineJudgment: 'remove', humanJudgment: 'keep', laterOutcome: 'keep', group: 'text' }),
  ...times(1, { engineJudgment: 'keep', humanJudgment: 'remove', laterOutcome: 'remove', group: 'text' }),
]
const { overall, groups } = computeDivergence(queue)
console.log(describeDivergence(overall))
// Overall: the human disagreed on 8 of 70 comparable pairs. Of the 8 with a
// later outcome, the engine was right 4, the human was right 4 and neither was
// right 0. No disagreement is still unresolved. These counts compare supplied
// judgments with supplied outcomes; they do not show causal benefit or general
// accuracy.
console.log(describeDivergence(groups[0]))
// Group images: the human disagreed on 6 of 40 comparable pairs. Of the 6 with
// a later outcome, the engine was right 4, the human was right 2 and neither
// was right 0. No disagreement is still unresolved. These counts compare ...
console.log(describeDivergence(groups[1]))
// Group text: refused to report divergence (divergent_count_below_minimum); 2
// of 30 comparable pairs diverged. Short on: disagreements (2). No conclusion
// about the engine or the human is available from these pairs.
```

Overall the engine and the human tie at 4 each. By group, the images queue
favors the engine 4 to 2, and the text queue has too few disagreements to
report.

## API reference

All functions are pure: they never modify their inputs, and results do not
depend on input order (except `examples`, which keep input order).

### `gradeDecision(decision, recommendation, observations, config?) => DecisionGrade`

Grades one decision as described above. Returns `verdict`, `refusalCodes`,
the `baseline`, `result` and `secondary` windows (`observations`, `bad`,
`good`, `badRate` rounded to 3 places with exact halves up, `null` when
empty), `badRateDelta` (`result.badRate - baseline.badRate` from the rounded
rates, `null` when either window is empty — display only, not what the
verdict's rate check compares), `atBoundaryObservations`, the echoed
`thresholds`, and constant `method` and
`interpretation: 'association_not_causation'` labels.

Throws `RangeError`/`TypeError` from `resolveGradeConfig`. Throws `RangeError`
when `decidedAt`, or `observedAt` on a matching observation, is a non-empty
string that is not a valid date or timestamp (see "Input rules"). Throws
`TypeError` when the decision, recommendation, or a row is not a plain object,
`observations` is not a dense array, `recommendation.id`,
`recommendation.subjectId` or `decision.recommendationId` is not a string or
is blank, `basis` is not `'observed'` or `'model-proposed'`, `status` is not
`'adopted'` or `'dismissed'`, `decidedAt` is empty or not a string, or a
matching observation has a `state` other than `'good'`/`'bad'` or an empty or
non-string `observedAt`. Error messages describe caller values without ever
calling into them, cut at 80 characters, and escape control characters.

### `describeGrade(grade) => string`

One line of plain text: result, evidence, reason, next step, limits.

- A verdict reads "Holding: ... was bad in B of N observations before and b of
  n exposed observations since the recommendation was adopted on ...", says
  which rule decided (the count reaching `refuteThreshold`, or the exact rate
  being higher than the baseline's, with a note when both rates display the
  same), and ends with the association-not-causation note.
- Thin evidence reads "Not enough evidence to grade ...", then before, after
  and confirmed-exposed-after counts against the required counts (plus the
  bad-before count when that floor failed), why it matters, what to check, and
  the codes. It never suggests lowering a floor.
- A structural refusal reads "Cannot grade ..." and explains the invalid
  input. Its zero windows are placeholders and are not printed as counts.

Caller strings are escaped. The JSON is unchanged and remains the source of
truth.

### `resolveGradeConfig(config?) => ResolvedGradeConfig`

Fills defaults (`null` counts as omitted) and returns a new object. Throws
`RangeError` when `refuteThreshold < proposeThreshold`,
`minBaselineBadObservations` is not an integer >= 0, or any other count is
not an integer >= 1; throws `TypeError` when `requireObservedBasis` is not a
boolean.

### `DEFAULT_GRADE_CONFIG`

Frozen: `minBaselineObservations: 3`, `minResultObservations: 3`,
`minExposedResultObservations: 3`, `minBaselineBadObservations: 1`,
`proposeThreshold: 2`, `refuteThreshold: 2`, `requireObservedBasis: false`.

### `computeDivergence(pairs, config?) => DivergenceResult`

Returns `{ overall, groups, thresholds }`. Each report has `group`,
`totalPairs`, `comparablePairs`, `agreements`, `divergentCount`,
`divergentRate`, `status`, `refusalCodes`, `calibration`, `examples` (the
first `exampleLimit` divergent pairs, as shallow copies), and
`interpretation: 'disagreement_is_a_signal_not_a_verdict'`. Pairs are not
deduplicated, even when they share an `id`. Throws `RangeError` from
`resolveDivergenceConfig` and `TypeError` for a bad `groupBy` return.

### `describeDivergence(report, thresholds?) => string`

One line for a report. Refused: the codes and raw counts, what it is short
on, and no conclusion. Reportable: the disagreement count, then either why
calibration is withheld (with how many disagreements have an outcome) or the
engine-right, human-right and neither-right counts (they add up to the
resolved disagreements) and how many are still unresolved, plus a note that the
counts compare supplied judgments with supplied outcomes. Pass the result's
`thresholds` as the second argument to add the required numbers. The group
name is escaped.

### `resolveDivergenceConfig(config?) => ResolvedDivergenceConfig`

Fills defaults and returns a new object without `groupBy`. Throws
`RangeError` when `minDivergentRate` is not a finite number in [0, 1],
`exampleLimit` is not an integer >= 0, or another count is not an integer
>= 1.

### `DEFAULT_DIVERGENCE_CONFIG`

Frozen: `minComparablePairs: 10`, `minDivergentCount: 3`,
`minDivergentRate: 0.05`, `minResolvedDivergent: 3`, `exampleLimit: 10`.

### Types

`Recommendation`, `RecommendationBasis`, `Decision`, `DecisionStatus`,
`Observation`, `ObservationState`, `DecisionVerdict`, `GradeRefusalCode`,
`GradeConfig`, `ResolvedGradeConfig`, `WindowReading`, `SecondaryReading`,
`DecisionGrade`, `JudgmentPair`, `DivergenceRefusalCode`,
`DivergenceConfig`, `ResolvedDivergenceConfig`, `CalibrationReading`,
`DivergenceReport`, `DivergenceResult`. Each field is documented in the
shipped `.d.ts` files.

## Honest limits

- **Association, not causation.** A `holding` verdict means the floors were
  met and exposed recurrences stayed under the refute bar. It does not show
  the advice caused anything. Seasonality, other changes, regression to the
  mean, and extra attention to the subject are all possible explanations.
- **No statistics beyond counts.** The floors are minimum counts, not
  significance tests. Clearing them means "enough to look at", not "proven".
- **The rate check only compares two windows, not a trend.** `holding`
  requires the exposed bad rate not to exceed the baseline's, but that is one
  before/after comparison, not a slope or a significance test. A rate that
  crept up gradually across a long post-decision window and a rate that
  spiked on day one look the same to this check.
- **The window is whatever you pass.** There is no time limit on the
  post-decision window, so a long window will eventually reach any count.
- **It will often refuse.** With the default floors, a decision needs at
  least 3 observations before and 3 exposed observations after, so a young
  ledger often comes back refused. That is the intended behavior. Setting every
  floor to 1 turns this back into the naive grader it guards against; lower
  floors only for a reason you can state about your observation rate.
- **Baselines can mislead.** The baseline is everything before the decision.
  If that period was unusual, nothing here detects it.
- **`exposed` is trusted.** If exposure is logged more reliably on good
  occasions, that bias goes straight into the headline.
- **Timestamps are yours to get right.** The library parses instants strictly
  and throws on anything outside the grammar above, but it cannot know that a
  bare `2026-02-01` you meant as local midnight is UTC midnight here, or that
  a timestamp exported without its zone was really in local time. Convert
  those at the boundary. Timestamps with more than three fractional digits
  (for example microseconds) are rejected, so truncate them first.
  `proposedAt` is not read.
- **No deduplication.** Repeated observation rows and repeated pairs are
  counted each time. Deduplicate before calling if repeats are errors.
- **Exact string matching.** `subjectId`, `checkKey` and judgments are
  compared exactly. A whitespace-only judgment counts as a judgment.
- **Disagreement is a place to look.** Divergence says one judge is wrong,
  not which one; that needs `laterOutcome`, and `calibration` refuses until
  enough outcomes exist.

## Prior art

This library does not claim the idea is new. Closely related work:

- **Forecast Value Added** (demand planning). Michael Gilliland defined FVA
  in 2002 as the change in a forecast accuracy metric attributable to a step
  or participant in the forecasting process, starting from a naive forecast;
  manual overrides are one of the steps it measures
  ([Petropoulos et al., "Forecasting: theory and practice", section by Gilliland](https://arxiv.org/abs/2012.03854);
  [SAS white paper](https://www.sas.com/en/whitepapers/forecast-value-added-analysis-106186.html)).
  Gilliland's own guidance warns that over short periods FVA can be high or
  low by chance, as quoted in a
  [2024 Foresight critique of FVA](https://www.lokad.com/pdf/doherty-critical-evaluation-forecast-value-added-2024.pdf).
  `gradeDecision` is closest to this.
- **Override-appropriateness review** in clinical decision support. A 2020
  systematic review of 23 studies
  ([Poly et al., JMIR Medical Informatics](https://pmc.ncbi.nlm.nih.gov/articles/PMC7400042/))
  covers how often prescribing alerts are overridden and whether the
  overrides were appropriate, which the included studies mostly judged with
  clinician raters (pharmacists, physicians) against published guidance.
  `computeDivergence` is closest to this.
- **Netflix RecSysOps.** Netflix's 2022 write-up on operating its
  recommender
  ([Saberian and Basilico, Netflix Technology Blog](https://netflixtechblog.medium.com/recsysops-best-practices-for-operating-a-large-scale-recommender-system-95bbe195a841))
  treats a member choosing an item the model did not rank highly as a
  potential issue to monitor. That is a similar idea to counting
  engine-versus-human disagreement.

## Related

[honesty-mcp](https://github.com/lkopietz3-byte/honesty-mcp) exposes this
kit to MCP clients as two tools, `grade_decision` (wraps `gradeDecision`)
and `compute_divergence` (wraps `computeDivergence`).

## License

MIT © Lucas Kopietz
