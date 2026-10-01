# Review and launch readiness

Updated September 30, 2026 against GitHub main `ea995d3ab2384dba8d892cce55af2e3f314bbba7`. This note prepares review of work after the 0.2.0 release; it is not a completed product audit or marketing certification.

Registry check on September 30, 2026 returned `advice-ledger-kit@0.2.0` with gitHead `ea995d3`, matching the inspected main. This confirms the registry version and recorded source commit, not consumer behavior or adoption.

## Review cadence

Keep automatic code reviews off during preparation. Request one focused `@codex review` on a meaningful candidate PR after relevant checks; repeat only when material changes invalidate that review. Do not add a recurring review schedule.

When this repo enters sustained launch or customer-facing development, enable its repository setting individually with **All PRs / On PR open / Exhaustive Off**. Keep the personal automatic default and credit-funded reviews off. Inspect the first result before expanding cadence. Review guidance lives in the root [AGENTS.md](../AGENTS.md); it supplements existing tests and release requirements.

Reported historical observation (September 30, 2026): this repository followed personal preferences, with personal automatic, exhaustive and credit-funded reviews off. Current settings are unknown in this note; check them in ChatGPT before changing review cadence. Committing this file does not change them.

## Next preparation task

honesty-mcp 0.2.0 already declares advice-ledger-kit ^0.2.0 and ships grade_decision and compute_divergence wrappers. Keep an installed-consumer regression example for zoned timestamp boundaries, floor refusals, headline versus secondary outcomes and separate engine/human counts as either package changes.

Finish condition: On a future candidate, a clean installed consumer exercises those cases and its tool descriptions agree with the resolved package APIs. Passing this repository's checks alone does not prove the cross-package behavior.

## Declared verification commands

Read from the inspected main's `package.json`. These are declared gates; the PR records execution results for its final head. Use focused checks during implementation and the existing release gates on the frozen candidate.

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
