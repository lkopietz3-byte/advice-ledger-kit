# Engineering contract

## Invariants (all but the last are pinned by tests)

- No verdict below a floor. Any unmet floor gives `verdict: 'refused'` with
  every unmet floor code listed; structural codes short-circuit alone.
- Only `exposed === true` post-decision observations decide the headline.
  `secondary` is labeled non-headline and its `wouldBeVerdict` applies the
  same floors.
- `holding` requires both a count below `refuteThreshold` AND an exposed bad
  rate not higher than the baseline's; either failing gives `not-holding`.
  The rate check cross-multiplies the raw counts, never the rounded `badRate`
  or `badRateDelta` fields.
- `refuteThreshold >= proposeThreshold`, or `resolveGradeConfig` throws.
- Divergence needs the comparable-pair, count and rate floors; the rate floor
  uses the exact ratio, never the rounded display rate.
- `engineRight + humanRight + neitherRight === resolvedDivergent`; there is
  no blended accuracy field.
- Rates are `null` on an empty denominator and round exact halves up.
- Pure functions: inputs are never modified; results do not depend on input
  order (except `examples`, which keep input order).
- Rows the types forbid throw a `TypeError` instead of being miscounted.
- Zero runtime dependencies.

## Set up and verify

```bash
npm ci
npm run verify   # lint, typecheck, test, build, verify:package
npm audit --include=dev
```

`verify:package` packs the tarball, installs it into an empty project,
checks the exported names against `api-surface.json`, runs
`scripts/consumer-probe.mjs` by package name, and compiles
`scripts/consumer-probe.mts` with strict NodeNext settings.
`test/reference.test.ts` compares both engines with a naive reference
implementation on seeded random inputs.

## What is not certified

- No statistical inference: floors are minimum counts, not significance
  tests or intervals. Results are associations, not causal effects.
- Dates are compared as strings; mixed formats or UTC offsets give wrong
  windows and are not detected.
- No deduplication of observations or pairs.
- `exposed` and `laterOutcome` are trusted as given.

## Release and rollback

- `npm run verify` (lint, typecheck, test, build, verify:package) runs
  automatically before publish via the `prepublishOnly` script.
- Before a release: update `CHANGELOG.md` and, for export changes, run
  `node scripts/verify-package.mjs --update-api` and review the diff, then
  `npm publish`.
- A change to a refusal code, verdict rule or sentence format affects
  honesty-mcp (`grade_decision`, `compute_divergence`); note it in the
  changelog.
- Rollback: npm allows `npm unpublish` only within 72 hours of publishing;
  after that, publish a fixed patch version instead. Nothing here migrates
  data.
