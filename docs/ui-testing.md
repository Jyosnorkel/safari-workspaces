# Meta connection and editable review UI

## User flow

The manual dashboard, saved snapshots and JSON backup controls remain usable without an AI connection.

1. Open the dashboard through the Safari extension and scan a normal window. Include only tabs you intend to send; pinned/private/restricted tabs are excluded from AI input.
2. Under **Connect Meta suggestions**, follow the local service setup guide in `docs/meta-setup.md`. Pair the service with the exact dashboard origin shown. The pairing entrypoint is `node server/pair.mjs <exact-origin>` and startup is `node server/start.mjs` in the locally configured service environment. The coordinator/service workstream maintains the full setup instructions.
3. Enter the service's private **local pairing token** in the password field. This is not the Meta API key. The Meta key stays in the local service environment. The pairing token is held only by this page, never in extension storage or localStorage; disconnect/reload clears it. Editing the token disconnects the previous pairing until checked again.
4. Click **Connect & check status**. If supported, the extension explicitly requests optional access to `http://127.0.0.1/*`; the helper's actual fetch endpoint is fixed at `http://127.0.0.1:8788`. Denied access or unavailable/disabled service leaves manual work available. Status refreshes occur only after explicit user clicks and make no model call.
5. Inspect **Preview the exact model input**. It contains included tab IDs, titles and sanitized URL origin/paths. URL credentials, query strings and fragments are removed. Titles and paths can still be sensitive; this is not anonymization. No page excerpts are collected.
6. Check the consent box and click **Suggest with Meta**, then confirm the send dialog. A full suggestion uses token-count and generation attempts, both guarded by the service's persisted budget. Default limits of 10 attempts/minute and 200/day allow at most 100 full suggestions/day. The UI displays usage, reset and cooldown, but server-side enforcement is authoritative. This is not an account-wide or dollar cap.
7. Model output is validated with `WorkspaceCore.suggestions` before staging. The proposal panel is explicitly marked **Not applied**. Rename proposed groups, move tabs or choose **Leave ungrouped**, then **Accept reviewed suggestions** and confirm. Acceptance changes only the review; it never saves/closes/restores tabs or changes saved snapshots. Existing unchecked tabs retain their manual groups.
8. **Discard suggestions** leaves manual work unchanged. Manual edits or a new scan invalidate old candidates, and revision checks reject results/acceptance that raced with newer edits. Invalid responses and service failures preserve manual work; there are no automatic model retries or hidden status refreshes. Refresh local status explicitly after cooldown/errors when needed.

## Integration contract

The UI depends on the AI workstream's `extension/ai.js`, loaded before `dashboard.js`:

- `WorkspaceAI.status({token})` → `{ok: true, usage}`
- `WorkspaceAI.suggest({token, tabs, consent: true})` → `{ok: true, result, usage}`
- `result.groups` contains `{name, reason, tabIds}`; unassigned input IDs remain ungrouped.
- `WorkspaceAI.clientOrigin` is the exact local-pairing origin. If `location.origin` is `null` for Safari's extension scheme, use its protocol and host, not a blanket `null` origin allowlist.
- Errors expose `message`, optional `code`, `usage` and Unix-millisecond `retryAt`.
- Usage fields include `enabled`, `configured`, `busy`, `attemptsToday`, `remainingToday`, `remainingThisMinute`, `perMinute`, `perDay`, `timezone`, `dailyResetAt`, `retryAt`, and `requestsPerSuggestion`.

Manifest permissions, CSP loopback restrictions, native resource packaging and integrated version numbers belong to the coordinator. No provider credentials or remote Meta host permission belong in the extension.

## Automated evidence

`node --test tests/ui.test.mjs` passes 16 tests. These execute the real dashboard script with a deliberately fake DOM, tab coordinator and AI client. They do not launch a browser or perform network/Meta requests.

Coverage includes disconnected startup/no background requests, preservation of window snapshot/export controls, optional permission denial, connect-only status calls, consent/send-confirmation requirements, exact sanitized selected input, staged output, proposal renaming/moving/ungrouped assignment, acceptance preserving unchecked manual tabs, discard, invalid/network errors, no hidden retries/polling, manual/in-flight revision guards, token disconnect, disabled/busy/exhausted states, and acceptance cancellation.

The full `node scripts/check.mjs` passes 105 checks on this branch (including these 16). `git diff --check` passes.

## Still requires verification

No live Safari, CSS visual rendering, real local HTTP client or real Meta inference was tested by this UI agent. The fake DOM does not establish browser layout, permission prompts or native extension networking behavior. The service/packaging dependencies must be integrated and the coordinator must record actual end-to-end evidence separately. Current user safety instructions prohibit closing existing Safari windows/sessions or quitting Safari; this agent performed no browser actions.


## Draggable and collapsible manual group chips — October 31

The horizontal chip strip above manual groups shows each group's name and **total assigned tab count**, including unchecked/protected rows. It stays visible while scrolling within the manual-group section, then stops before saved workspaces.

