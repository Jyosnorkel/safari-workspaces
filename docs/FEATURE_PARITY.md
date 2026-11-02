# Popup and webpage feature parity

Updated November 1, 2026 — v0.17.0.

| Capability | Popup | Webpage |
| --- | --- | --- |
| Refresh current normal window; preserve manual groups | Refresh tabs | Refresh tabs |
| Search current tab titles/websites; switch existing tab | Home | Home · Search tabs |
| Search shortcuts | Cmd+F or slash, arrows, Return | Cmd+F or slash, arrows, Return |
| Create/rename/remove groups; removal keeps tabs Ungrouped | Organise | Organise tabs |
| Whole-row move/reorder, insertion marker, collapsible groups | Organise | Organise tabs |
| Meta connection, consent, usage and grouping preferences | Organise/settings | AI settings/shared settings |
| Direct validated AI application | Default | Default; optional staged review retained |
| Session-only local pairing option | Connection settings | Local service connection |
| Light/dark/system, preferences, compact rows, autosave frequency | Settings | Settings (same local settings key) |
| Snapshot without closing | Save snapshot | Save snapshot |
| Compact expandable snapshot summaries | Snapshots | Saved workspaces |
| Per-snapshot JSON export to Downloads | Snapshot header | Snapshot header |
| Snapshot soft deletion and immediate Undo | Outside snapshot card | Outside snapshot card |
| Open individual saved URL in current normal window | Saved tab double-click | Saved tab double-click |
| Whole-interface validated JSON drop | All popup pages | Entire webpage |

Webpage additionally retains bulk export, import-only picker, save-and-close, recovery, complete restore sessions, real Safari tab-bar clustering and its guarded Undo. Those controls are not yet all exposed in the popup. The popup opening/dismissal shortcut is Cmd+Shift+F; it is not bound to close the full webpage.

Autosave is an interface-opening check when the shared interval has elapsed, not a background timer. No automatic model calls. Private windows are excluded; pinned/restricted tabs may be searched and activated but remain protected from group/close actions. URL restoration does not recover full page state.

Evidence: 229 automated fake-browser/provider checks; native build and strict signature verification; packaged new controls compared with source. Fictional-data visual inspection at desktop and480×600 (light/system-dark) showed no horizontal overflow. This is not actual packaged Safari or live Meta verification. Real shortcut delivery, native Downloads and OS integration remain separate live checks.

The final visual check using a deliberately long-title fixture could not run because the preview browser became unavailable. Ellipsis/min-width constraints are implemented; long-title visual verification and a complete loading/error-state visual sweep remain open.

## v0.18.0 webpage navigation

The webpage now uses four separate sidebar destinations: Home (current tabs/search, refresh and snapshot), Organise (AI, groups and real Safari clustering), Snapshots (export/import/restore/recovery), and Settings (shared preferences and explanatory information). Only the selected destination is visible. Switching preserves DOM/edit state and resets scroll; browser Back/Forward and legacy #ai/#saved links remain supported. Search shortcuts reveal Home before focusing the field. JSON backup drop remains available in every view.

## v0.19.0 selection and grouped snapshots

Single-click selects a row; Command-click toggles members, Shift-click selects a range, and double-click or Return opens/switches the tab. Escape/Clear selection clears selection. Organise drags move selected eligible tabs together in display order. Inclusion checkboxes remain separate: selecting rows does not change which tabs are included in save/close actions.

New snapshots preserve Tabby group names, member order and exclusions using durable saved-tab identities, including duplicate URLs. Whole-window snapshots store named-group order followed by Ungrouped; snapshots without grouping keep their normal URL order. Expanded snapshot cards show group headings. Export/import preserves optional grouping metadata while remapping IDs and resetting operation journals; older JSON backups remain supported. Old snapshots cannot recover group data that was never saved.

Restoration opens saved URLs in saved order and reconstructs Tabby organisation from confirmed created tab IDs. Pending navigation is reconciled on a later explicit popup read/scan. Partial/interrupted restores retain recovery guards; later destination edits take precedence over replayed saved assignments. These are Tabby groups, not native Safari Tab Groups. Restored URLs do not recover forms, history or full page state.
