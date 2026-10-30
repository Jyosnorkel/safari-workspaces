# MVP goals and evidence

The local build-guide webpage is the planning reference (`project-guide/dist/index.html`, served at http://127.0.0.1:8787). This table maps its original product goals to implementation evidence. Organiser source copies remain private; this file contains our own development plan.

| Webpage goal | Evidence at v0.3.0 | Next acceptance step |
| --- | --- | --- |
| Scan and organise | Manual dashboard, validated inventory and group operations | Verify packaged extension in a disposable Safari window |
| Real Meta suggestions | Official Meta adapter, authenticated loopback service, durable usage guard and client integrated; fake-provider/client HTTP tests pass | Guarded real inference returns named groups of supplied IDs |
| Review corrections | Editable staged proposals with explicit acceptance; fake-DOM interaction tests pass | Verify actual Safari rendering and a consented real response |
| Save before closing | Verified local writes, navigation checks, recovery journal tests | Full live flow still unverified; current user prohibition prevents close tests |
| Resume reliably | Ordered URL restoration, pending recovery, deliberate new sessions | Live restore checks and restart persistence pending; no Safari quit allowed |
| Window backup (user-added MVP goal) | Non-closing whole-window snapshots, JSON export/import; 94 total automated checks and native build/signature pass | Verify actual Safari download file and import; sample-API DOM test passed |
| Reproducible setup | Native build script and manual instructions | Pairing/setup documented and AI resources verified in native build; actual Safari origin/status path still pending |

Current priorities: verify actual Safari-to-service status without a model call, then a consented real suggestion and safe snapshot/backup behavior, then measure grouping quality. Optional excerpts, notes and other extras follow the working core.

Safety constraint: do not close current Safari sessions/windows, delete WebDriver sessions, terminate the retained driver, or quit/restart Safari. No personal tab inventory goes into tests, GitHub or AI requests. Browser verification must distinguish sample APIs, actual extension execution, and actual model inference.

Approved API defaults: one in-flight suggestion; two outbound attempts per rolling minute; twenty per UTC day; no retries. Separate remote token counting counts as an outbound attempt too. Explicit user consent is required for sending sanitized tab metadata. No key belongs in the extension or repository.