Click a native chip button or the card's visible **Collapse** button to hide the entire card down to its chip. Both controls expose `aria-expanded` and `aria-controls` and accept Enter/Space. Collapsing moves focus to the replacement chip; clicking that chip expands the card with its editable name, counts and selections intact. Collapse state is page-local, survives rename/move/render operations and resets after a successful new scan. Removed groups lose their stale collapse state. Collapsing alone never changes tab assignments or invalidates a pending AI proposal.

Each eligible manual row has a dedicated draggable grip button. Drag the grip onto a group chip to move its dashboard assignment. Drop targets highlight only for an eligible internal drag to another current group. Protected/private/pinned/restricted rows do not get grips. Existing per-tab select menus remain the accessible move alternative. Moving a tab preserves its checked/unchecked state and other manual edits; a real assignment change invalidates an older AI proposal. Dropping onto the existing group is a no-op.

Drag/drop uses an opaque `application/x-safari-workspaces-tab` token plus page-internal state. The payload contains no URL or tab ID. Validation checks current scan generation/review revision, current source-group membership, eligible row identity, target existence, busy state and the drop token. External/wrong-token/stale/ended/protected drops are ignored; drops onto chips prevent default navigation. Old detached row handles also cannot start a new drag after a revision/scan change. These operations never call browser/storage/AI APIs and do not control native Safari Tab Groups.

### UI identifiers for the coordinator's isolated preview

- `#manual-review`: sticky strip boundary.
- `#group-chips`: labelled group-navigation strip.
- `#group-chip-<groupId>`: native chip button with `data-group-id` and total count.
- `#manual-group-<groupId>`: group card, hidden while collapsed.
- `#group-body-<groupId>`: hidden/expanded content associated with both toggles.
- `#group-toggle-<groupId>`: visible card Collapse/Expand button.
- `.drag-handle[data-tab-id]`: the only draggable manual-row element.
- `#group-chip-help`: visible explanation of local collapse/move and menu alternative.

Six added fake-DOM tests cover cross-group moves with exclusion retention/no API calls, total chip counts, collapse associations/persistence/keyboard/rescan reset, external/forged/invalid targets, protected/stale/ended drags, AI invalidation only on actual moves, and busy guards. They validate script event behavior, not a browser's physical drag gesture or CSS rendering. The root coordinator owns fictional-data visual preview verification; this UI agent performed no browser automation, Safari actions, session/window closing or Meta requests.

Coordinator polish: collapsing hides the entire group card so only its chip remains; the chip retains its count and is the keyboard-focus destination after collapsing from a card header. Expanding the chip restores the card with its original tab selections. Collapse is view-only and does not save/close/remove browser tabs. The real preview mouse drag and unchecked-tab preservation were verified in the internal browser with fictional data; Safari sessions and Meta were not used.

The final narrow-layout preview found an existing minimum-width overflow in saved-workspace cards; the <=600px layout now uses a zero-minimum single column for both groups and saved workspaces. Desktop group drag/collapse checks used a temporary 1200px viewport, restored afterward. The final preview remains sample data; no Safari session or API request was used.


## v0.21.1 themed settings choices and popup scroll — November 3

Replaced native expanded Appearance/Autosave menus in popup and webpage with shared themed keyboard-accessible choices. Original selects remain the saved-value source; unsaved choices do not apply settings. Menus show selection, support arrows/Home/End/type-to-match/Enter/Space/Escape/Tab, flip above lower triggers, and dismiss on outside click, focus change, resize or parent scroll. No extra provider calls. Shared palette fallback covers webpage hover.

Popup redraws skip unchanged scroll-position writes; empty live-group rendering also restores position. Explicit scroll restoration no longer competes with browser anchoring. Page switches still reset to top. Popup width fits narrower available viewports; no artificial smooth-scroll animation is added to wheel input.

246 automated fake-browser/provider checks pass; native v0.21.1/build46, strict signature and packaged UI/source comparisons pass. Root used the in-app browser with fictional tabs only: keyboard theme selection/save/reload, lower-menu flip/dismissal, 400px/480px layouts, Home/Settings/Organise/Snapshots navigation, snapshot save/expand, long-title scrolling and manual-group creation/redraw. Product design and themes reviewed light/dark and narrow expanded-menu screenshots. No horizontal overflow observed (480px popup main client/scroll width both465px). This is isolated preview evidence, not packaged Safari or real Meta testing. Safari was not controlled, quit or closed; no personal tabs or settings were changed. Actual Safari wheel/trackpad momentum remains user verification.


## v0.21.2 popup intrinsic-size regression correction — November 3

User screenshot after v0.21.1 shows a tiny blank Safari toolbar popover. Removed the new viewport-relative maximum width/height on html, restoring the prior explicit480×600 root sizing. A feedback dependency on Safari's provisional popup viewport is the suspected cause; no real Safari reproduction or corrected user result is established yet. Themed menus and main scroll fixes remain. Product design/themes reviewed the targeted sizing correction. Native v0.21.2/build47, strict signature and packaged stylesheet comparison pass. CSS-only fix; behavioral suite was not repeated (v0.21.1 recorded246 passing checks). Previous isolated preview evidence did not detect this Safari-specific sizing failure. No Safari control, app/service launch, window/tab closing or Meta requests occurred. User reopening verification remains required; narrow-browser preview is not popover sizing proof.


