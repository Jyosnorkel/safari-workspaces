## v0.10.2 native editing shortcuts — November 1

User reported unavailable copy/paste in desktop setup. The storyboard lacked an Edit menu. Added standard first-responder Undo/Redo/Cut/Copy/Paste/Select All actions and keyboard equivalents. Secure key entry remains NSSecureTextField. Native v0.10.2/build18 and strict signature verification pass; actual native shortcut interaction remains user verification. No credentials read, app/service launch, Safari control or Meta calls occurred. Behavioral suite was not repeated for this menu-only change.

## v0.10.1 launch-signature correction — November 1

The user supplied a v0.10.0 launch crash: dyld rejected the separately signed debug dylib under hardened library validation. Disable Xcode debug dylibs for app/extension configurations and reject debug-dylib dependencies before service bundling. Hardened runtime stays enabled. Native v0.10.1/build17, strict signature verification and developer ZIP packaging pass; the host executable has no debug-dylib dependency. All 205 automated fake-provider/browser checks pass. The prior signature-only check did not establish launchability. Actual app launch, Keychain and Safari remain unverified; no app/service launch, Meta request or Safari control occurred for this fix.

## v0.10.0 desktop setup and bundled service — November 1

Native onboarding replaces terminal startup with secure Keychain entry, explicit AI opt-in, Start/Stop, Safari settings/status and a separate connection-token copy button. Reopening the app starts AI only after prior opt-in. Window close keeps the host running; quit stops only its own helper. The bundled runtime and service use the existing pairing and usage ledger; corrupted files and occupied ports fail safely. Manual pairing-token paste into the popup remains required. No login item is installed.

205 fake-browser/provider automated checks pass; ten desktop/local HTTP checks also pass under the bundled Node runtime. Native v0.10.0/build16 and strict signature verification pass. A developer ZIP is packaged. This is **not a public-ready signed download**: Developer ID, notarization, independently verified per-architecture runtime, clean-Mac installation, Keychain/UI and actual Safari/provider verification remain gates. No real keys, app launch, Safari control, inference or window closure occurred. See [release plan](release.md).

## v0.9.0 AI inside the toolbar popup — November 1

The popup now connects to the existing local AI service, previews selected sanitized metadata, requests explicit sharing consent, and offers editable group names and tab assignments before acceptance. No workspace-manager visit is required. Existing groups remain unchanged until acceptance; stale proposals are rejected. Background request coordination retains staged results when the popup is dismissed, with no inference retry. Optional browser-session pairing stores only the separate pairing token in session storage; the provider key stays in the service. Refresh status is explicit, and existing request limits remain unchanged.

198 automated fake-browser/model checks pass. Fictional-data browser preview verified connection, generation, renaming, moving a tab and acceptance into the popup switcher. Native v0.9.0/build15 and packaged resources pass. Actual packaged Safari popup lifecycle and real Meta calls remain unverified. No real Safari control, tab/window closure or live inference occurred.

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

## Tabby visual theme — November 1 (branding PR)

Visible app/extension branding is Tabby. The approved three-window silhouette now uses pale folder-blue faces with restrained glass edge accents, retaining red/yellow/green window controls. Dashboard, popup and native activation page use cool white/pale-blue surfaces, sky-blue actions and dark blue text; warning/error colours remain distinct. Bundle/storage/backup identifiers and build paths stay compatible. Earlier icon versions and generation prompt history are preserved under assets/branding.

All 176 fake-browser/model checks pass. Fictional-data internal-browser preview verified dashboard/settings and popup appearance, loaded icons, no horizontal overflow and the popup's scrollable main pane. Native build, strict signature and packaged theme/icon comparisons pass. Actual Safari appearance remains unverified. No Safari control or live Meta calls occurred. This is an isolated branding iteration for coordinated integration, not a tagged release.


## User-approved stable popup baseline — November 1

The user accepted the integrated v0.10.2/build18 plus latest Tabby visual theme as the preferred stable, user-friendly baseline. Keep ordinary tab review, local pairing-token entry, AI suggestions, corrections and acceptance inside the toolbar popup; do not require an additional manager window for that workflow. The desktop setup window remains available for initial provider-key setup. Future changes should preserve this popup-first behavior.

