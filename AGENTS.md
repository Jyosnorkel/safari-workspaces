# Safari Workspaces — goals, requirements and working instructions

Updated 30 October 2026. This is the current project brief, replacing earlier local AGENTS instructions. Read it at the start of work and check the acceptance list before a milestone, pull request or release. Verify current code and evidence before updating status; a file or mock is not proof of live behavior.

## Product goal

Build a usable macOS Safari extension that uses a real Meta text model to propose meaningful task/project groups, lets the user review corrections, and reliably saves/closes/restores their tabs. Core journey:

**Scan current window → Meta suggests named groups → user edits → save and verify → close selected tabs → restore saved URLs later.**

The user wants a shippable app, developed in tested iterations with regular GitHub pushes and tagged versions. App Store publication is not needed for the hackathon MVP. A proposed stronger differentiator is a source-linked checkpoint for resuming unfinished work; this is an optional product proposal, not a replacement for the agreed grouping flow.

## Required MVP and acceptance checks

- [ ] Scan the current normal Safari window with available titles/URLs; clearly handle missing metadata and restricted URLs.
- [ ] Exclude private browsing and leave pinned tabs untouched. The dashboard itself must not be saved/closed.
- [ ] Create/rename groups, move tabs, include/exclude individual tabs; leave uncertain tabs visibly ungrouped.
- [ ] Real Meta inference returns named groups, supplied tab IDs and brief explanations. Explain why groups are suggested.
- [ ] Review suggestions before applying them. Preserve existing manual edits on API failure or until replacement is explicitly accepted.
- [ ] Reject malformed results, unknown IDs and duplicate assignments. Never treat model URLs as restore instructions.
- [ ] Save durable workspace/tab IDs, ordered URL/title snapshots, names and timestamps locally.
- [ ] Persist and read back a complete snapshot before any close. Compare structured values, not object-property insertion order.
- [ ] Recheck live identity/window/URL/pending navigation immediately before closing. Stale tabs must remain open.
- [ ] Restore saved URLs in order; preserve snapshots and per-tab results on partial failure or interruption.
- [ ] Allow deliberate new restore sessions from completed snapshots; retries/concurrent clicks must not open accidental duplicate copies.
- [ ] Give clear loading, empty, denied-permission, network, invalid-response and recovery states.
- [ ] Store credentials outside the extension, logs and public repository. Provide reproducible local setup.
- [ ] Verify in real Safari using isolated SafariDriver sessions and distinguish this from simulated-browser or UI-fixture tests.
- [ ] Test restart persistence, failed writes (close nothing), partial close/restore, duplicate URLs, missing titles, private/pinned/restricted tabs, stale navigation and replay/concurrency.

### Scope and honest limitations

Groups live in our dashboard. Investigate native Safari Tab Group feasibility but do not assume the API exists or block the MVP on it. “Unload” means save and close. URL restoration does not restore unsaved forms, scroll position, authentication, history or full page state; explain this before closing. Start with one normal window. Accounts, cloud sync, multiple-browser support and drag/drop are optional.

Short permission-based excerpts are an improvement after real title/URL grouping works. Context must be bounded, optional, treated as untrusted data and have metadata fallback. Export/import backup and a non-closing whole-window snapshot are now explicitly requested MVP features. Other useful later work: workspace notes/checkpoints, user grouping instructions, multi-window support and new-tab suggestions. Do not add unrelated agent/image infrastructure to target prizes.

## API controls approved by the user

