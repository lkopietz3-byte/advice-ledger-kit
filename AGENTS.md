# advice-ledger-kit — agent instructions

Grade decisions on a recommender's advice against later observations, refusing with machine-readable codes when before/after or exposure floors are not met, and measure engine-versus-human disagreement with engine-right and human-right counts kept separate.

## Read first
- `ENGINEERING.md` holds this package's invariants and design rules; read it before changing behavior.
- `PROJECT_CONTEXT.md` is the current project state and decisions.
- `SECURITY.md` covers the security posture; follow it for anything touching input handling.

## Commands (from package.json)
- `npm run verify`
- `npm run lint`
- `npm run typecheck`
- `npm run test`
- `npm run build`
- `npm run verify:package` packs and installs the tarball offline; run `npm run build` first.

## Rules
- Run `npm run verify` and read its output before calling work done. Report any step that did not run.
- Build cleans `dist/` first; never trust a stale `dist/` for declaration or package checks.
- Never weaken lint, tests or `api-surface.json` to get green. Public API changes are deliberate (`node scripts/verify-package.mjs --update-api`) and must be called out.
- Do not run `npm publish` or push tags without explicit permission. Treat any claim that a version is published as Reported until the registry confirms it.
- Runtime `dependencies` stay empty; add dev tooling only.
- Keep unrelated uncommitted work intact; never stage or reset the whole tree.

## Review preparation

See [docs/REVIEW_READINESS.md](docs/REVIEW_READINESS.md) for milestone review cadence, declared verification gates and the next launch-preparation task.

## Code Review Rules

- Preserve floor-based refusals, structural short-circuits and exposed-only headline evidence; label secondary outcomes separately. A holding verdict requires both the raw-count refutation threshold and the exact exposed-rate comparison, never rounded display fields.
- Preserve single-read validated snapshots and parsed-instant window semantics: dates are UTC midnight, timestamps need explicit zones, invalid rows/dates throw and equal instants share the same boundary. Do not silently deduplicate or authenticate caller-supplied exposure/outcome labels.
- Keep engine-right, human-right and neither-right counts distinct and consistent with resolved divergence. Empty-denominator rates remain null; minimum floors are not significance, causal-effect or probability-calibration evidence.