Integrated verification: 205 automated fake-browser/provider checks pass, native build and strict signature pass, and all packaged extension resources match source. macOS registration was reduced to the integrated v0.10.2 package, removing the older branding-only v0.8.1 registration. User confirmed the resulting version is good. This acceptance does not establish every outstanding Safari/recovery/distribution release gate. Preserve all existing Safari safety restrictions.


## v0.11.0 popup row dragging — November 1

Confirmed live workspace rows can be dragged anywhere on the row to another group, or dropped above a row to reorder. Group headers append; empty groups stay available as destinations. Uses existing revision-checked, live-identity-validated publication and preserves exclusions. Expanded groups survive redraw. No native tab movement, opening, closing or Meta requests. User-approved v0.10.2-stable-popup tag remains available. Automated row-event tests cover cross-group movement, ordering, exclusion/revision preservation and external-drop rejection. Actual Safari pointer drag remains unverified.


## v0.12.0 direct popup organisation — November 1

User explicitly removed the popup AI review requirement. Popup requests now opt into validated automatic application after sharing consent; stale inventory/revisions preserve existing groups. Background completion applies even if popup is dismissed, without inference retries. Dashboard review behavior remains unchanged. Popup supports named manual groups, removal to Ungrouped, and a blue insertion line above row drop targets. No real Safari movement/closure or live inference used for verification.


## v0.13.0 popup navigation and settings — November 1

Home/Organise/Snapshots navigation stays inside the popup. Header settings offers system/light/dark appearance, bounded grouping preferences, compact rows, and optional interval-based snapshot-on-popup-open (not background autosave). Snapshot summaries show timestamp, tab count and site count; tab details expand on demand. Grouping preferences flow through the authenticated guarded service into the Meta prompt and token counting; no automatic inference. Service/client update needs local service restart to accept preferences. Real Safari visual/settings interaction remains unverified.


## v0.13.1 popup snapshot export — November 1

Expanded snapshot cards include Export JSON using the existing validated versioned portable backup operation. Duplicate clicks are disabled, failures remain visible, and export does not open/close tabs or alter snapshots. 208 automated checks and native build pass; actual Safari popup download remains unverified.


## v0.13.2 Safari export URL correction — November 1

User screenshot confirms popup blob export failed with WebKitBlobResource:1. Popup and manager export now use fully URI-encoded application/json data URLs, avoiding temporary extension blob URLs. No downloads permission/API added (Safari unsupported). 208 checks pass including JSON/Unicode download encoding; native build/signature pass. Actual Safari download with replacement remains unverified; no personal browser tabs touched.


## v0.13.3 direct Downloads export — November 1

Export now delegates validated backup JSON to the native extension via nativeMessaging. Handler bounds/parses data, generates a unique filename, writes without overwriting to Downloads, and reads back bytes before success. No browser navigation/download links or full-content logs. Extension has verified Downloads read/write entitlement. 209 fake-browser/provider checks, native build and signature pass. Packaged Safari/native messaging and real Downloads destination still require live verification; no claim of an actual file export yet.


## v0.13.4 flat popup controls — November 1

Checked Apple Liquid Glass documentation: native SwiftUI glassEffect is not a supported CSS material for this HTML extension popup. Removed imitation inset glints, native button bevels and decorative shadows; retained functional insertion lines/focus indicators. Improved dark/system-dark contrast, small control targets and full group-name tooltips. Fictional-data internal-browser Home/Settings navigation and system-dark appearance inspected; 209 automated checks/native build pass. No retained isolated SafariDriver session located; no real Safari UI actions, tabs or windows touched. Actual packaged Safari visual verification remains open.


## v0.13.5 anchored navigation and unified themes — November 1

Popup page switches reset the scroll pane to top; sticky navigation remains visible. AI panel no longer scrolls itself into view and token/consent focus uses preventScroll. Theme palette covers popup surfaces, forms, notes, snapshots, drag states and AI actions. Dashboard loads the same local appearance preference and responds to settings changes; decorative glints removed while functional drop/focus markers remain. 209 automated checks include navigation scroll-reset regression; native build/signature pass. Actual packaged Safari appearance remains unverified; no personal Safari interaction.


