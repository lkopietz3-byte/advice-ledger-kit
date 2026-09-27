# Changelog

All notable changes to this project are documented here. The format follows
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and the project
uses [Semantic Versioning](https://semver.org/).

## [0.1.0] - Unreleased

First release. Not yet published to npm.

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