- One in-flight request at a time.
- At most two outbound attempts per rolling minute and twenty per UTC calendar day, persisted across service restarts.
- No automatic retries or hidden background calls. Count admitted failures/timeouts conservatively.
- Requests route through the service-side guard; UI limits alone are insufficient. Expose usage, cooldown and reset without revealing secrets.
- Retain input/output bounds. If token counting requires a separate request, count it against the same attempt budget and disclose the resulting suggestions/day limit.
- These are service-local request/token controls, not an account-wide or guaranteed dollar cap. Verify provider pricing before cost claims.
- Live calls require explicit enabled configuration and user data-sharing consent. Default disabled. Use fake providers for automated tests and label them.
- Current official Meta examples use https://api.meta.ai/v1 and muse-spark-1.3; verify exact schemas/account availability before using them. Our service environment variable is META_API_KEY (official examples use MODEL_API_KEY).
- Strip URL credentials, query strings and fragments before inference. Titles and paths may still be sensitive; never call sanitization anonymization.
- Never ask the user to paste their API key in chat or GitHub. The user controls key entry/payment/account decisions.

## Mandatory organiser requirements

These come from the supplied Participant Guide and Event Listing, with live-guide verification notes dated October 28. Check accepted Official Rules and later announcements before submission. They are separate from our implementation choices; this document is not a certification of eligibility/compliance.

1. Confirm participant acceptance, eligibility, application integrity and acceptance of the Official Rules/waiver. The full accepted Official Rules remain unreviewed.
2. Fit one theme: Build for Your World or Push the Frontier. Enter exactly one track: Indie Developer or Startup. Build for Your World/Indie are recommendations; confirm actual selection. A team alone does not determine the track.
3. Meaningfully incorporate Meta Model API and/or Meta open-weight models. Coding with an AI assistant alone does not prove our product integration. The guide's first judging stage checks theme and reasonable Meta usage.
4. **The project must be open source and the source repository public.** Participant Guide §4: “Open source: Repositories must be public.” Show this prominently in the project webpage and submission checklist. Verify access signed out. The supplied guide does not require a particular license; we selected MIT for our original code.
5. Show event-built functionality and identify original contributions clearly. Guide §4 warns unclear contributions may cause disqualification. Distinguish Apple-generated scaffolding and any reused code. Startup reuse must clearly identify new work.
6. Maximum four contributors; solo participation allowed. Submit one project per team, name a representative and list all contributors.
7. Submit through Cerebral Valley with an accessible three-minute demo video and public repository. Confirm actual code/video/live-product/access fields early and verify links signed out.
8. Official listed cutoff: Wednesday November 4, 2026, 9 PM Eastern = Thursday November 5, 2 AM London. No late submissions. Our internal recommended target is November 4, 8 PM London (six hours early).
9. Use code/data/assets the project has rights to use; follow legal, ethical and platform policies. Do not publish copied participant-guide text or private planning evidence merely because it exists locally.

### Eligibility and prohibited-category audit

The supplied listing excludes sanctioned parties and those acting for them; people/organizations organized or located in Belarus, China, Russia, Ukraine, Syria, Crimea, Donetsk, Luhansk, Cuba, North Korea or Iran; and participation prohibited by local law. It also excludes Meta/Cerebral Valley employees, contractors/interns, government-affiliated individuals, specified immediate family (spouse, domestic partner, parents, guardian, ward, children, siblings and their respective spouses), and household members. Consult full actual rules for authoritative scope. Duplicate applications, false identity and spam can disqualify entrants.

Guide §4's non-exhaustive anti-project examples: AI medical/mental-health advice and skin-blemish detection; basic RAG; simple image analyzers; simple AI education chatbots; AI job-application screening; nutrition coaches; personality analyzers; sports analysis/coaching; political or war projects. Keep this product centered on browser productivity. No App Store launch, specific license or use of every Meta model is established as a mandatory event rule.

## Judging and evidence

Impact30%, Meta AI tooling25%, execution20%, demo25%. Application selection's equal weighting of idea/technical skill is separate. Guide describes initial theme/Meta pass/fail, scored judging, then five finalists per track using the same rubric.

Measure at least three mixed sessions of roughly20–30 tabs: corrections needed, grouping latency and restoration results. Compare metadata-only vs optional excerpts when implemented. Seek3–5 user trials if available. Report actual outcomes, not invented metrics. Show cross-domain task grouping and a meaningful user correction.

Three-minute demo target:20sec problem/clutter;45sec real grouping;25sec correction;45sec save/close/restore;25sec architecture/privacy/reliability;20sec measured results and original contributions.

