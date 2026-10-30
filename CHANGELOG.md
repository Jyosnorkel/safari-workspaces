# Changelog

## 0.2.2 — 2026-10-30

- Compare complete stored snapshots independently of object-key order; preserve array order and reject changed values. A reordered-storage regression reproduced the live Safari save-verification error before the fix.
- Request an active dashboard tab and remove explicit popup `window.close()` to avoid a tab-activation/close race. Automated coverage passes; live toolbar launch still needs confirmation.
- Discover every `tests/*.test.mjs` suite from the shared check script.
- Bump web and native development build versions.

Validation: 18 JavaScript/simulated-browser checks pass, the Xcode build passes, and strict code-signature verification passes. Live Safari v0.2.1 popup rendering and current-window scanning were verified. Live save/close failed safely before this fix, leaving the sample tab open. The rebuilt v0.2.2 is registered, but end-to-end retesting awaits successful enablement in Safari. No Meta calls were made; model transport and dashboard wiring are still absent.

## 0.2.1 — 2026-10-28

- Allow deliberate new restore sessions from a completed snapshot.
- Reject duplicate new-session requests and attempts from stale dashboards.
- Replace legacy badge checks with 14 workspace tests, including storage failures, stale tabs, private/pinned exclusions, duplicate URLs, partial closes/restores, interruption recovery and invalid AI suggestions.
- Add a GitHub Actions check on pushes and pull requests.

Validation: JavaScript checks and all 14 simulated-browser tests pass; native Xcode build passes. Live Safari verification is tracked separately and is not implied by these automated checks.