## v0.13.6 navigation clarification — November 1

User clarified navigation need not stay visible. Removed sticky positioning; navigation scrolls normally. Page-switch scroll reset and preventScroll focus remain. Native build/signature pass; CSS-only behavior change, automated suite not repeated.


## v0.13.7 popup focus palette correction — November 1

User screenshot identified leftover green token-field focus outline. Replaced old popup AI green focus/accent/border/fill literals with the blue palette and added a shared accessible focus-visible rule. Native build/signature pass; actual Safari focus appearance requires confirmation. CSS-only change, behavioral tests not repeated.


## v0.13.8 simplified popup Home — November 1

Snapshot primary-button subtitle now uses dark accent text on blue in both themes. Live group controls and manual creation appear only in Organise. Removed the separate manager action from Home; the keyboard-accessible Tabby header button opens/reuses the full webpage through the existing manager route. Backup drop remains on Home. 209 automated checks, native build/signature pass; actual Safari appearance remains user verification.


## v0.13.9 popup scroll and input compatibility — November 1

User reports Organise scroll snapping and Logitech gesture interference. Preserve scroll across AI-state and live-group redraws; page switches still deliberately reset to top. Removed automatic token/password-field focus, retaining explicit secure entry. Source audit found no global event taps, mouse/keyboard hooks or Accessibility interception. Gesture cause remains unverified, not a compatibility certification. 210 automated checks cover state-refresh scroll preservation and no password autofocus; native build/signature pass. Real Safari/Logitech reproduction remains needed; no system security settings changed.


## v0.14.0 popup quality-of-life — November 1

Three concurrent field agents verified Meta preferences, backup validation and themes. Preferences travel beside tabs through guarded transport into both token-count and generation payloads (fake transport test, no real inference). Provider instructions explicitly acknowledge bounded preferences; updated service must restart to use latest prompt. Snapshot cards/rows/export match Organise surfaces. Home actions now share neutral fill/text/subtitle colors. Permanent drop box removed; a noninteractive full-popup file-drag overlay appears on all views. Whole-file validation precedes backend import/restore; invalid formats show clear feedback, internal row drops unaffected. Valid drops retain existing restore-to-new-window semantics. Fictional-data in-app-browser snapshot/save/expand visuals inspected; no actual Safari session touched. Actual packaged Safari drag/native export/live Meta remain separate verification gates.


## v0.14.1 parallel UI polish — November 1

Themes/frontend, snapshot presentation and Meta UI review ran concurrently. Larger supporting text/control targets, clearer spacing/focus, readable snapshot dates and separate count lines, hostname detail rows with full URL tooltips. Group creation explains blank-name errors; deletion tooltip explains Ungrouped destination. AI wording matches direct application and consent explicitly includes saved preferences. 214 checks and native build/signature pass; fictional-data in-app-browser Organise visuals inspected. No real Safari/Meta or personal tab interactions.


## v0.14.2 compact snapshot actions — November 1

Export appears at the right of collapsed snapshot headers as a separate sibling control, avoiding disclosure toggling. Small outside-card delete hides records through verified durable trashedAt; immediate Undo restores them. No permanent purge. Active close/restore records reject deletion, failures preserve data and leave tabs untouched. Automated checks cover backend write/readback/replay/undo; actual Safari layout remains unverified.


## v0.14.3 group header interaction — November 1

Whole group header toggles expansion with keyboard-accessible aria-expanded/controls; separate disclosure arrow removed. Group-header clicks no longer activate a Safari tab; individual tab clicks retain activation. Small delete sits outside the card surface and still moves members to Ungrouped. 216 automated checks/native build/signature pass; actual Safari layout remains unverified.


## v0.15.0 manual scan inventory and saved-tab opening — November 1

Popup scan calls trusted live-groups-sync-scan to place eligible new/changed identities in Ungrouped while preserving existing manual groups/order/exclusions. Membership changes update CAS revision; protected/private/pending tabs excluded. Snapshot summary uses inline date/counts (tabs includes duplicates; sites means distinct hostnames). Snapshot rows open stored validated URLs in current normal window, never caller URLs; persistent admission/readback/replay guard prevents uncertain retries. Snapshot data unchanged. Known limitation: saved-tab opening ledger fails closed after 500 admitted requests; no unsafe history eviction. 220 automated checks/native build/signature pass; actual Safari scan/drag/open behavior remains user verification.

