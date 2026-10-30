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

Short permission-based excerpts are an improvement after real title/URL grouping works. Context must be bounded, optional, treated as untrusted data and have metadata fallback. Other useful later work: export/import backup, workspace notes/checkpoints, user grouping instructions, multi-window support and new-tab suggestions. Do not add unrelated agent/image infrastructure to target prizes.

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

## Baseline status before this iteration

Main v0.2.2 has18 passing simulated-browser tests, native build/signature checks, manual dashboard, snapshots and restore journals. Popup rendering/scanning were live-tested; save-and-close exposed a property-order verification bug, now fixed with regression tests. Full fixed Safari journey and restart persistence remain unverified. Multiple dev registrations were reduced to the main build. AI guard PR#11 has18 fake-provider tests but no live transport at baseline. Core/persistence/Safari agent PRs#8–10 await integration. The user's API setup is asserted; no key value or account access has been inspected or used by agents.
