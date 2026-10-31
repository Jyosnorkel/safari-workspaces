# Safari Workspaces

A macOS Safari Web Extension for turning browser tabs into focused, reusable workspaces.

Built for the Meta Global AI Developer Hackathon, October–November 2026. This is an early development build, not a production release.

## Product goal

Scan tabs → get meaningful Meta AI group suggestions → review and edit → save and close a group → restore its URLs later.

## Current implementation

- A toolbar popup opens the workspace dashboard in the current normal Safari window.
- Scan available tab titles and URLs; exclude private tabs and leave pinned and restricted tabs untouched.
- Create and rename groups, move tabs between them, and exclude individual tabs.
- Drag tab grips onto a sticky group chip; click a chip to collapse the entire group to that chip. Keyboard toggles and move menus remain available. Collapse changes only the dashboard view and leaves browser tabs open.
- Save an entire window without closing tabs, including pinned web URLs.
- Export versioned JSON backups and preview/import them without replacing existing snapshots or opening tabs; see [backup format](docs/backup-format.md).
- Save ordered URL/title snapshots to local extension storage, with persistent IDs and timestamps.
- Write and read back snapshots before closing selected tabs; recheck live tab URLs before closing.
- Track partial restoration and provide controls for uncertain results after an interruption.

The Meta integration includes a local authenticated service, the official Responses/token-count transport, durable request limits and an editable suggestion preview. The user reports reasonable live Meta suggestions after the output cap was raised to 2,048 tokens. Automated tests use fake providers; this report is separate from independent browser verification. Manual grouping and backups work without an AI connection.

To use your existing terminal key, follow [local Meta setup](docs/meta-setup.md). The key remains in the local service environment; the extension receives only a separate pairing token. Each connection/status check and suggestion automatically authenticates and refreshes Safari’s changed origin in connection.json; no repeated manual JSON edits or re-pairing are needed. Suggestions require disclosure/consent and explicit acceptance. Default limits are one in flight, two outbound attempts per minute and twenty per UTC day, with no retries. Token counting and generation consume separate attempts.

## Build and try locally

Requires macOS, Safari, Xcode and its command-line tools. No npm dependencies are needed for the current extension.

```sh
./scripts/build.sh
open 'build/Build/Products/Debug/Safari Dev Lab.app'
```

The native host still uses the starter name **Safari Dev Lab**. The web extension is named **Safari Workspaces**. Both retain the original bundle identifier prefix so existing local installs can be updated.

1. Enable Safari's developer features and **Allow unsigned extensions** for this ad-hoc development build. Authentication may be required, and Safari may reset this setting after quitting.
2. Enable the extension in Safari Settings → Extensions. The `tabs` permission provides tab metadata; `storage` persists workspaces locally.
3. Create a separate normal window with disposable test tabs. Click the toolbar icon, then **Open workspace manager**.
4. Scan the window, create a group, and move tabs into it. Rename it and uncheck any tabs you want to leave open.
5. Try **Save snapshot** first, then **Save & close selected** and **Restore workspace**.

The Xcode project is at `native/Safari Dev Lab/Safari Dev Lab.xcodeproj`. It references the files in `extension/` directly; rebuild after editing them.

Current development safety rule: keep all existing Safari sessions/windows open and do not quit Safari. Do not perform the save-and-close or restart test steps on your personal browsing windows. Browser integration checks remain pending until a suitable disposable test session is available.

For a local HTTP test page:

```sh
./scripts/serve.sh
```

Open http://localhost:8765/ in Safari. The existing test page still describes the earlier development demo; use it as a disposable web tab.

## Verification status and known limitations

- The v0.4.1 native build and strict code-signature verification passed on October 30, 2026; the packaged AI client matches source.
- The new group-chip mouse dragging, unchecked-tab preservation and keyboard collapse/expand were verified in the internal browser with fictional tab APIs. Actual Safari testing of this UI remains pending.
- Live Safari popup rendering and current-window scanning were verified. A live storage-verification failure was reproduced and fixed with regression coverage; full save/close/restore retesting and restart persistence are **not yet verified**.
- `node scripts/check.mjs` passes 116 automated checks for workspace rules, fake-DOM review flows, fake Meta providers, authenticated local HTTP contracts and usage budgets. Syntax and native resource checks are included. These do not replace Safari testing.
- Completed snapshots support an explicit **Restore another copy** action. New restore sessions are protected against replayed requests and stale dashboards.
- Unsaved forms, browsing history, scroll position and complete page state are not saved. Restoration reopens URLs only.
- Groups live in the extension dashboard. Native Safari Tab Groups are not controlled.
- Current scope is one normal Safari window; no accounts, cloud sync or App Store distribution.

## Privacy and AI plan

Workspaces are stored locally in Safari extension storage. No model call runs until a configured local service receives an authenticated, explicitly consented suggestion request. Saved snapshots and exported backups contain full URLs, which can contain sensitive query parameters; keep them private.

Meta input uses only included eligible tab titles and URLs with credentials, queries and fragments removed. Titles and paths can still contain sensitive information; the UI previews this exact input. Model output is validated against existing tab IDs and staged for user review. It never supplies restoration URLs or instructions to close tabs. Private, pinned and restricted tabs are excluded from inference. No page excerpts are sent.

## Source layout

- `extension/`: popup, dashboard, browser operation coordinator and domain rules.
- `native/`: Swift macOS host and Safari Web Extension target.
- `server/`: paired local transport, Meta adapter and durable attempt limits.
- [MVP goals](docs/GOALS.md): webpage milestones, implementation evidence and remaining checks.
- `scripts/`: build, demo server, and automated checks.
- `demo/`: local development test page.

## Original contributions and attribution

The initial Safari Dev Lab scaffold was created on October 27, 2026 using Apple's extension packaging tools. The workspace dashboard, manual review controls, snapshot coordinator, recovery logic and AI validation helpers were added during the event on October 28.

[Tab Session Manager](https://github.com/sienori/Tab-Session-Manager) was reviewed as a reference. No source code from that project has been copied into this repository. Any future reuse will require attribution and compliance with its MPL-2.0 license.

Project source is released under the [MIT License](LICENSE). Apple's SDKs and development tools are separate dependencies governed by their own terms.

## Next milestones

1. Verify the manual Safari journey, including persistence and partial failures.
2. Verify backup downloads/import in Safari and improve recovery guidance.
3. Verify the integrated Meta connection and editable review against an actual configured account, with consent and the approved limits.
4. Measure grouping quality and restoration on realistic sessions, then document a reproducible judge setup.

## Safe dashboard preview

`node scripts/preview-dashboard.mjs` serves a development-only dashboard at http://127.0.0.1:8790 using fictional tabs, in-memory snapshots and a fake AI service. It cannot read or close actual browser tabs and makes no model requests. Use the normal Scan/New group controls to try group chips and dragging. Never enter real credentials into a preview. The preview is not proof of Safari extension integration.
