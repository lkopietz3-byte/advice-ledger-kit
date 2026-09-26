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

Not published to npm yet. Until then, install from GitHub (the repository
needs to be readable by you):

```bash
npm install github:lkopietz3-byte/advice-ledger-kit
```

The package builds itself on install through its `prepare` script. Recent
npm versions may warn that `prepare` is not covered by `allowScripts`; with
npm 11.16 the build still ran. It is ESM only, has no runtime dependencies,
ships TypeScript declarations, and needs Node 20 or later.

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

// The same call on a two-row log refuses and says why.
const thin = gradeDecision(decision, recommendation, [row('2026-01-25', 'bad'), row('2026-02-08', 'good', true)])
console.log(thin.verdict, thin.refusalCodes)
// refused [ 'baseline_below_minimum', 'result_below_minimum', 'exposed_result_below_minimum' ]

// Divergence: 20 items both judges rated, 5 disagreements, all later settled.
const pairs = [
  ...Array.from({ length: 15 }, () => ({ engineJudgment: 'keep', humanJudgment: 'keep' })),
  ...Array.from({ length: 3 }, () => ({ engineJudgment: 'remove', humanJudgment: 'keep', laterOutcome: 'remove' })),
  ...Array.from({ length: 2 }, () => ({ engineJudgment: 'remove', humanJudgment: 'keep', laterOutcome: 'keep' })),
]
console.log(describeDivergence(computeDivergence(pairs).overall))
// Overall: the human disagreed on 5 of 20 comparable pairs. Of the 5 with a
// later outcome, the engine was right 3 and the human was right 2.
```

Read the output closely. The verdict is `holding` even though the problem
recurred once: one bad exposed reading is below the default refute bar of 2.
The unexposed March 8 reading is not graded, and `secondary` shows that an
exposure-blind grader would have said `not-holding`.

## How `gradeDecision` works

1. **Structural checks first.** If `decision.recommendationId` does not equal
   `recommendation.id`, the `checkKey` is empty or whitespace, or
   `requireObservedBasis` is on and the basis is `'model-proposed'`, the grade
   is refused with only those codes. Nothing else is read, and the windows in
   the result are all-zero placeholders, not measurements.
2. **Matching.** Only observations whose `subjectId` and `checkKey` exactly
   equal the recommendation's are read. You can pass your whole log.
3. **Windows.** Observations with `observedAt < decidedAt` form the
   **baseline**. Observations with `observedAt > decidedAt` form the
   post-decision window, and those with `exposed === true` form the
   **result** (the headline). `exposed: false` and a missing flag both count
   as not exposed. Observations exactly at `decidedAt` grade neither window
   and are counted in `atBoundaryObservations`. Dates are compared as strings.
4. **Floors.** Each failing floor adds a code, and all failing floors are
   listed together.
5. **Verdict.** If no floor fails: `not-holding` when the result has at least
   `refuteThreshold` bad observations, otherwise `holding`.

The verdict is a count, not a rate comparison. `holding` does not mean the
bad rate went down: 1 bad of 10 before and 1 bad of 3 since is `holding` at
the default bar, with `badRateDelta: 0.233`. Show `badRateDelta` and the raw
counts next to the verdict.

The verdict grades the decision and reads the same either way the human
called it:

| Decision | Exposed bad readings after | Verdict |
| --- | --- | --- |
| adopted | fewer than `refuteThreshold` | `holding` |
| adopted | at least `refuteThreshold` | `not-holding` |
| dismissed | fewer than `refuteThreshold` | `holding` (the pass looks fine) |
| dismissed | at least `refuteThreshold` | `not-holding` (the evidence sided with the advice) |

For a dismissed recommendation, set `exposed: true` on occasions where the
advice would have applied had it been adopted.

### Refusal codes

| Code | Kind | Fires when |
| --- | --- | --- |
| `baseline_below_minimum` | floor | baseline observations < `minBaselineObservations` (default 3) |
| `baseline_lacks_negative_signal` | floor | baseline bad observations < `minBaselineBadObservations` (default 1). With a full baseline this means the problem was not happening before, so its absence afterward says nothing. An empty baseline triggers it too. |
| `result_below_minimum` | floor | post-decision observations, exposed or not, < `minResultObservations` (default 3) |
| `exposed_result_below_minimum` | floor | exposed post-decision observations < `minExposedResultObservations` (default 3) |
| `no_gradeable_check_key` | structural | `checkKey` is empty, whitespace-only, or missing |
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
calibration out of the sentence for a refused report.

**Groups.** Pairs are bucketed by `group`, or by your `groupBy(pair)`. Return
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
// later outcome, the engine was right 4 and the human was right 4.
console.log(describeDivergence(groups[0]))
// Group images: the human disagreed on 6 of 40 comparable pairs. Of the 6 with
// a later outcome, the engine was right 4 and the human was right 2.
console.log(describeDivergence(groups[1]))
// Group text: refused to report divergence (divergent_count_below_minimum);
// 2 of 30 comparable pairs diverged.
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
rates, `null` when either window is empty), `atBoundaryObservations`, the
echoed `thresholds`, and constant `method` and
`interpretation: 'association_not_causation'` labels.

Throws `RangeError`/`TypeError` from `resolveGradeConfig`, and `TypeError`
when `recommendation.id`, `recommendation.subjectId` or
`decision.recommendationId` is not a string, `basis` is not `'observed'` or
`'model-proposed'`, `status` is not `'adopted'` or `'dismissed'`,
`decidedAt` is not a non-empty string, or a matching observation has a
`state` other than `'good'`/`'bad'` or a missing `observedAt`.

### `describeGrade(grade) => string`

One sentence: the verdict with both windows' counts, or "Refused to grade
... :" followed by the codes verbatim.

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
first `exampleLimit` divergent pairs, your own objects), and
`interpretation: 'disagreement_is_a_signal_not_a_verdict'`. Pairs are not
deduplicated, even when they share an `id`. Throws `RangeError` from
`resolveDivergenceConfig` and `TypeError` for a bad `groupBy` return.

### `describeDivergence(report) => string`

One sentence for a report: refused with codes and raw counts; or the
disagreement count plus either why calibration is withheld or the two
separate hit counts.

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
- **The verdict ignores the rate.** See above: `holding` can come back while
  the bad rate rose. Read `badRateDelta`.
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
- **Dates are strings.** Use one ISO-8601 format and one UTC offset for
  every `decidedAt` and `observedAt`. `'2026-01-01'` sorts before
  `'2026-01-01T00:00:00Z'`, and `+05:00` against `Z` compares wrongly. The
  library does not parse dates. `proposedAt` is not read.
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
