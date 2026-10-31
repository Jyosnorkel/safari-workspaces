## v0.5.0 drag-and-drop verification

131 automated checks pass with fake browser/model APIs. Whole-row manual and staged AI dragging, grip ordering, file validation and simultaneous-drop suppression are covered. Background tests verify durable imports before new-window creation, file-order restore, partial failures and replay/interruption safeguards. Native build and strict signature checks pass. These tests do not establish actual Safari drag events, backup-file downloads or packaged new-window restoration. No Safari was controlled or closed. New restore windows retain their initial blank tab. Existing safety restrictions remain in force.

## v0.4.1 automatic origin repair

116 checks pass, including authentication/Origin restrictions, on-disk origin repair with the unchanged token and usage bytes, hotloaded external pairing changes, and the actual extension client with local HTTP and temporary configuration. Native 0.4.1/build8 is built at the normal app path and signed. The user must load this client and restart only the local AI service once to activate the new protocol. Thereafter Connect/status checks and pre-suggestion handshakes update a changed actual Safari UUID origin without manual file edits or service restart. The local token remains required. The protocol's real Safari activation has not been independently verified; no model calls were made in this iteration.

---

## v0.3.1 user-reported connection issue

The paired and displayed dashboard origins matched, but the user received origin_denied on status. The actual incoming browser Origin was not captured. Client status now uses POST JSON rather than GET, keeping strict origin/token validation, and the server returns clearer missing/opaque/mismatched-origin diagnostics. All 96 automated checks pass; the normal-path native app is v0.3.1/build6 with a valid signature. No Safari interaction or real model requests occurred during the patch. Live confirmation is pending after the user refreshes the service and extension; no Safari quit/session closure is needed.

---

## v0.3.0 integration evidence — October 30, 2026

94 automated checks pass, including 32 fake-provider AI cases, 10 fake-DOM dashboard review cases and the actual extension-client/local-HTTP/fake-provider contract. Native v0.3.0/build5 and strict signature verification pass; the packaged AI client matches source. No Safari interaction or real Meta requests occurred during this integration.

The next browser gate is an explicitly requested local status connection, which costs no model attempt, to verify Safari's actual localhost permission and Origin header. The service requires one exact paired origin and bearer token; the Node HTTP contract injects Origin and does not prove this Safari behavior. Do not weaken authentication to bypass an integration failure. Live model access then needs configured opt-in and data-sharing consent. Current sessions/windows must stay open and Safari must not quit.

---

## Current safety override — October 30, 2026

The user prohibits closing any current window or quitting Safari. Historical test plans below do not authorize teardown, restart or save-and-close tests now. The new harness in `scripts/safari-backup-smoke.mjs` leaves its fresh session/window and driver alive, writes a private connection file in the temporary folder, rejects DELETE commands, and refuses navigation unless its initial automation session has exactly one blank tab. Do not rerun it to create more sessions when a retained session already exists.

A fresh SafariDriver window opened separately from the observed personal window. Two temporary extension loads returned success, but their content/background test scripts did not produce a dashboard. Native extension execution remains unverified; a help request was sent to the user. No session/window DELETE, Safari quit, driver termination or actual-tab save-and-close was invoked.

`node scripts/safari-backup-ui.mjs /absolute/private/session.json` reuses only a single disposable localhost test tab. It exercises the real dashboard/core/coordinator JavaScript in Safari with **simulated extension APIs and sample tabs**, not the installed extension. The DOM handler test passed: three sample web tabs (including one pinned tab and a duplicate URL) were snapshotted and exported; importing the export produced a second saved snapshot. Its programmatic DOM clicks do not prove physical interaction, extension integration or that Safari completed a backup file download. Physical WebDriver clicks were inconsistent and a captured screenshot was blank; do not label visual testing passed. No personal inventories or test connection files belong in Git.

Version 0.2.3: 68 automated checks pass; native build in a separate temporary output directory and strict signature verification pass. The already-loaded native app was not rebuilt/reloaded, and its permissions were not changed.

---

# Safari integration verification

## Code-level findings

The manifest declares `popup.html` as the toolbar action popup and non-persistent background scripts. The Xcode extension resource phase references the popup, dashboard, shared rules and background files. No missing resource reference was found in the inspected project.

