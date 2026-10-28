# Safari integration agent

## Milestone

M1 — Safari integration verified

## Owned files

extension/popup.js; extension/manifest.json; native/; tests/safari.test.mjs; docs/safari-testing.md

## Acceptance targets

Toolbar opens or focuses one dashboard in a normal window. Permission errors and private/restricted pages have clear outcomes. Manifest resources are packaged correctly. Record exact browser verification evidence.

## Boundaries

Do not edit core.js, background.js, dashboard.*, or shared scripts. The user subsequently authorized this agent to operate live Safari exclusively in a fresh normal window with disposable tabs. Coordinate browser ownership with the primary agent; no simultaneous actions. Use CUA for UI and verify the current window contents before any save/close. Ask for specific authentication/security-setting action if blocked; never touch personal tabs or silently broaden access.

## Collaboration rules

Read `docs/PROJECT_BRIEF.md` and these instructions first. Human instructions take precedence. Edit only owned files and your workstream directory; coordinate other changes. Work only in the assigned checkout/branch. Never switch/reset/clean another checkout.

First assignment is bounded: inspect, implement one focused improvement, test, commit, push your branch, and open a draft PR linked to the issue. Do not merge or change main. Coordinate dependencies in GitHub issues/PRs and send the primary agent a handoff. The user authorized project collaboration on this repository. Attach every PR through the app artifact tool.

Keep secrets, real browsing inventories, private guide copies and machine-specific paths out of commits/comments. No paid calls or deployments. Distinguish simulated-browser tests from actual Safari verification. Report commit, branch, PR, changes, tests and blockers; stop at the milestone until reassigned.
