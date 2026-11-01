# MVP goals and evidence

The local build-guide webpage is the planning reference (`project-guide/dist/index.html`, served at http://127.0.0.1:8787). This table maps its original product goals to implementation evidence. Organiser source copies remain private; this file contains our own development plan.

| Webpage goal | Evidence at v0.8.0 | Next acceptance step |
| --- | --- | --- |
| Scan and organise | Manual dashboard, sticky chips, drag grips, collapse/expand and validated inventory | Verify packaged extension in a disposable Safari window |
| Real Meta suggestions | Official Meta adapter, authenticated loopback service, durable usage guard and client integrated; fake-provider/client HTTP tests pass | User reports useful real Meta grouping; continue quality measurements |
| Review corrections | Editable staged proposals, drag-to-chip corrections and explicit acceptance; fake-DOM tests plus fictional-data browser interactions pass | Verify actual Safari rendering and a consented real response |
| Save before closing | Verified local writes, navigation checks, recovery journal tests | Full live flow still unverified; current user prohibition prevents close tests |
| Resume reliably | Ordered URL restoration, pending recovery, deliberate new sessions | Live restore checks and restart persistence pending; no Safari quit allowed |
| Window backup (user-added MVP goal) | Non-closing whole-window snapshots, JSON export/import; 176 total automated checks and native build/signature pass | Verify actual Safari download file and import; sample-API DOM test passed |
| Reproducible setup | Native build script and manual instructions | Authenticated automatic origin refresh and file hotload implemented/tested; native resources verified; new Safari activation remains pending |

Current priorities: verify actual Safari-to-service status without a model call, then a consented real suggestion and safe snapshot/backup behavior, then measure grouping quality. Optional excerpts, notes and other extras follow the working core.

Safety constraint: do not close current Safari sessions/windows, delete WebDriver sessions, terminate the retained driver, or quit/restart Safari. No personal tab inventory goes into tests, GitHub or AI requests. Browser verification must distinguish sample APIs, actual extension execution, and actual model inference.

Approved API defaults: one in-flight suggestion; two outbound attempts per rolling minute; twenty per UTC day; no retries. Separate remote token counting counts as an outbound attempt too. Explicit user consent is required for sending sanitized tab metadata. No key belongs in the extension or repository.

## v0.5.0 drag-and-drop iteration — October 31

Eligible tab rows can be dragged onto manual group cards/chips, and AI proposal rows can be dragged between proposal cards before explicit acceptance. Grips reorder dashboard/snapshot tabs, with Option+Up/Down on manual grips. These controls do not rearrange Safari's native tabs. A JSON file dropped anywhere on the dashboard is fully validated and durably imported before one new normal window is created; URLs restore in file order with per-tab recovery. File-picker import stays save-only. Existing windows remain untouched. Interrupted/replayed operations do not automatically create another window.

131 automated checks pass using fake browser/model APIs, including file drops, forged/stale drags, ordering, write failures, duplicate requests and partial restoration. Native build/signature verification passes. Actual packaged Safari file dropping, physical drags and new-window restoration remain unverified. No Safari interaction or live model requests occurred in this iteration. One initial blank tab is retained in the new window; no tab/window cleanup occurs.

Toolbar popup follow-up v0.5.1: manually opening the small popup exposes a backup drop area using the existing background reload operation. 134 automated checks pass; native build/signature pass. Real Safari popup focus/drop behavior still needs verification. Backup backend unchanged.

## v0.6.0 clearer actions and inventory refresh — October 31

Toolbar popup now leads with Save snapshot, AI organise and Refresh tabs. Slogans removed; dashboard AI connection/data settings collapsed until needed. Snapshot invokes existing non-closing window save. AI action opens setup/review without inference. Inventory refresh runs on popup/dashboard opening and every five minutes while dashboard is visible, skips edits/drag/busy state, preserves stable groups/exclusions/order and leaves changed/new tabs ungrouped. Changed inventories invalidate stale AI proposals and consent; unchanged inventory preserves them. No recurring model/status calls.

140 automated checks pass. Fictional-data internal-browser preview verified popup layout/counts, saving snapshot and opening dashboard AI settings. Native build/signature and packaged resource comparisons pass. Actual Safari popup actions, cross-page messages and timers remain unverified. Backup restore backend unchanged. No Safari control, closing or live inference occurred.

## v0.7.0 live workspace switcher — October 31

Toolbar popup lists live current-window groups with counts and expandable tab lists. Clicking a group activates its last-used available tab; clicking a tab activates that existing tab. No URLs are reopened and no tabs/windows move or close. Manual edits and accepted AI groups publish to a separate local browser-session registry; proposals remain staged. Dashboard reopening hydrates names/order/exclusions. Session storage is preferred, with local storage + browser startup reset as fallback. This registry does not replace durable snapshots.

Full input validation, compare-and-swap edit revisions, live identity/window/URL/protection checks and last-used tracking protect switching. Ordinary metadata pruning does not create false competing-editor conflicts. Failed writes and competing edits preserve the dashboard review; an explicit confirmed Load shared groups action handles recovery.

161 automated checks pass, including actual popup/coordinator integration with fictional tabs, stale activation, storage failure, startup reset, publishing, hydration and conflict recovery. Fictional-data internal-browser test verified dashboard-to-popup groups, expansion, tab selection and group switching. Native 0.7.0/build12, strict signature checks and packaged script comparisons pass. Actual Safari activation/events/session lifetime remain unverified. No Safari was controlled and no model calls occurred.

## v0.8.0 cluster real Safari tab order — November 1

Explicit Cluster tabs in Safari previews reviewed manual/accepted AI groups then asks confirmation before same-window tabs.move calls. Named groups come before Ungrouped within each contiguous checked, eligible span, following review order. Pinned, unchecked, restricted, navigating, dashboard and unassigned tabs are fixed boundaries, so some groups may remain split. Dragging/AI acceptance alone never rearranges browser tabs.

A read-back-verified session journal saves before/target orders and move steps before movement. Every move rechecks the full window topology, group revision and target tab identity/URL/index/protection. Failures stop, uncertain progress is labelled, and repeated/interrupted requests never resume automatically. Undo previews an inverse plan only for an unchanged completed result. No opening/closing/reloading or cross-window movement. Existing backup behavior unchanged.

176 fake-browser/model checks pass, covering confirmation/cancellation, staged AI, anchors, stale topology, failed writes, partial moves, replay/concurrency, corrupt journals and undo. Internal-browser fictional-data preview checked confirmation, apply and undo; no real Safari tabs were moved. Native 0.8.0/build13, signature and packaged script checks pass. Actual Safari tab movement, session interruption and undo remain unverified.

## v0.8.1 wider toolbar popup — November 1

Popup preferred dimensions increased from 360 px wide to 480 × 600 px. Save snapshot and AI organise sit side by side. Root dimensions are declared before content arrives; the body adapts to a constrained viewport and the content pane owns vertical scrolling beneath a fixed layout header. Removed nested scrolling from the workspace list. Fictional-data browser preview expanded eight sample tabs, measured no horizontal overflow, and reached the scroll bottom (425 px scroll offset, 959 px content / 534 px viewport). Existing functionality was unchanged. Native build/signature and packaged CSS comparison pass. Safari's actual native popup geometry remains unverified; no Safari control or model calls.