## v0.21.3 recovery to pre-chat UI — November 3

A second user screenshot shows wholly unstyled popup content after v0.21.2. Confirmed a root-introduced packaging error in v0.21.1: new settings-menu resources reused Xcode object IDs9/A already assigned to dashboard-pages.js and tab-selection.js. Those original scripts were absent from the package. This establishes a packaging regression; it does not by itself prove why Safari failed to apply popup.css, which was present. The earlier viewport-size diagnosis remains unverified.

Withdrawn the entire dropdown/scroll UI iteration. All extension files now match pre-chat commitf9862f1 byte-for-byte except manifest version0.21.3; Xcode resource declarations also match baseline, with build48/version changes only. New build preflight rejects duplicate object IDs, and postflight recursively compares all22 extension resources to source. Regression tests inject duplicate IDs and missing/stale packaged files. All248 automated fake-provider/browser checks, native build, strict signature and full resource comparison pass. Product design/themes reviewed rollback scope. No actual Safari visual recovery is claimed until user reopening verification. No Safari actions, tab/window closures, credentials access or Meta calls. Requested custom dropdown/scroll work is intentionally withdrawn pending recovery confirmation.


## v0.21.4 popup dropdown-only retry — November 3

User confirmed v0.21.3 restored the UI, then explicitly requested only themed dropdown selection. Popup Appearance and Autosave now use themed expanded choices with selected checkmarks, keyboard selection/cancel, outside dismissal and upward placement when needed. Logic/CSS are embedded in existing popup.js/popup.css: no new resources or project resource changes. Original native selects retain saved values; settings still apply only on Save. Popup layout, dimensions, scanning, scrolling and webpage remain unchanged. Product design/themes visually reviewed actual open light/dark menus from the fictional-data in-app-browser preview; keyboard choice/save, Escape and lower menu inspected. All248 automated checks, native v0.21.4/build49, strict signature and complete22-file packaged/source verification pass. No live Safari/Meta actions or personal-tab access. Actual packaged Safari menu rendering remains user verification.


## v0.21.5 staged dropdown event correction — November 3

User reports appearance recovered but clicking the settings dropdown opens nothing. Actual Safari inspection was attempted: the read-only app snapshot returned, but the subsequent click was rejected because user state changed; refreshed inspection failed screen-capture availability. No Safari click/navigation/toggle succeeded, and no real browsing inventory is retained in project files. The current failure's precise cause is not established.

Popup trigger now explicitly takes focus with preventScroll before opening. Menu scroll/resize handlers reposition rather than unconditionally dismiss; scrolling the trigger outside the pane still closes. Navigation explicitly closes menus. Selection/Save contract and theme/layout/CSS remain unchanged. Three new fake-DOM regressions cover focus, queued scroll/resize, cancellation, selection and dismissal. All252 automated fake-provider/browser checks pass. IAB pointer choice/save and menu persistence through480×600 viewport resize passed; Product design/themes visually reviewed open Light menu. This is not actual Safari evidence.

A separate signed resource-only candidate is prepared at build/candidates/v0.21.5/Safari Dev Lab.app using the existing compiled native binaries, updated plist version/build0.21.5/50 and current extension resources; no xcodebuild/native compilation or launch occurred. Strict deep signature and full22-file comparison pass. Read-only registration still points to active0.21.4 at its original path, and active disk plist remains0.21.4. Candidate activation is pending the explicit update question; do not report it installed or verified in Safari. No service/model calls or Safari tabs/windows closed.


## v0.21.5 approved registration and incomplete reload — November 3

User explicitly approved switching Tabby to the prepared v0.21.5 copy and reloading only the extension. Registered the completed candidate with Launch Services/PlugInKit, preserving the old app contents. PlugInKit's preferred version is0.21.5 at build/candidates/v0.21.5/Safari Dev Lab.app. Safari Settings visibly listed both0.21.4 and0.21.5. Root selected the new entry, confirmed0.21.5 and enabled status1, then disabled the old entry (status0). A further new-entry click had no observed state change. Automatic review rejected a coordinate reload attempt because its target was uncertain; that coordinate action was not executed. Subsequent checks confirmed0.21.5 enabled/0.21.4 disabled, but the Tabby toolbar button was absent. The temporary Safari Settings window was closed; no browser tabs/windows were closed or navigated. Native app-control connection then timed out when checking the containing candidate app. Do not claim a completed runtime reload or functioning packaged dropdown. Manual off/on of the verified0.21.5 entry and popup verification remain required. No uninstall, storage erasure, Safari quit/restart or Meta inference occurred. Candidate signature remains valid. Both registered app paths must now remain immutable during future builds. Local Safari-settings screenshot retained privately in /tmp only; no browsing inventories committed.