### November 1 — v0.16.0 Home search

Home lists the latest scanned tabs with local title/website search. Click or use arrow keys and Return to switch existing tabs after identity revalidation. Cmd+F or slash focuses search; requested Safari popup shortcut is Cmd+Shift+K (customizable in Safari 26 extension settings; actual dispatch remains unverified). 222 automated checks and native build/signature pass. Fictional-data browser inventory inspected; actual packaged Safari shortcuts/search remain user verification. No windows/tabs closed or live inference made.

### November 1 — v0.16.1 Home layout correction

Shared-theme search field and constrained Home tab grid fix reported native-looking input and clipped right edges. Fictional-data480×600 visual/DOM inspection confirms matching colors, full card edges and no horizontal row/list overflow. Native build/signature pass; actual packaged Safari appearance remains user verification. Behavioral suite unchanged from222 passing checks.

### November 1 — v0.16.2 left-hand shortcut

Open Tabby default is now Cmd+Shift+X. Design review confirms left-hand reach. No matching standard action listed in Apple's Safari shortcuts; custom assignments can still conflict and real command dispatch remains unverified. Native build/signature pass; existing Safari shortcut customizations may need manual adjustment.

### November 1 — v0.16.3 popup toggle

User-requested Cmd+Shift+F replaces the prior default. Popup handles the same keys to close itself, before Cmd+F search matching, including during busy background operations. Design review and222 checks/native build/signature pass. Apple's Safari list has no listed assignment (Finder uses Recents separately); custom conflicts and actual packaged Safari open/close dispatch remain unverified.

### November 1 — v0.17.0 webpage feature parity

Popup capabilities mirrored into webpage: current-tab search/activation, shared editable settings, preferences in Meta payloads, direct AI application option, session pairing, whole-row reorder/insertion markers/header collapse/outside group deletion, compact snapshots/export/delete Undo/single saved-tab opening. Existing webpage restore/recovery/clustering retained. See FEATURE_PARITY.md for mapping and honest popup-only gaps in the reverse direction. 229 fake-browser/provider checks and native build/signature/package comparisons pass. Product design/themes reviewed fictional desktop/480px visuals; actual Safari/Meta verification remains open.

### November 1 — v0.18.0 separate webpage views

Sidebar now switches Home/Organise/Snapshots/Settings, showing one functionality area at a time without losing edits. Legacy links, browser history, scroll reset and search-to-Home are supported. 231 automated checks/native build/signature/package checks pass. Product design/themes reviewed fictional desktop pages; actual packaged Safari verification remains open.

### November 2 — v0.19.1 selection appearance

Removed automatic first-row cursor highlight and selected left stripe across popup/webpage; retained explicit selection and insertion markers. Settings dropdowns share theme tokens and control shape. 241 checks and native build/signature/package comparisons pass. Design CSS review completed; visual browser unavailable, actual Safari open-menu appearance still needs confirmation.


### November 2 — v0.20.0 request headroom and drop position

User-approved defaults increased to10 attempts/minute and200/day, retaining single-flight/no-retry/persistent accounting. Service restart required; explicit manual overrides preserved. Full-width insertion line and inward endpoint triangles replace card traces in popup/webpage; nested targets no longer show overlapping positions. 243 checks/native build/signature/package checks pass. Design source review done; visual browser unavailable, actual Safari marker verification remains open.


## v0.21.0 AI alongside manual organisation — November 2

AI input now contains only included ungrouped tabs, with bounded existing group names/counts and saved preferences as context. Grouped titles/URLs are excluded. Exact case-insensitive unambiguous name matches append to existing group IDs, preserving members/order/exclusions and empty manual folders; ambiguous names create a separate group. Both popup and webpage implement this behavior. Revision and identity guards still reject concurrent changes rather than overwrite edits; older reviews containing grouped tabs are rejected. Service validates context and includes it in byte/token bounds; no retries or additional model calls. Local service restart required for the new request contract.

