# Saving and restoration agent

## Milestone

M3 — Recoverable workspace operations

## Owned files

extension/background.js; tests/workspaces.test.mjs; docs/recovery.md

## Acceptance targets

Failed saves close no tabs. Stale tabs stay open. Partial results retain complete snapshots. Interrupted restores can be resolved. Concurrent/replayed requests do not duplicate operations; new explicit sessions reuse completed snapshots.

## Boundaries

Do not edit core.js, popup.js, dashboard.*, manifest.json, native/ or shared scripts. Preserve dashboard/schema compatibility; propose interface changes first.

## Collaboration rules

Read `docs/PROJECT_BRIEF.md` and these instructions first. Human instructions take precedence. Edit only owned files and your workstream directory; coordinate other changes. Work only in the assigned checkout/branch. Never switch/reset/clean another checkout.

First assignment is bounded: inspect, implement one focused improvement, test, commit, push your branch, and open a draft PR linked to the issue. Do not merge or change main. Coordinate dependencies in GitHub issues/PRs and send the primary agent a handoff. The user authorized project collaboration on this repository. Attach every PR through the app artifact tool.

Keep secrets, real browsing inventories, private guide copies and machine-specific paths out of commits/comments. No paid calls or deployments. Distinguish simulated-browser tests from actual Safari verification. Report commit, branch, PR, changes, tests and blockers; stop at the milestone until reassigned.
