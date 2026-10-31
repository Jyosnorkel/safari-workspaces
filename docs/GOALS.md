# MVP goals and evidence

The local build-guide webpage is the planning reference (`project-guide/dist/index.html`, served at http://127.0.0.1:8787). This table maps its original product goals to implementation evidence. Organiser source copies remain private; this file contains our own development plan.

| Webpage goal | Evidence at v0.4.1 | Next acceptance step |
| --- | --- | --- |
| Scan and organise | Manual dashboard, sticky chips, drag grips, collapse/expand and validated inventory | Verify packaged extension in a disposable Safari window |
| Real Meta suggestions | Official Meta adapter, authenticated loopback service, durable usage guard and client integrated; fake-provider/client HTTP tests pass | User reports useful real Meta grouping; continue quality measurements |
| Review corrections | Editable staged proposals, drag-to-chip corrections and explicit acceptance; fake-DOM tests plus fictional-data browser interactions pass | Verify actual Safari rendering and a consented real response |
| Save before closing | Verified local writes, navigation checks, recovery journal tests | Full live flow still unverified; current user prohibition prevents close tests |
| Resume reliably | Ordered URL restoration, pending recovery, deliberate new sessions | Live restore checks and restart persistence pending; no Safari quit allowed |
| Window backup (user-added MVP goal) | Non-closing whole-window snapshots, JSON export/import; 116 total automated checks and native build/signature pass | Verify actual Safari download file and import; sample-API DOM test passed |
| Reproducible setup | Native build script and manual instructions | Authenticated automatic origin refresh and file hotload implemented/tested; native resources verified; new Safari activation remains pending |

Current priorities: verify actual Safari-to-service status without a model call, then a consented real suggestion and safe snapshot/backup behavior, then measure grouping quality. Optional excerpts, notes and other extras follow the working core.

Safety constraint: do not close current Safari sessions/windows, delete WebDriver sessions, terminate the retained driver, or quit/restart Safari. No personal tab inventory goes into tests, GitHub or AI requests. Browser verification must distinguish sample APIs, actual extension execution, and actual model inference.

Approved API defaults: one in-flight suggestion; two outbound attempts per rolling minute; twenty per UTC day; no retries. Separate remote token counting counts as an outbound attempt too. Explicit user consent is required for sending sanitized tab metadata. No key belongs in the extension or repository.

## v0.5.0 drag-and-drop iteration — October 31

Eligible tab rows can be dragged onto manual group cards/chips, and AI proposal rows can be dragged between proposal cards before explicit acceptance. Grips reorder dashboard/snapshot tabs, with Option+Up/Down on manual grips. These controls do not rearrange Safari's native tabs. A JSON file dropped anywhere on the dashboard is fully validated and durably imported before one new normal window is created; URLs restore in file order with per-tab recovery. File-picker import stays save-only. Existing windows remain untouched. Interrupted/replayed operations do not automatically create another window.

131 automated checks pass using fake browser/model APIs, including file drops, forged/stale drags, ordering, write failures, duplicate requests and partial restoration. Native build/signature verification passes. Actual packaged Safari file dropping, physical drags and new-window restoration remain unverified. No Safari interaction or live model requests occurred in this iteration. One initial blank tab is retained in the new window; no tab/window cleanup occurs.

Toolbar popup follow-up v0.5.1: manually opening the small popup exposes a backup drop area using the existing background reload operation. 134 automated checks pass; native build/signature pass. Real Safari popup focus/drop behavior still needs verification. Backup backend unchanged.
