# Changelog

All notable changes to this project are documented here. The format follows
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and the project
uses [Semantic Versioning](https://semver.org/).

## [Unreleased]

## [0.3.0] - unreleased

Minor release with three behavior changes: one verdict change and two new
`TypeError`s. The set of verdict values, the refusal codes, the JSON fields
and the export names are unchanged. `honesty-mcp` (`grade_decision`,
`compute_divergence`) needs to mirror them.

### Breaking changes

- **A tie in the bad rate is now `not-holding` (was `holding`).** When the
  baseline has bad observations and the exposed window's bad rate is equal to
  it (3 of 4 before and 3 of 4 since, or 1 of 3 against 1 of 3), `gradeDecision`
  returns `not-holding`. Migration: no code change is needed because the value
  already exists, but results that used to read `holding` for an exact tie now
  read `not-holding`. Re-run any stored grades you display or alert on.
- **A non-boolean `exposed` now throws a `TypeError`.** `"true"`, `1`, `"yes"`
  or `null` on a matching observation used to be read as "not exposed". It now
  throws, on baseline rows too. Migration: send `true`, `false` or omit the
  key; convert strings and numbers at the boundary, and drop `null`.
- **A non-string `laterOutcome` now throws a `TypeError` in
  `computeDivergence`.** A number, boolean or `null` used to be read as "not
  settled yet". Migration: omit the key or use `''` while a pair is unsettled,
  and send the outcome as a string once it is known.

### Fixed

- **A tie in the bad rate was graded `holding`.** 3 of 4 bad before and 3 of 4
  bad exposed since (with `refuteThreshold: 4`), or 1 of 3 against 1 of 3 with
  the defaults, read as "the problem stayed away" when it had not gone down at
  all. When the baseline has bad observations, the exposed window now has to
  be strictly lower to hold; an equal rate is `not-holding`. The comparison is
  still exact (cross-multiplied counts), so it also catches ties that display
  the same rounded rate. `secondary.wouldBeVerdict` follows the same rule.
  Zero bad before and zero bad since (reachable with
  `minBaselineBadObservations: 0`) stays `holding`.
- **A non-boolean `exposed` was read as "not exposed".** It could hide bad rows
  and turn a failing decision into `holding` (see Breaking changes).
- **A non-string `laterOutcome` was read as "not settled yet".** It shrank the
  resolved count and hid who was right (see Breaking changes).

### Changed

- `describeGrade`: a tie reads "the exposed bad rate (1 of 3) is not lower than
  the baseline's (1 of 3), compared as exact counts, so the problem did not go
  down." When the count bar decides while the exposed rate is lower than the
  baseline's (6 of 6 before, 2 of 60 since), the sentence now says the rate
  fell and that the refute threshold is a fixed count. The sentence for a
  `holding` grade and the JSON are unchanged. Match on the JSON, not the text.

### Documented

- The README now says who the kit fits (a log with dated `good` and `bad`
  readings of the same check on the same subject, before and after a decision)
  and who it does not (decision records with no observations, event logs as
  they are), and adds a tested recipe for turning an event log into readings,
  with a warning that the bucket size can change the verdict.
- New entries in the honest limits: a verdict can hinge on one reading; a
  same-day find and fix on date-only data sits on the boundary and can refuse;
  a key mismatch looks like a young ledger; advice that was replaced has no
  window end; timestamp formats from git and Python need reformatting first;
  `computeDivergence` text says "the human" and "the engine" for any two
  judges. The divergence refusal codes are listed.
- The refute bar is a fixed count, not a rate, so a long window can reach it
  while the bad rate falls sharply (6 of 6 before, 2 of 60 since is
  `not-holding`). This is deliberate and stated in the README and
  `ENGINEERING.md`, with the advice to bound the window or raise
  `refuteThreshold`.
- A date-only `decidedAt` is UTC midnight, so for a caller west of UTC the
  previous local evening counts as after the decision (worked example in the
  README).
- Text in different Unicode forms (NFC and NFD) compares as different in
  `computeDivergence`; normalize labels first.
- A non-string `engineJudgment` or `humanJudgment` makes a pair not
  comparable rather than throwing.
- `exposed` and `laterOutcome` are type-checked but their values are trusted.

## [0.2.1] - 2026-10-07

No change to the library's behavior or API.

### Changed

- The README links to the [in-browser playground](https://lkopietz3-byte.github.io/honesty-kits/#advice-ledger-kit) and the honesty kits family, and the npm homepage now points to the playground.
- Added the `honesty-kits` npm keyword so the family shows up together in search.

### Security

- Development lockfile: `source-map-js` 1.2.2 (GHSA-68fv-2mgg-jv7q). Development tooling only; the published package has no runtime dependencies.

## [0.2.0] - 2026-09-28

Minor release: inputs that used to be accepted now throw, and the text from
`describeGrade` and `describeDivergence` is different. The JSON fields,
refusal codes, verdict rules, thresholds and export names are unchanged.

### Changed (breaking)

- **Timestamps are parsed and compared as instants (AL-004).** `decidedAt`
  and `observedAt` must be `YYYY-MM-DD` (UTC midnight) or a timestamp with
  seconds and an explicit `Z` or `+hh:mm` zone (up to three fractional
  digits), the same grammar as freshness-kit. A non-empty string outside
  that grammar, or naming a day that does not exist, throws a `RangeError`
  (`2026-99-99`, `2025-02-29`, `2026-02-01T09:30:00`). Windows still use
  "strictly before" and "strictly after", and equal instants still grade
  neither window, but equality now holds across string forms:
  `...00Z`, `...00.000Z`, `...+00:00` and `...T01:00:00+01:00` are the same
  instant, and `2026-02-01T00:30:00+01:00` is now before
  `2026-02-01T00:00:00Z` (it used to sort after it). A date-only `decidedAt`
  now equals an observation at `T00:00:00Z` (that observation used to count as
  after the decision). An
  empty or non-string date still throws a `TypeError`. The echoed
  `decidedAt` keeps the string you passed.
- **Input must be plain and dense.** Observation rows, pairs, decisions,
  recommendations and configs must be plain or null-prototype objects: a
  `Map`, `Date`, array or class instance throws a `TypeError` instead of being
  read as empty or as "use the defaults". `observations` and `pairs` must be
  arrays without holes. A `null` config throws; `undefined` still means the
  defaults. `groupBy`, when present, must be a function.
- **Blank identity is rejected.** An empty, whitespace-only or invisible-only
  `recommendation.id`, `recommendation.subjectId` or
  `decision.recommendationId` throws a `TypeError` (a blank id used to match a
  blank id). A `checkKey` that shows nothing, including zero-width and bidi
  control characters that `trim()` missed, is refused as
  `no_gradeable_check_key`.
- **`computeDivergence` returns copies in `examples`**, not your own pair
  objects, and hands `groupBy` the same copy. Each pair field is read once.
- **Text output changed (AL-001, AL-002, AL-003).** Every sentence below is
  new wording; match on the JSON instead of the text.
  - `describeGrade`, thin evidence: `Refused to grade <check> on <subject>:
    <codes>.` is now `Not enough evidence to grade <check> on <subject>.`
    followed by before, after and confirmed-exposed-after counts against the
    required counts, a note that only `exposed: true` counts, the next step,
    `No conclusion about the decision is available from this record.` and
    `Codes: <codes>.` A baseline with no bad observation gets its own line and
    a note that a quiet period afterward says nothing about the
    recommendation; it is never told to add bad observations.
  - `describeGrade`, invalid input: `Cannot grade <check> on <subject>: the
    supplied record cannot be graded, so no observations were measured.` plus
    one sentence per structural code. The zero windows are not printed.
  - `describeGrade`, verdicts: the old sentence is kept as the first sentence,
    then which rule decided (`The exposed bad count (n) reached the refute
    threshold (t).`, or the exact-rate explanation including `Both display as
    <rate>; the exact counts decide, not the rounded display.`), then `This is
    an association between two windows, not evidence that the recommendation
    caused the change.`
  - `describeDivergence`, reportable with calibration: `... the engine was
    right E and the human was right H.` is now `... the engine was right E,
    the human was right H and neither was right N.` plus how many
    disagreements are unresolved and a note that the counts do not show causal
    benefit or general accuracy.
  - `describeDivergence`, calibration withheld: `... (<codes>); N
    disagreements have an outcome.` is now `... (<codes>): N of D
    disagreements have a later outcome.` plus the same note.
  - `describeDivergence`, refused: the old sentence is kept, then `Short on:
    ...` and `No conclusion about the engine or the human is available from
    these pairs.`
  - Caller strings in all text output are escaped: control characters, line
    and paragraph separators, bidi and other format characters, and lone
    surrogates print as `\n`, `\t`, `\r` or `\u{HEX}`.

### Added

- `describeDivergence(report, thresholds?)`: an optional second argument (the
  result's `thresholds`) that adds the required numbers to the text.
- Error messages describe caller values without calling into them, are cut at
  80 characters, and escape control characters, so a hostile value (a
  null-prototype object, a `toString` that throws) can no longer replace the
  error or forge its text.

### Fixed

- A `laterOutcome` or judgment read through a getter could differ between
  reads and break `engineRight + humanRight + neitherRight`. Each field is now
  read once.
- Holes in `observations` or `pairs` were skipped by one pass and visited by
  another. They now throw.
- README, TSDoc and ENGINEERING: dates are no longer described as compared as
  strings; the Node support wording is consistent (22 and 24 LTS and 26
  recommended, 20 compatibility-tested only); the release workflow now
  requires a tag on both triggers, runs the dependency audit and `attw`, and
  treats only a confirmed `E404` as "not published".

### Tests

- Mutation score on `src/`: 97.44% at 0.1.1 (11 survived, 1 uncovered) to
  100% (867 killed, none survived). v8 coverage: 100% of lines.

## [0.1.1] - 2026-09-27

### Added

- CommonJS `require()` support: a `"default"` condition next to `"import"`
  in the `exports` entry, pointing at the same built file. Proven against
  the packed tarball with `require()` on Node 26.3.0, and guarded in CI on
  Node 20, 22, and 24 by an extended `scripts/verify-package.mjs`.

### Fixed

- The shipped `.js.map` file now inlines the original TypeScript source
  (`inlineSources` in `tsconfig.build.json`), so it resolves without the
  unshipped `src/` directory. `.d.ts.map` generation is now disabled instead
  of shipping a source map with an unresolvable `../src/*.ts` path; the
  `.d.ts` declaration file itself is unaffected.

### Changed

- README: replaced "ESM only" with an accurate statement that `require()`
  also works on Node versions that support `require(esm)`.

## [0.1.0] - 2026-09-27

First release.

### Added

- `gradeDecision`, `describeGrade`, `resolveGradeConfig`, `DEFAULT_GRADE_CONFIG`:
  grade one adopted or dismissed recommendation against later observations,
  with a baseline window, an exposure-aligned result window, separate floors
  per window, machine-readable refusal codes, and a refute bar that cannot be
  set below the propose bar.
- `computeDivergence`, `describeDivergence`, `resolveDivergenceConfig`,
  `DEFAULT_DIVERGENCE_CONFIG`: engine-versus-human disagreement with count,
  rate and comparable-pair floors, per-group reports, and engine-right and
  human-right counts reported separately.
- Type declarations for every input and result shape.

### Changed before release (for anyone using the pre-release checkout)

- The divergence rate floor is checked against the exact ratio, not the
  3-place display value. 5 of 101 is now refused at a 0.05 floor.
- Rates round exact halves up consistently. 3 of 80 is now 0.038, not 0.037.
- `SecondaryReading.wouldBeVerdict` can be `'refused'` (type widened to
  `DecisionVerdict`). It used to say `'holding'` from an empty window.
- `gradeDecision` throws a `TypeError` for rows the types forbid (unknown
  `state`, `status` or `basis`, missing or empty dates, non-string ids), and
  `resolveGradeConfig` throws for a non-boolean `requireObservedBasis`. These
  used to be miscounted silently. A missing `checkKey` is now refused with
  `no_gradeable_check_key` instead of crashing.
- A `groupBy` that returns `undefined` leaves the pair ungrouped; any other
  non-string return throws a `TypeError`.
- `describeGrade` now reads "bad in B of N observations before and b of n
  exposed observations since ...", so the exposed count is not presented as
  everything since the decision.
- `DEFAULT_GRADE_CONFIG` and `DEFAULT_DIVERGENCE_CONFIG` are typed `Readonly`
  to match `Object.freeze`.
- `gradeDecision` (and `secondary.wouldBeVerdict`) now return `'not-holding'`
  when the exposed bad rate is higher than the baseline's, even if the bad
  count stays below `refuteThreshold`. 1 of 10 before and 1 of 3 exposed
  since used to be `'holding'`; it is now `'not-holding'`. The comparison is
  exact (cross-multiplied counts), not the rounded `badRate` shown for
  display, so it can disagree with the sign of `badRateDelta` right at a
  rounding boundary. `describeGrade`'s sentence format is unchanged: it
  already prints both windows' raw counts.

[0.1.0]: https://github.com/lkopietz3-byte/advice-ledger-kit