## Submission and resource checklist

- [ ] Acceptance/eligibility/Official Rules confirmed; theme and track selected.
- [ ] Public source and appropriate attribution/license; no credentials or private data.
- [ ] Working real Meta integration and reproducible judge installation/access instructions.
- [ ] Original contributions and all contributors clearly listed.
- [ ] Three-minute video and source links accessible signed out.
- [ ] Actual platform fields complete; submission before internal target; receipt verified.

Credits/offers are conditional: Meta guide offers$150 per accepted participant claimed individually by the deadline and says a payment card is required; a spend notification is not necessarily a hard cap. Modal offer$100 first1,000; Baseten offer$100/2M TPM selected participants and guide-specific model meta-models/muse-spark-open-1026 must be verified. Live October28 guide superseded Fireworks$25 paste with$100 per selected team, emailed after shortlist selection. No awards/credits claimed by agents without authorization.

Live October28 workshops Oct27/28/30 are noon–12:30PM Eastern (4–4:30PM London). Office hours weekdays10–11AM Eastern:2–3PM London Oct28–30,3–4PM Nov2–4. Resolve submission questions by Nov3. Guide judging Nov5–8 conflicts with landing-page Nov4–8; confirm announcements. Closing ceremony Nov9 noon Eastern/5PM London; community winner Nov16. Listing label “Event Closed” does not prove cancellation or a revised submission cutoff.

Optional bonuses: open-weight build$10K (eligible model/provider must be verified), viral$20K (optional X posting/submitted link; Nov8EOD timezone unclear), community vote$10K (opens Nov9, one vote/verified account), agentic$5K, creative$5K. Do not sacrifice MVP reliability or post publicly solely for these. Keep a tagged demo after event and assess distribution only after usefulness/reliability evidence.

## Sources and roadmap

Public links: https://cerebralvalley.ai/e/meta-ai-developer-hackathon ; /details ; /waiver ; /hackathon/submit ; https://dev.meta.ai/events/global-hackathon ; https://dev.meta.ai/docs/quickstart ; https://dev.meta.ai/docs/models ; https://github.com/meta-models/meta-model-cookbook ; https://github.com/meta-models/meta-oss-cookbook .

Local source evidence (kept out of public Git): project-guide/dist/index.html (webpage), project-guide/dist/sources/participant-guide.txt, event-listing.txt and live-guide-verification.md. All nine Participant Guide sections were read in signed-in Safari October28; earlier fetch failures are historical. Preserve historical copies and label discrepancies. Do not describe this source audit as review of the separate Official Rules.

Remaining priorities: integrate reviewed agent fixes and isolated Safari tests; real Meta service and editable review; optional context/backup; quality measurement/user trials; Nov2 feature freeze; Nov3 video/repo/setup; Nov4 fresh-install/submission verification. Schedule targets are not completion evidence.

## Development workflow and agent boundaries

