# Meta connection and editable review UI

## User flow

The manual dashboard, saved snapshots and JSON backup controls remain usable without an AI connection.

1. Open the dashboard through the Safari extension and scan a normal window. Include only tabs you intend to send; pinned/private/restricted tabs are excluded from AI input.
2. Under **Connect Meta suggestions**, follow the local service setup guide in `docs/meta-setup.md`. Pair the service with the exact dashboard origin shown. The pairing entrypoint is `node server/pair.mjs <exact-origin>` and startup is `node server/start.mjs` in the locally configured service environment. The coordinator/service workstream maintains the full setup instructions.
3. Enter the service's private **local pairing token** in the password field. This is not the Meta API key. The Meta key stays in the local service environment. The pairing token is held only by this page, never in extension storage or localStorage; disconnect/reload clears it. Editing the token disconnects the previous pairing until checked again.
4. Click **Connect & check status**. If supported, the extension explicitly requests optional access to `http://127.0.0.1/*`; the helper's actual fetch endpoint is fixed at `http://127.0.0.1:8788`. Denied access or unavailable/disabled service leaves manual work available. Status refreshes occur only after explicit user clicks and make no model call.
5. Inspect **Preview the exact model input**. It contains included tab IDs, titles and sanitized URL origin/paths. URL credentials, query strings and fragments are removed. Titles and paths can still be sensitive; this is not anonymization. No page excerpts are collected.
6. Check the consent box and click **Suggest with Meta**, then confirm the send dialog. A full suggestion uses token-count and generation attempts, both guarded by the service's persisted budget. Default limits of 2 attempts/minute and 20/day allow at most 10 full suggestions/day. The UI displays usage, reset and cooldown, but server-side enforcement is authoritative. This is not an account-wide or dollar cap.
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

Click a native chip button or the card's visible **Collapse/Expand** button to toggle its body. Both controls expose `aria-expanded` and `aria-controls`, accept Enter/Space, and keep focus on the replacement control after rendering. Collapsed cards retain their editable name, total/selected counts and an Expand affordance. Collapse state is page-local, survives rename/move/render operations and resets after a successful new scan. Removed groups lose their stale collapse state. Collapsing alone never changes tab assignments or invalidates a pending AI proposal.

Each eligible manual row has a dedicated draggable grip button. Drag the grip onto a group chip to move its dashboard assignment. Drop targets highlight only for an eligible internal drag to another current group. Protected/private/pinned/restricted rows do not get grips. Existing per-tab select menus remain the accessible move alternative. Moving a tab preserves its checked/unchecked state and other manual edits; a real assignment change invalidates an older AI proposal. Dropping onto the existing group is a no-op.

Drag/drop uses an opaque `application/x-safari-workspaces-tab` token plus page-internal state. The payload contains no URL or tab ID. Validation checks current scan generation/review revision, current source-group membership, eligible row identity, target existence, busy state and the drop token. External/wrong-token/stale/ended/protected drops are ignored; drops onto chips prevent default navigation. Old detached row handles also cannot start a new drag after a revision/scan change. These operations never call browser/storage/AI APIs and do not control native Safari Tab Groups.

### UI identifiers for the coordinator's isolated preview

- `#manual-review`: sticky strip boundary.
- `#group-chips`: labelled group-navigation strip.
- `#group-chip-<groupId>`: native chip button with `data-group-id` and total count.
- `#manual-group-<groupId>`: group card retaining its visible header.
- `#group-body-<groupId>`: hidden/expanded content associated with both toggles.
- `#group-toggle-<groupId>`: visible card Collapse/Expand button.
- `.drag-handle[data-tab-id]`: the only draggable manual-row element.
- `#group-chip-help`: visible explanation of local collapse/move and menu alternative.

Six added fake-DOM tests cover cross-group moves with exclusion retention/no API calls, total chip counts, collapse associations/persistence/keyboard/rescan reset, external/forged/invalid targets, protected/stale/ended drags, AI invalidation only on actual moves, and busy guards. They validate script event behavior, not a browser's physical drag gesture or CSS rendering. The root coordinator owns fictional-data visual preview verification; this UI agent performed no browser automation, Safari actions, session/window closing or Meta requests.