The popup originally reused only the exact dashboard URL. After navigating within the dashboard to `#saved`, clicking the toolbar's manager button could create another manager. The updated popup matches the extension origin and dashboard path, ignoring query/hash navigation, and prevents concurrent launch handlers from creating two managers. It also rejects private/non-normal/invalid windows before querying tabs and leaves launch failures visible for retry.

These changes do **not** establish the cause of the reported Safari toolbar click that displayed no popup. The click handler runs inside the popup; it cannot fix a popup that Safari never displays. An outdated extension process, extension settings, loading error or Safari-specific behavior remains to be investigated with live evidence.

## Automated checks

```sh
node --test tests/safari.test.mjs
node scripts/check.mjs
```

Nine focused tests simulate popup/host APIs and check packaged resource references. The original shared check command runs the workspace tests; verify that the integrated runner discovers all `tests/*.test.mjs` files before reporting combined results.

## Live investigation — October 28, 2026

The user authorized this agent to control Safari exclusively for a separate disposable test window. A fresh normal window was created containing exactly one `https://example.com` tab. No personal browsing tabs were closed or modified.

Observed results:

- The freshly built native host opened. Its Safari extension state eventually reported enabled.
- Safari Settings → Extensions listed Safari Workspaces **0.2.0**, while the current manifest is **0.2.1**. Its visible error was: “Unable to validate ‘popup.html’ with the extension’s code signature. It has probably been modified since the extension was built.”
- Both the main app and isolated agent app passed `codesign --verify --deep --strict`; this does not establish which cached build Safari was using.
- Refreshing only Safari Workspaces by toggling it off/on produced an alert saying the extension was no longer valid. Safari then removed it from the visible Extensions list.
- Developer settings showed **Allow unsigned extensions** unchecked. This agent did not change that security setting, broad website access, or private browsing access. User action to enable unsigned development extensions is required before continuing.
- Two local registrations shared native version 1.0. The agent build now increments native version to **1.0.1 (build 2)**, preserving bundle identifiers. The isolated rebuild passed. Whether Safari reloads that version is not verified yet.

The native host now displays actionable extension-state/settings errors rather than silently ignoring them. It keeps the host open if Safari cannot open extension settings, and safely ignores unexpected native-message types.

**Still unverified:** popup rendering, dashboard launch/reuse, scan, save/close, restore and restart persistence in the fresh test window. The observed signature/development setting failure blocks those steps. This is not a successful end-to-end run.

## Coordinator's live test plan

Use a separate normal Safari window with only disposable tabs. Do not scan, close or modify the user's main browsing window.

1. Integrate the branch, run the checks, then build the main checkout with `./scripts/build.sh`. Launch the freshly built native host app. Record the manifest version and build commit being tested.
2. Open Safari Settings → Extensions and verify the enabled extension is Safari Workspaces. If Safari still shows an earlier installed build, toggle the extension off and back on, then reopen the toolbar popup. Do not remove the app/extension or erase its storage to force a reload.
3. Open a disposable HTTP(S) test tab and click the Safari Workspaces toolbar button. If Safari asks for website access, the user can grant temporary access for that test website. Avoid broad all-website access solely to run this test.
4. Click the toolbar button again after the website-access prompt closes. Verify the popup itself appears. Capture its visible version and any error text. If it still does not appear, stop at this loading issue; do not describe subsequent dashboard behavior as verified. Inspect Safari's available developer diagnostics and report the actual failure rather than assuming the popup click handler ran.
5. In the popup, click **Open workspace manager**. Verify one dashboard appears in the same normal window, with a clear Safari connection status.
6. Navigate to **Saved workspaces** (`#saved`), return to a disposable website tab, reopen the toolbar popup, and click **Open workspace manager**. Verify it focuses the existing manager rather than adding a second manager.
7. In a private window, the popup must show private-browsing guidance and create no dashboard. If Safari does not permit the extension in private browsing, record that outcome instead; do not enable private access just to run this test.
8. Follow the separate workspace/persistence acceptance flow only after launch succeeds. Record tab counts, group edits, save/close outcomes and restore outcomes without publishing real browsing data.

Report each step as passed, failed or not attempted. Restart persistence remains a separate verification; toggling/rebuilding the extension is not proof that Safari restart persistence works.