- Root coordinator reviews integrations and versions; agents use separate worktrees/branches, linked GitHub issues and PRs. User explicitly authorized subagent collaboration and regular GitHub uploads. Maximum three active subagents.
- Workstream ownership/instructions: workstreams/*/AGENTS.md and docs/WORKSTREAMS.md. Current direct assignments override stale queued/boundary text. Communicate API changes before crossing file ownership.
- Prefer safaridriver isolated automation windows for actual extension testing; Playwright WebKit may test UI but is not branded Safari. User explicitly authorized browser automation. Do not touch personal tabs, quit Safari, or change security settings without applicable approval.
- safaridriver is bundled with Safari; do not install random drivers. Extension load/unload protocol supported since Safari26 must be verified against WECG/Apple docs.
- Keep each mutation/test bounded, capture clear evidence and keep user updated. Ask for specific browser/auth/permission help only when needed.
- Run appropriate automated checks and native build; distinguish mock, WebKit UI, real Safari and real Meta evidence. No finished claim without evidence.
- Recheck this file at milestones. Update docs/requirements progress and README honestly; do not mark manual/AI/submission checks complete merely because code exists.
- No unrequested spending, deployment, hackathon submission, messages outside project GitHub collaboration or unrelated publication.

## Browser safety and backup milestone — October 30

User instruction: DO NOT CLOSE ANY CURRENT WINDOWS; DO NOT QUIT SAFARI. This overrides all earlier testing plans, restart checks and cleanup conventions. No DELETE WebDriver session/window endpoints, driver shutdown, Safari quit/restart, bulk tab operations or extension save-and-close tests during this milestone. Use only a fresh automation tab, leave it open and retain its connection for reuse. Do not assume WebDriver handles represent personal windows or that teardown is harmless. Stop and ask for help if isolation is uncertain.

Implement a scan → save entire window snapshot → export portable JSON backup flow. Import must validate the whole file before writing, keep existing snapshots, reset operation journals, and open/close no tabs. Include pinned HTTP(S) URLs in snapshot-only backups; keep pinned tabs excluded from closing/group actions. Backups preserve URL/title/order, including duplicates, and do not recover unsaved forms or full browser state. Keep real browsing inventories private.

## Verified baseline and active webpage goals — October 30

Version v0.2.3 (f0f89e1) is public. It adds a snapshot-only whole-window operation, including pinned web URLs, portable versioned JSON export and validated import. All 68 automated checks pass; native build and strict signature verification pass. Safari DOM event handlers passed with sample extension APIs; actual packaged-extension backup/download, full fixed save/close/restore and restart persistence remain unverified. Tests did not establish real Meta inference. Never close current Safari sessions/windows or quit Safari to complete verification.

The user explicitly selected the build-guide webpage at http://127.0.0.1:8787 (`project-guide/dist/index.html`) as the development roadmap. Keep its implementation evidence current, preserve its source-audit history, and do not tick user checkboxes or confuse planning targets with completion. Public mapping: docs/GOALS.md. Finish real Meta transport plus editable reviewed suggestions before optional context. Backups are now a user-added MVP requirement.

Engine, persistence and Safari PRs #8–10 and the baseline AI guard PR #11 are integrated. Current active streams: local authenticated Meta transport/client and editable AI review. Root owns integrated packaging, roadmap evidence and final verification. The user reports the API key was entered in their terminal; our command environment has neither META_API_KEY nor MODEL_API_KEY. Do not read/print secrets or claim account/model access from that report. Use configuration-presence checks only, and document startup from the same terminal. No paid test calls without configured opt-in and data-sharing consent.

## Integrated AI iteration — v0.3.0

Real Meta Responses/token-count transport, exact-origin paired loopback service and editable reviewed suggestions are integrated from PRs #12–13. Credentials stay in the local service; the dashboard keeps only a separate pairing token in page memory. CSP limits extension connections to http://127.0.0.1:8788. Relative AI_STATE_DIR overrides are rejected so changing checkout cannot silently fork the default shared per-user budget.

All 94 automated checks pass, including fake-model HTTP/client contracts, service security/limits and fake-DOM review interactions. Native v0.3.0/build5 and strict signature verification pass; packaged ai.js matches source. No real API calls or Safari interaction occurred in this iteration. Actual Safari Origin/permission/status connectivity, live Meta account access and visual review remain unverified release gates. Do not weaken origin authentication or claim that the user's reported key proves a working connection. Browser safety instructions remain in force.

## v0.3.1 connection follow-up

A user-reported status request was rejected even though the displayed origin exactly matched saved pairing. No wire Origin was captured, so the cause remains an inference. Client status now uses JSON POST with an empty body object, preserving strict Host/Origin/token checks; missing/null origins remain rejected with more useful diagnostics. All 96 automated checks and the native build/signature pass. The normal build/Build/Products/Debug app path now contains v0.3.1/build6. No Safari control, app quit, session/window closing or real Meta call occurred. User must restart only their local AI service and refresh the extension/dashboard to verify the patched connection. Preserve pairing and usage data.

## Explicit re-pair command

`node server/pair.mjs --re-pair <new-dashboard-origin>` updates only the allowed origin, preserving the existing token and usage ledger with a private atomic write/readback. Stop only the local AI service before running it, then restart that service in the same configured terminal. No extension rebuild or Safari quit/session closure is needed. Normal pairing still refuses different existing origins. Never delete usage.json to repair a connection. Verification uses fake temporary files and checks the real CLI, not the user's credentials.

## Provider diagnostics follow-up

User reported generic provider_error after reaching suggestions, then asked whether rate limits were too aggressive. Limits remain unchanged. Safe server-side diagnostics now distinguish provider HTTP429, authentication/credit/request errors, incomplete output-token exhaustion and invalid responses using fixed text and allowlisted fields/codes. Never forward arbitrary provider messages or model output. This is a service-only update requiring only a local AI service restart; do not rebuild/toggle Safari unnecessarily. The original provider status was discarded, so the actual prior failure cause remains unverified. No live diagnostic/retry calls are authorized or made by this patch.

## Confirmed 512-token output exhaustion

User confirmed an incomplete Meta response caused by the 512-token output cap. The service's bounded default and .env.example are now 2,048 tokens; existing explicit overrides remain respected. Request limits remain 1 in flight, 2/minute, 20/day with no retries. Increasing the output allowance can increase per-call cost and is not a guarantee large inventories fit. Only the local AI service needs restarting, from the user's key-configured terminal with AI_MAX_OUTPUT_TOKENS=2048; no Safari rebuild, re-pair or quit. No live calls are made automatically. The actual larger-cap result remains unverified.

## v0.4.0 dashboard group chips — October 31

User approved a dashboard implementation of draggable/collapsible tab groups. Sticky chips show total assigned tab counts; eligible tab grips can be dragged onto chips. Internal nonce/generation/revision checks reject external/forged/stale/protected drops and busy UI mutations. Unchecked status and manual edits survive moves. Collapse hides the whole card to leave only its chip, retains state through re-renders, moves keyboard focus to the chip, and does not invalidate AI proposals. Actual assignment changes invalidate stale proposals. Existing select menus and Enter/Space toggles remain accessible.

This changes only the extension dashboard; it does not alter Safari's native tab bar, move/close real tabs, or provide native Tab Groups control. Collapse state is page-local, not persisted across dashboard reloads. The user reports reasonable live Meta output after increasing the output cap; no agent inference was made during this UI iteration. All 105 automated tests pass; internal-browser mouse drag, exclusion preservation, Enter/Space and compact cards were verified with fictional tab APIs. Native 0.4.0/build7 is built at the normal build path; actual Safari activation/testing remains user-controlled. Keep all current Safari sessions/windows open and do not quit Safari.

## v0.4.1 automatic connection-address refresh — October 31

User explicitly requires origin checks/updates when the app is used, replacing the manual origin-update workflow. Client status now uses POST /v1/connect, and suggestions run this local handshake before the single explicitly consented inference request. No inference retry is added. Existing local token is still required; do not persist provider keys or auto-trust an arbitrary webpage.

The service accepts a changed actual browser Origin on /v1/connect only for a UUID-form Safari extension origin authenticated with the existing 256-bit token. Preflight alone cannot read usage or write pairing. Body-supplied origins, null/missing/web origins and wrong tokens cannot rebind. File update is private/atomic with expected-token checks, preserves token/ledger, and is read back. Ordinary routes still require the exact paired origin; connection.json is reloaded every request, so later origin or explicit CLI repairs need no service restart. Initial code upgrade needs one local AI service restart and the new client; no Safari quit/session closure. Existing page-memory token entry remains unchanged.

The actual current Safari dashboard origin was read without clicks and the real connection.json updated with token preserved. All 116 checks pass, including real-client/local-HTTP/temporary-file repair without model budget use. Native 0.4.1/build8 and strict signature checks pass; actual new handshaking in Safari remains user-activation verification. No API inference calls or Safari window/session closures occurred.
