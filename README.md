# Safari Workspaces

A macOS Safari Web Extension for turning browser tabs into focused, reusable workspaces.

Built for the Meta Global AI Developer Hackathon, October–November 2026. This is an early development build, not a production release.

## Product goal

Scan tabs → get meaningful Meta AI group suggestions → review and edit → save and close a group → restore its URLs later.

## Current implementation

- A toolbar popup opens the workspace dashboard in the current normal Safari window.
- Scan available tab titles and URLs; exclude private tabs and leave pinned and restricted tabs untouched.
- Create and rename groups, move tabs between them, and exclude individual tabs.
- Save an entire window without closing tabs, including pinned web URLs.
- Export versioned JSON backups and preview/import them without replacing existing snapshots or opening tabs; see [backup format](docs/backup-format.md).
- Save ordered URL/title snapshots to local extension storage, with persistent IDs and timestamps.
- Write and read back snapshots before closing selected tabs; recheck live tab URLs before closing.
- Track partial restoration and provide controls for uncertain results after an interruption.

**Meta integration is not implemented yet.** The suggestion button is disabled. Input sanitization and response-validation helpers exist, but no model requests are made. No API credentials are required to try the manual workflow.

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

For a local HTTP test page:

```sh
./scripts/serve.sh
```

Open http://localhost:8765/ in Safari. The existing test page still describes the earlier development demo; use it as a disposable web tab.

## Verification status and known limitations

- The native 0.2.2 build and strict code-signature verification passed on October 30, 2026.
- Live Safari popup rendering and current-window scanning were verified. A live storage-verification failure was reproduced and fixed with regression coverage; full save/close/restore retesting and restart persistence are **not yet verified**.
- `node scripts/check.mjs` passes 68 automated checks for the workspace coordinator and domain rules using a simulated browser API. Syntax and manifest resource checks are included. These do not replace Safari testing.
- Completed snapshots support an explicit **Restore another copy** action. New restore sessions are protected against replayed requests and stale dashboards.
- Unsaved forms, browsing history, scroll position and complete page state are not saved. Restoration reopens URLs only.
- Groups live in the extension dashboard. Native Safari Tab Groups are not controlled.
- Current scope is one normal Safari window; no accounts, cloud sync or App Store distribution.

## Privacy and AI plan

Workspaces are stored locally in Safari extension storage. The current code sends no browsing data to a remote service. Saved snapshots contain full URLs, which can contain sensitive query parameters; treat local snapshots accordingly.

Future Meta inference will require explicit disclosure of the data being sent and a credential arrangement that keeps shared secrets out of the extension. Planned model input uses titles and URLs with credentials, queries and fragments removed. Titles and paths can still contain sensitive information. Model output will be treated as suggestions, validated against existing tab IDs, and never used as a source of restoration URLs.

## Source layout

- `extension/`: popup, dashboard, browser operation coordinator and domain rules.
- `native/`: Swift macOS host and Safari Web Extension target.
- `scripts/`: build, demo server, and automated checks.
- `demo/`: local development test page.

## Original contributions and attribution

The initial Safari Dev Lab scaffold was created on October 27, 2026 using Apple's extension packaging tools. The workspace dashboard, manual review controls, snapshot coordinator, recovery logic and AI validation helpers were added during the event on October 28.

[Tab Session Manager](https://github.com/sienori/Tab-Session-Manager) was reviewed as a reference. No source code from that project has been copied into this repository. Any future reuse will require attribution and compliance with its MPL-2.0 license.

Project source is released under the [MIT License](LICENSE). Apple's SDKs and development tools are separate dependencies governed by their own terms.

## Next milestones

1. Verify the manual Safari journey, including persistence and partial failures.
2. Verify backup downloads/import in Safari and improve recovery guidance.
3. Connect a real Meta model and add editable suggestion review.
4. Measure grouping quality and restoration on realistic sessions, then document a reproducible judge setup.