244 automated fake-provider/browser checks passed before final packaging. Product design/themes reviewed fictional-data480×600 light and system-dark popup screenshots including long names, expanded input, disclosure and compact action; no clipping observed. Native build, strict signature and packaged backend/provider comparisons passed. Actual Safari/Meta behavior for this iteration remains user verification; no personal Safari actions or live inference.


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


## Repeated post-build resource loading failure — November 3

User again reports unstyled popup with scripts not advancing after v0.21.4. Read-only pluginkit inspection lists Tabby0.21.3 at the normal Debug app path while the on-disk embedded extension plist is0.21.4/build49. The build script overwrites/re-signs that registered app in place. This confirms registration/disk version mismatch; stale loaded resource-signature state is the leading explanation, not a newly captured Safari error. Filtered recent logs contained no matching resource/signature messages. Historical docs/safari-testing.md records Safari's explicit resource-signature validation error in an earlier iteration; it is historical evidence only. Final on-disk signature and file comparisons do not establish Safari-loaded resource validation.

Added a pre-build guard: read registration, refuse a target containing any registered Safari extension, and fail closed when registration cannot be inspected. Default normal-path build now stops before xcodebuild. An explicitly supplied separate derived-data directory is supported; Xcode may itself register a staged app, so this is not a guarantee of browser isolation or loaded-version verification. Never silently install/replace/reload to work around this guard. Plan the activation step separately and preserve all Safari safety restrictions. No native build, app/service launch, registration change, extension toggle, Safari quit or tab/window actions during this fix. Packaging/guard tests pass, including actual CLI refusal of the current registered output. Current Safari recovery and loaded version remain unresolved pending deliberate extension refresh verification.


## v0.21.5 staged dropdown event correction — November 3

User reports appearance recovered but clicking the settings dropdown opens nothing. Actual Safari inspection was attempted: the read-only app snapshot returned, but the subsequent click was rejected because user state changed; refreshed inspection failed screen-capture availability. No Safari click/navigation/toggle succeeded, and no real browsing inventory is retained in project files. The current failure's precise cause is not established.

Popup trigger now explicitly takes focus with preventScroll before opening. Menu scroll/resize handlers reposition rather than unconditionally dismiss; scrolling the trigger outside the pane still closes. Navigation explicitly closes menus. Selection/Save contract and theme/layout/CSS remain unchanged. Three new fake-DOM regressions cover focus, queued scroll/resize, cancellation, selection and dismissal. All252 automated fake-provider/browser checks pass. IAB pointer choice/save and menu persistence through480×600 viewport resize passed; Product design/themes visually reviewed open Light menu. This is not actual Safari evidence.

A separate signed resource-only candidate is prepared at build/candidates/v0.21.5/Safari Dev Lab.app using the existing compiled native binaries, updated plist version/build0.21.5/50 and current extension resources; no xcodebuild/native compilation or launch occurred. Strict deep signature and full22-file comparison pass. Read-only registration still points to active0.21.4 at its original path, and active disk plist remains0.21.4. Candidate activation is pending the explicit update question; do not report it installed or verified in Safari. No service/model calls or Safari tabs/windows closed.


## v0.21.5 approved registration and incomplete reload — November 3

User explicitly approved switching Tabby to the prepared v0.21.5 copy and reloading only the extension. Registered the completed candidate with Launch Services/PlugInKit, preserving the old app contents. PlugInKit's preferred version is0.21.5 at build/candidates/v0.21.5/Safari Dev Lab.app. Safari Settings visibly listed both0.21.4 and0.21.5. Root selected the new entry, confirmed0.21.5 and enabled status1, then disabled the old entry (status0). A further new-entry click had no observed state change. Automatic review rejected a coordinate reload attempt because its target was uncertain; that coordinate action was not executed. Subsequent checks confirmed0.21.5 enabled/0.21.4 disabled, but the Tabby toolbar button was absent. The temporary Safari Settings window was closed; no browser tabs/windows were closed or navigated. Native app-control connection then timed out when checking the containing candidate app. Do not claim a completed runtime reload or functioning packaged dropdown. Manual off/on of the verified0.21.5 entry and popup verification remain required. No uninstall, storage erasure, Safari quit/restart or Meta inference occurred. Candidate signature remains valid. Both registered app paths must now remain immutable during future builds. Local Safari-settings screenshot retained privately in /tmp only; no browsing inventories committed.


