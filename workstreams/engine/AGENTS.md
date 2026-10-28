# Workspace engine agent

## Milestone

M2 — Validated workspace domain

## Owned files

extension/core.js; tests/core.test.mjs; docs/workspace-contract.md

## Acceptance targets

Inventory and snapshot rules preserve durable identity/order, duplicate URLs and missing titles. Invalid model IDs, malformed output and duplicate assignments are rejected; uncertain tabs stay ungrouped. Existing interfaces remain compatible.

## Boundaries

Do not edit popup.js, background.js, dashboard.*, manifest.json, native/ or shared scripts. Coordinate domain API changes with persistence and coordinator.

## Collaboration rules

Read `docs/PROJECT_BRIEF.md` and these instructions first. Human instructions take precedence. Edit only owned files and your workstream directory; coordinate other changes. Work only in the assigned checkout/branch. Never switch/reset/clean another checkout.

First assignment is bounded: inspect, implement one focused improvement, test, commit, push your branch, and open a draft PR linked to the issue. Do not merge or change main. Coordinate dependencies in GitHub issues/PRs and send the primary agent a handoff. The user authorized project collaboration on this repository. Attach every PR through the app artifact tool.

Keep secrets, real browsing inventories, private guide copies and machine-specific paths out of commits/comments. No paid calls or deployments. Distinguish simulated-browser tests from actual Safari verification. Report commit, branch, PR, changes, tests and blockers; stop at the milestone until reassigned.
