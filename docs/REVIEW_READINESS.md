# Review and launch readiness

Prepared September 30, 2026 against GitHub main `ea995d3ab2384dba8d892cce55af2e3f314bbba7`. This is a preparation plan, not a completed product audit or marketing certification.

## Review cadence

Keep automatic code reviews off during preparation. Request one focused `@codex review` on a meaningful candidate PR after relevant checks; repeat only when material changes invalidate that review. Do not add a recurring review schedule.

When this repo enters sustained launch or customer-facing development, enable its repository setting individually with **All PRs / On PR open / Exhaustive Off**. Keep the personal automatic default and credit-funded reviews off. Inspect the first result before expanding cadence. Review guidance lives in the root [AGENTS.md](../AGENTS.md); it supplements existing tests and release requirements.

On September 30, 2026, this repository was verified to **Follow personal preferences**, with personal automatic code reviews, exhaustive reviews and credit-funded reviews off. These settings are managed in ChatGPT; this file does not activate them.

## Next preparation task

Reconcile the release's timestamp/refusal rules and headline-versus-secondary examples with honesty-mcp's grade_decision and compute_divergence schemas and descriptions on the actual consumed versions.

Finish condition: A clean installed consumer shows a zoned boundary case, an unmet-floor refusal and separate engine/human outcomes; descriptions agree with the real API and current dependency resolution.

## Declared verification commands

Read from the inspected main's `package.json`. These are declared gates, not execution receipts; see the candidate PR for hosted-check results and report unavailable checks explicitly. Use focused checks during implementation and the existing release gates on the frozen candidate.

- `npm run verify`: `npm run lint && npm run typecheck && npm test && npm run build && npm run verify:package`
- `npm run lint`: `eslint . --max-warnings=0`
- `npm run typecheck`: `tsc --noEmit`
- `npm run test`: `vitest run`
- `npm run build`: `node -e "require('fs').rmSync('dist',{recursive:true,force:true})" && tsc -p tsconfig.build.json`
- `npm run verify:package`: `node scripts/verify-package.mjs`
- `npm run attw`: `attw --pack . --ignore-rules cjs-resolves-to-esm`

Local tests, hosted authorization, installed package behavior, deployment and buyer evidence are separate outcomes. A dated receipt applies to its recorded revision.

## Source basis

- [ENGINEERING.md](../ENGINEERING.md)
- [PROJECT_CONTEXT.md](../PROJECT_CONTEXT.md)
- [package.json](../package.json)

Public claims require current candidate evidence. Private-data transfers, commercial commitments, package publication, database promotion and deployment retain their existing authorization boundaries.