## User-confirmed dropdown and baseline comparison — November 3

User reports the dropdown now works, then asks whether restoring the old version with only the dropdown patch would be preferable. Compared HEAD with pre-chat commitf9862f1: application changes are confined to extension/popup.js (custom choices, focus, placement and settings hooks), extension/popup.css (menu styling), manifest version, and Xcode version/build numbers. Popup HTML, dashboard, popup AI logic, server and native Swift code match baseline. Thus current application source already represents the requested old-baseline-plus-dropdown approach; no further rollback/rebuild was made. Build/package guards and tests are separate development protections and retained. Explicit focus and scroll/resize repositioning are plausible contributors to working interaction; no one-change Safari experiment isolates causality from the separately loaded build. Working dropdown is user-reported evidence, not agent-run packaged Safari verification. Duplicate app/service state and rejected provider credentials remain separate unresolved deployment/configuration concerns.


## Old Tabby copy removed at user request — November 3

User explicitly requested removing the old version after repeated errors. Before cleanup, both native hosts were running, but the local8788 listener had already moved to the v0.21.5 helper (the earlier old-service diagnosis is historical and no longer describes this state). Revalidated exact executable paths, stopped only the old native host, removed its PlugInKit and Launch Services registration, made and CRC-verified a non-launchable ZIP backup at build/retired/Tabby-0.21.4-retired.zip, then removed the old Debug .app folder. Final checks show zero old-copy processes, one registered extension0.21.5, and the new host/helper still running with its helper listening on8788. No Safari actions, browser tab/window closures, Keychain access, saved-data deletion, ledger changes or Meta requests occurred. Provider401 invalid_api_key recovery remains unverified; duplicate removal is not evidence of corrected provider authentication. The retained candidate path is now the single installed development copy and must not be overwritten during builds.


## Safari registration recovered after old-copy cleanup — November 3

User screenshot showed Tabby missing from Safari Extensions after removal of the old app. Retained0.21.5 app still existed, passed strict signature verification and appeared once in PlugInKit, but Safari did not list it. Re-registered the retained parent app with Launch Services and its extension with PlugInKit after old-copy cleanup. Actual Safari Extensions then showed one Tabby0.21.5 entry, initially unchecked/inactive in all profiles. Native checkbox interactions had no observed effect; one coordinate attempt failed with noWindowsAvailable and setting AXValue was unsupported. Restored the existing enabled election using pluginkit -e use for the exact Tabby extension identifier. Final actual Safari AX state confirms Tabby0.21.5 checkbox1 and active in Personal and EPQ, matching prior activation. Screenshot saved privately under /tmp/tabby-ui-review/tabby-restored-enabled.png. Only one copy remains registered. No browser tabs/windows were closed/navigated, no Safari quit/restart, no security setting changes, no storage/Keychain/ledger changes or Meta calls. The popup/dropdown was not separately exercised during this recovery; do not conflate verified registration/profile recovery with live inference or popup testing. Removing an old app's Launch Services registration can disturb availability of the retained app with the same bundle identity; re-register and verify the retained copy after cleanup, rather than relying only on pre-cleanup registry output.


## Stable v0.21.5 distributable checkpoint — November 3

User reports current app working and explicitly requested committing and preserving a stable distributable. Packaged the existing working v0.21.5/build50 app without modifying/rebuilding/reloading it. All252 fake-provider/browser checks pass; strict signature, full22-file extension comparison, all bundled service module comparisons, ZIP CRC and byte comparison of all49 regular app files pass. Archive includes MIT license, install guide and release notes; SHA-256 5aa4cb619c1bf60649dcaf2689b6a5bfe1060f0b82252cb72d71aef046b09774. Tagged/release checkpoint is a stable developer preview, not a notarized consumer release; native setup still has stale2/20 label, and clean-install/restart/distribution gates remain open. Current success is user-reported, separate from agent-run isolated UI and Safari registration checks. No provider calls, credentials access, app/service changes or Safari operations were made for packaging. Download and public verification are recorded in docs/releases/v0.21.5.md.
