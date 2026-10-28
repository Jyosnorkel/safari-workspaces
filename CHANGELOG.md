# Changelog

## 0.2.1 — 2026-10-28

- Allow deliberate new restore sessions from a completed snapshot.
- Reject duplicate new-session requests and attempts from stale dashboards.
- Replace legacy badge checks with 14 workspace tests, including storage failures, stale tabs, private/pinned exclusions, duplicate URLs, partial closes/restores, interruption recovery and invalid AI suggestions.
- Add a GitHub Actions check on pushes and pull requests.

Validation: JavaScript checks and all 14 simulated-browser tests pass; native Xcode build passes. Live Safari verification is tracked separately and is not implied by these automated checks.
