# advice-ledger-kit

A tiny, zero-dependency library for grading a recommender against what a
person did with its advice. Grading a recommendation engine against human
override is not new — demand planners have called it Forecast Value Added for
twenty years, and clinical informatics has studied alert-override
appropriateness for longer. What's usually missing is a version with explicit
statistical floors, shipped where the person who owns the decision can see it,
instead of an analysis someone runs quarterly or a metric published only in
aggregate. This library is that version: it compares a **before** window to an
**after** window instead of only tallying what happened afterward, it only
lets outcomes where the advice could actually have applied create or reverse
the headline reading, it holds each window to its own floor, and below any
floor it hands back **machine-readable refusal codes instead of a verdict**.
It also ships a second engine for the case where two independent judges rate
the same thing: it measures how often they disagree, and where a later
outcome exists, it reports **engine-was-right** and **human-was-right** as two
separate numbers that are never blended into one "accuracy".

Domain-agnostic on purpose. A recommendation is `{subjectId, checkKey}`, an
observation is `good` or `bad`, and everything else is the caller's vocabulary.
It works the same for maintenance procedures, content-moderation calls,
code-quality rules, spending suggestions, or health experiments.

**Prior art, named up front.** [Forecast Value Added](https://www.sas.com/en/whitepapers/forecast-value-added-analysis-106186.html)
(demand planning) grades a human override against a statistical baseline and
is the closest precedent to API 1; its own published critique is that a
positive result can be accidental, which is exactly what the floors here are
for. Alert-override-appropriateness review in clinical decision support
(e.g. [systematic review, PMC7400042](https://www.ncbi.nlm.nih.gov/pmc/articles/PMC7400042/))
is the closest precedent to API 2, and it typically requires manual chart
review rather than an automatic, in-the-moment number. Netflix's RecSysOps
treats a human choosing a low-ranked item as a signal worth investigating,
which is API 2's divergence case running as internal ops. None of the three
publish explicit minimum-count floors or return a machine-readable refusal
code below them — that combination, not the loop itself, is what this library
adds.

## The core insight, plainly

A system that refuses to fabricate a reading about the world should also refuse
to pretend its own advice is landing.

It is easy to build a recommender that never checks itself. It is nearly as easy
to build one that checks itself badly, and worse, because a bad self-check
produces confident numbers. Two specific bad self-checks show up over and over:

**"Nothing has gone wrong since you adopted this."** That sentence is satisfied
by advice that worked. It is equally satisfied by a subject nobody looked at
again, and by a subject where the problem was never happening in the first
place. Without a baseline you cannot tell those three apart, and the tool will
happily report the third one as a win.

**"It went wrong twice, so the advice failed."** Except on both of those
occasions the advice was not in force. The machine was out of service, the rule
did not apply to that file, the user did not attempt the experiment that day.
Counting those outcomes against the advice blames it for what happened while it
was on the shelf.

This library refuses both, and it refuses out loud. When the evidence is thin it
returns `verdict: 'refused'` with an array like
`['baseline_below_minimum', 'exposed_result_below_minimum']` — codes you can
branch on and turn into "here is exactly what would make this gradeable"
rather than a boolean or a vague `unproven` string.

## Install

```bash
npm install
npm test           # vitest
npm run typecheck  # tsc --noEmit
npm run build      # emits dist/ (ESM + .d.ts)
```

Zero runtime dependencies. ESM only (`"type": "module"`). Strict TypeScript. MIT.

## API 1 — `gradeDecision(decision, recommendation, observations, config?)`

A maintenance system noticed that pump-14's seal kept leaking and recommended a
weekly re-torque of the mounting bolts. The technician adopted it on February 1.
Inspections keep happening, and each one records whether the procedure was
actually performed that week.

```ts
import { gradeDecision, describeGrade } from 'advice-ledger-kit'
import type { Decision, Observation, Recommendation } from 'advice-ledger-kit'

const recommendation: Recommendation = {
  id: 'rec-88',
  subjectId: 'pump-14',
  checkKey: 'seal-leak',
  proposedAt: '2026-01-18',
  basis: 'observed',
}

const decision: Decision = {
  recommendationId: 'rec-88',
  status: 'adopted',
  decidedAt: '2026-02-01',
}

const log: Observation[] = [
  // Before the decision. Exposure does not apply: there was no advice in force.
  { subjectId: 'pump-14', checkKey: 'seal-leak', state: 'bad',  observedAt: '2026-01-04' },
  { subjectId: 'pump-14', checkKey: 'seal-leak', state: 'bad',  observedAt: '2026-01-11' },
  { subjectId: 'pump-14', checkKey: 'seal-leak', state: 'good', observedAt: '2026-01-18' },
  { subjectId: 'pump-14', checkKey: 'seal-leak', state: 'bad',  observedAt: '2026-01-25' },
  { subjectId: 'pump-14', checkKey: 'seal-leak', state: 'bad',  observedAt: '2026-01-29' },
  { subjectId: 'pump-14', checkKey: 'seal-leak', state: 'good', observedAt: '2026-01-31' },

  // After. `exposed` says whether the re-torque actually happened that week.
  { subjectId: 'pump-14', checkKey: 'seal-leak', state: 'good', observedAt: '2026-02-08', exposed: true },
  { subjectId: 'pump-14', checkKey: 'seal-leak', state: 'good', observedAt: '2026-02-15', exposed: true },
  { subjectId: 'pump-14', checkKey: 'seal-leak', state: 'good', observedAt: '2026-02-22', exposed: true },
  { subjectId: 'pump-14', checkKey: 'seal-leak', state: 'bad',  observedAt: '2026-03-01', exposed: true },
  { subjectId: 'pump-14', checkKey: 'seal-leak', state: 'bad',  observedAt: '2026-03-08', exposed: false },
]

const grade = gradeDecision(decision, recommendation, log)
```

```jsonc
{
  "verdict": "holding",
  "refusalCodes": [],
  "baseline": { "observations": 6, "bad": 4, "good": 2, "badRate": 0.667 },
  "result":   { "observations": 4, "bad": 1, "good": 3, "badRate": 0.25 },
  "badRateDelta": -0.417,
  "secondary": {
    "label": "secondary-not-the-headline",
    "observations": 5, "bad": 1, "badRate": 0.2,
    "wouldBeVerdict": "holding"
  }
}
```

```ts
describeGrade(grade)
// "Holding: seal-leak on pump-14 was bad in 4 of 6 before, 1 of 4 since
//  the recommendation was adopted on 2026-02-01."
```

Note what the result carries: the raw counts on **both** sides, so a caller can
render the actual sentence a person needs ("bad in 4 of 6 before, 1 of 4 since")
rather than a bare label. `holding` here does not mean nothing went wrong. One
recurrence did happen; it is below the refute bar, and the before/after rates
are in the object so nobody has to take the word `holding` on faith.

Run the same call against a two-row log and it says so instead of guessing:

```ts
gradeDecision(decision, recommendation, [
  { subjectId: 'pump-14', checkKey: 'seal-leak', state: 'bad',  observedAt: '2026-01-25' },
  { subjectId: 'pump-14', checkKey: 'seal-leak', state: 'good', observedAt: '2026-02-08', exposed: true },
])
// verdict: "refused"
// refusalCodes: [
//   "baseline_below_minimum",
//   "result_below_minimum",
//   "exposed_result_below_minimum"
// ]
```

### The verdict grades the decision, not the recommendation

It means the same thing whichever way the human called it:

| Decision | What happened after | Verdict |
| --- | --- | --- |
| adopted | the problem stayed away | `holding` |
| adopted | the problem came back, at the refute bar | `not-holding` |
| dismissed | the problem stayed away | `holding` — the pass looks fine |
| dismissed | the problem came back, at the refute bar | `not-holding` — the evidence sided with the advice |

That last row is the one worth wiring into a UI. A dismissal that later gets
contradicted by the record is the single most useful thing a recommender can
learn about itself.

### Refusal codes

| Code | What it means | What would fix it |
| --- | --- | --- |
| `baseline_below_minimum` | Too few observations before the decision. | Look at the subject more before deciding, or wait. |
| `result_below_minimum` | Too few observations after the decision. | Nobody has re-checked. Re-check. |
| `exposed_result_below_minimum` | Observations exist, but too few where the advice could apply. | Record exposure, or wait for occasions where it applies. |
| `baseline_lacks_negative_signal` | Nothing was going wrong before the decision. | Nothing. This subject cannot demonstrate improvement it never needed. |
| `no_gradeable_check_key` | The recommendation names no check. | Attach a check key, or accept that this advice is ungradeable. |
| `basis_not_gradeable` | `requireObservedBasis` is on and a model proposed this. | Turn the flag off, or wait for an observed proposal. |
| `decision_recommendation_mismatch` | The two rows do not refer to each other. | A caller bug. Fix the join. |

The first three are the floors named in `GradeConfig`; the rest are structural.
Codes accumulate — a thin log returns all of the ones that apply, not the first.

## Why exposure alignment matters

`Observation.exposed` is the flag that says *the recommendation could actually
have applied on this occasion*. Only observations with `exposed === true` are
allowed to create or reverse the headline verdict. `false` and omitted are both
treated as not-exposed, deliberately: an unanswered exposure question is not a
confirmed exposure, and treating it like one is the whole bug.

Here is the failure it prevents, concretely.

The re-torque recommendation is adopted on pump-14. Over the next two months
there are five inspections. On three of them the pump was in the line and the
re-torque was performed; all three came back clean. On the other two the pump
had been pulled for an unrelated impeller rebuild, the re-torque never happened,
and both inspections logged the leak.

```ts
const grade = gradeDecision(decision, recommendation, [
  /* baseline: 3 bad, 1 good */
  { /* … */ state: 'good', observedAt: '2026-02-08', exposed: true  },
  { /* … */ state: 'good', observedAt: '2026-02-15', exposed: true  },
  { /* … */ state: 'good', observedAt: '2026-02-22', exposed: true  },
  { /* … */ state: 'bad',  observedAt: '2026-03-01', exposed: false },
  { /* … */ state: 'bad',  observedAt: '2026-03-08', exposed: false },
])

grade.verdict                    // "holding"
grade.result                     // { observations: 3, bad: 0, good: 3, badRate: 0 }
grade.secondary.wouldBeVerdict   // "not-holding"   ← what an unaligned grader says
grade.secondary.observations     // 5
grade.secondary.bad              // 2
```

Without exposure alignment those two out-of-service inspections flip the verdict
to `not-holding`. The system then tells the technician its own advice failed, on
the strength of two readings taken while the advice was sitting on a shelf. Next
time it will propose something worse, and it will have taught itself to.

The consequence compounds in the direction you would least want: advice is
*least* likely to be applied exactly when a subject is in trouble, and a subject
in trouble is exactly when bad outcomes cluster. So unaligned grading
systematically punishes advice for the periods when it was least able to help.

The unaligned reading is not thrown away — it is right there in `secondary`,
labelled `'secondary-not-the-headline'` with
`interpretation: 'exposure_unaligned_descriptive_only'`, carrying its own
`wouldBeVerdict` so the gap between the two readings is visible rather than
hidden. It just cannot become the headline. That is a structural property of the
return shape, not a convention someone has to remember.

**If your domain has no exposure concept, set `exposed: true` on every
post-decision observation.** That is one line, it is explicit, and it means the
next person reading the code knows the question was considered. Leaving the flag
off everywhere makes this library refuse to grade anything, on purpose.

## Why asymmetry in the wrong direction is a bug

`proposeThreshold` is how many bad observations it took to justify emitting the
recommendation. `refuteThreshold` is how many it takes to overturn the decision.
**It defaults to `proposeThreshold`, and setting it lower throws a `RangeError`.**

The failure mode is quiet and it is common. A recommender wants to be careful
about *suggesting* things, so it requires the problem to recur — two
observations, across two dates or two subjects — before it will speak. Then the
grading path is written later by someone else, and it flips a rule to "not
holding" on **one** post-adoption recurrence, because one recurrence obviously
means the rule is not working.

Those two bars are in the same system, judging the same evidence, and they are
off by a factor of two in the direction that makes everything the system
recommends eventually read as failing. Run it long enough and every piece of
advice you ever gave is marked broken, because a single stray observation is all
it takes, and given enough time you will always get one. The user learns to
ignore the grade, which is the correct response, and the loop dies.

Raising `refuteThreshold` above `proposeThreshold` is allowed — that is a
deliberate choice to make decisions harder to overturn, and it is visible in
`grade.thresholds` on every result. Lowering it is not a policy, it is a thumb
on the scale, so this library will not let you do it silently.

## API 2 — `computeDivergence(pairs, config?)`

Two independent judges rating the same object are most informative when they
**disagree**. Agreement is cheap; disagreement is the only place either judge can
be shown wrong. Most systems with two judges available never put them side by
side at all — the engine's rating goes in one column, the human's override goes
in another, and nobody ever subtracts.

A content-moderation queue: the engine proposes `remove` or `keep`, a reviewer
confirms or overrules, and an appeals board sometimes settles the case later.

```ts
import { computeDivergence, describeDivergence } from 'advice-ledger-kit'
import type { JudgmentPair } from 'advice-ledger-kit'

const times = (n: number, pair: JudgmentPair): JudgmentPair[] =>
  Array.from({ length: n }, () => pair)

const queue: JudgmentPair[] = [
  // images: 34 agreements, 6 overrules (4 later settled for the engine, 2 for the reviewer)
  ...times(34, { engineJudgment: 'remove', humanJudgment: 'remove', group: 'images' }),
  ...times(4,  { engineJudgment: 'remove', humanJudgment: 'keep', laterOutcome: 'remove', group: 'images' }),
  ...times(2,  { engineJudgment: 'remove', humanJudgment: 'keep', laterOutcome: 'keep',   group: 'images' }),

  // text: 28 agreements, 2 overrules
  ...times(28, { engineJudgment: 'keep', humanJudgment: 'keep', group: 'text' }),
  ...times(1,  { engineJudgment: 'remove', humanJudgment: 'keep', laterOutcome: 'keep',   group: 'text' }),
  ...times(1,  { engineJudgment: 'keep', humanJudgment: 'remove', laterOutcome: 'remove', group: 'text' }),
]

const { overall, groups } = computeDivergence(queue)
```

```jsonc
{
  "overall": {
    "comparablePairs": 70,
    "agreements": 62,
    "divergentCount": 8,
    "divergentRate": 0.114,
    "status": "reportable",
    "refusalCodes": [],
    "calibration": {
      "resolvedDivergent": 8,
      "engineRight": 4,
      "humanRight": 4,
      "neitherRight": 0,
      "engineRightRate": 0.5,
      "humanRightRate": 0.5,
      "status": "reportable"
    }
  },
  "groups": [
    { "group": "images", "comparablePairs": 40, "divergentCount": 6,
      "divergentRate": 0.15,  "status": "reportable", "refusalCodes": [] },
    { "group": "text",   "comparablePairs": 30, "divergentCount": 2,
      "divergentRate": 0.067, "status": "refused",
      "refusalCodes": ["divergent_count_below_minimum"] }
  ]
}
```

```ts
describeDivergence(overall)
// "Overall: the human disagreed on 8 of 70 comparable pairs. Of the 8 with a
//  later outcome, the engine was right 4 and the human was right 4."

describeDivergence(groups[0])
// "Group images: the human disagreed on 6 of 40 comparable pairs. Of the 6 with
//  a later outcome, the engine was right 4 and the human was right 2."

describeDivergence(groups[1])
// "Group text: refused to report divergence (divergent_count_below_minimum);
//  2 of 30 comparable pairs diverged."
```

This example is worth reading twice. The overall calibration is a dead heat, 4
and 4, which says nothing actionable. Broken out by group, the images queue is 4
to 2 in the engine's favour and the text queue is refused outright for having
too few disagreements to mean anything. **The grouped view carries the signal
that the aggregate washes out**, which is why `groupBy` exists.

Pass any bucketing you like:

```ts
computeDivergence(queue, { groupBy: (pair) => `engine-said-${pair.engineJudgment}` })
```

Return `null` from `groupBy` to leave a pair out of the breakdown entirely. It
still counts in `overall`.

### The denominator, and the two floors

`comparablePairs` counts only the pairs where **both** judges actually spoke.
That is the population where disagreement was even possible. Most real datasets
have far more one-sided rows than two-sided ones — plenty of engine ratings
nobody reviewed — and counting those as agreements understates divergence badly.

Divergence must clear **both** a count floor and a rate floor:

- `minDivergentCount` (default 3) — one weird call is not a pattern.
- `minDivergentRate` (default 0.05) — three disagreements out of a thousand is
  not a pattern either.
- `minComparablePairs` (default 10) — and three out of three, a perfect 100%
  disagreement rate, is not a pattern at all.

Either floor alone lets one of those through. Counts and rates are always
computed and always returned, because they are arithmetic, not claims. What the
floors gate is `status`, the only field that says the number is worth acting on.

`calibration` carries its own floor (`minResolvedDivergent`, default 3) and its
own `status`, so a population can legitimately have reportable divergence and
refused calibration: plenty of disagreements, not enough of them settled yet.

### Never one accuracy number

`engineRight` and `humanRight` are reported separately and there is no blended
field to read. On a divergent pair the two judgments differ by definition, so at
most one of them can match the outcome, and `engineRight + humanRight +
neitherRight === resolvedDivergent` exactly. A single "accuracy" is not just
discouraged here, it is not constructible from the shape.

The reason is that merging them answers the wrong question. A system can be
right 96% of the time overall and wrong on every single case a human bothers to
overrule — and the second fact is the one that tells you where the model is
weak, where the reviewers are miscalibrated, and which of the two you should be
retraining.

## Limits

**This measures association, not causation.** Every result carries
`interpretation: 'association_not_causation'` for a reason. A `holding` verdict
says the problem occurred less often after the decision than before it, on
occasions where the advice could apply. It does not say the advice caused that.
Seasonality, a concurrent change, regression to the mean, and the simple fact
that somebody was paying attention to this subject at all are alternative
explanations this library cannot rule out and does not try to. If you need a
causal estimate, you need randomization, and this is not that.

**It will often refuse to answer, and that is the point.** With the default
floors, most decisions in a young ledger come back `refused`. That is the honest
state of the evidence, not a bug and not a gap to paper over. A tool that always
produces a verdict is not more useful than one that refuses; it is a tool whose
verdicts you cannot trust, because you can no longer tell the well-evidenced
ones from the empty ones. Render the refusal codes. `exposed_result_below_minimum`
is genuinely useful information: it tells a user precisely what to go collect.

**A caller who sets every floor to 1 has defeated the entire purpose.** The
library will let you — the floors are configuration, and there are legitimate
reasons to tune them for a domain with a slow observation cadence. But floors of
1 turn this into exactly the naive grader it was written to replace: one
observation before, one after, and a confident verdict off a sample of two. If
you find yourself lowering the floors to make the refusals go away, the
refusals were correct and the ledger is too young. Lower them because you
reasoned about the observation rate in your domain, and write down which.

**Baselines can be wrong in ways this cannot see.** The baseline window is
"everything before the decision", which is only meaningful if the pre-decision
period is comparable to the post-decision one. A subject that was in an unusual
state before the decision gives a misleading baseline, and nothing here detects
that. Similarly, `exposed` is caller-supplied and trusted completely: if your
exposure recording is biased — say, exposure gets logged more reliably on
occasions that go well — that bias flows straight into the headline.

**Dates are compared as strings.** Use one consistent ISO-8601 format across a
ledger. Mixing `'2026-01-01'` with `'2026-01-01T00:00:00Z'` sorts wrongly, and
this library does not parse dates to protect you from it.

**Two judges disagreeing tells you one of them is wrong, not which one.** That
is what the `laterOutcome` field is for, and where no outcome exists,
`calibration` refuses rather than guessing. Divergence alone is a place to look,
not a verdict — hence `interpretation: 'disagreement_is_a_signal_not_a_verdict'`
on every report.

## License

MIT © Lucas Kopietz
