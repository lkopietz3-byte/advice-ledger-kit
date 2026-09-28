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

## Are the types wrong? (attw)

CI runs [`arethetypeswrong`](https://github.com/arethetypeswrong/arethetypeswrong.github.io)
(`npm run attw`, which is `attw --pack . --ignore-rules cjs-resolves-to-esm`)
against the packed tarball after the build step. The `cjs-resolves-to-esm` rule is ignored on
purpose: this is an ESM-only package (`"type": "module"`, no `require` entry point), so a
CommonJS consumer must use Node's `require(esm)` support (Node >=20.19 or >=22.12 — see
"Runtime support policy" below) rather than a native `require`. A dual CJS+ESM build was
rejected to avoid the dual-package hazard (two separately-identified copies of the same module,
with broken `instanceof` checks and duplicated module state across the CJS and ESM entry
points).

## Release and rollback

`npm run verify` (lint, typecheck, test, build, verify:package) runs automatically before
publish via the `prepublishOnly` script, so a broken build cannot reach the registry by
accident. To release: add a dated entry to `CHANGELOG.md`, bump `version` in
`package.json`, commit, and push a `vX.Y.Z` tag that matches the new version, then let
`.github/workflows/release.yml` install, verify, and publish it. (You can also run
`npm publish` locally; `prepublishOnly` still guards it.)

npm's unpublish policy is deliberately narrow. Within 72 hours of publishing, a version can be
unpublished only if no other published package depends on it. After 72 hours, unpublishing also
requires fewer than 300 downloads in the last week and a single maintainer — most released
versions won't qualify either way. A given `name@version` can never be reused, published or
not, even after an unpublish. Treat unpublish as unavailable: prefer fixing forward with a new
patch version, and use `npm deprecate <name>@"<range>" "<message>"` to warn consumers off a
bad release while it stays installable for anyone already pinned to it.

A change to a refusal code, verdict rule, or sentence format affects `honesty-mcp`
(`grade_decision`, `compute_divergence`); note it in the changelog.

### Runtime support policy

- **Supported (recommended for production):** Node 22 and 24 LTS; Node 26 current.
- **Compatibility-tested:** Node 20. Node 20 is end-of-life — nodejs.org's release page
  (<https://nodejs.org/en/about/previous-releases>) lists it as `EOL`, with its final release
  dated Mar 24, 2026. The `compat` job in `verify.yml` still runs on Node 20 to catch
  regressions, but that runtime gets no security fixes upstream; don't run production traffic
  on it.
- CommonJS `require()` of this package needs Node >=20.19 or >=22.12 (`require(esm)`
  support). ESM `import` works on every version this package tests (20, 22, 24).
- `engines` in `package.json` is unchanged by this policy.

### Publishing with provenance

`.github/workflows/release.yml` publishes using npm trusted publishing: it triggers on
`workflow_dispatch` or a pushed `v*` tag, requests a short-lived OIDC token instead of
reading a stored npm token (`permissions: id-token: write`), and runs a plain `npm publish`
with no token and no `--provenance` flag, because provenance attestation is generated
automatically under trusted publishing. Before publishing, the workflow confirms the tag
matches `package.json`'s `version` and checks whether that version is already on the
registry, so re-running it on a version that's already published is a no-op rather than an
error. Trusted publishing must be configured for this package on npmjs.com (linking it to this
GitHub repository and the `release.yml` workflow) before the first automated release will
work.
