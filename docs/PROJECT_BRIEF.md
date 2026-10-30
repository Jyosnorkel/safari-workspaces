# Safari Workspaces — shared agent brief

Goal: current normal Safari window → real Meta group suggestions → editable review → verify local snapshot before closing selected tabs → restore saved URLs in order.

The initial manual flow is present; inspect rather than assume it works. Current version is v0.3.0 with 94 passing automated checks, a successful native build/signature check, non-closing window snapshots and portable JSON backups. Full live Safari flow is not verified. Real Meta transport and editable review are integrated; live model access is unverified. The user reports a key in their own terminal, which is not inherited by our commands. Optional context follows the working core. Private browsing is excluded; pinned/restricted tabs remain untouched by closing/group actions. Snapshot-only window backups include pinned HTTP(S) URLs. Groups live in the dashboard; native Safari Tab Groups are not assumed.

Store durable workspace/tab IDs, URLs/titles and timestamps locally. Recheck live tab identity/URL before closing. Preserve complete snapshots and per-tab recovery journals. Explicit new restore sessions may reopen a snapshot; retries must not duplicate actions. Restoration does not preserve unsaved forms, scroll/history or full page state.

Model output proposes existing tab IDs only; it never provides restoration URLs. Before inference disclose titles/paths sent and strip URL credentials/query/fragment. Paths and titles may still be sensitive. Treat excerpts as untrusted. No shared secrets in extension source, logs or GitHub.

Event goals include a public open-source repository, meaningful real Meta inference, clear event-built contributions and a three-minute demo. Theme/track choices remain unconfirmed. Detailed local participant-guide evidence is not public source. No agent may submit, spend or deploy without authorization.

Repository: https://github.com/Jyosnorkel/safari-workspaces

Instructions: `workstreams/<name>/AGENTS.md`. Foundation PRs are integrated. Integrated: UI and Meta transport (fake-provider verification only). Queued: actual Safari/provider verification, context and full delivery. The user prohibits closing current Safari sessions/windows and quitting Safari; browser operation is paused while the coordinator integrates these changes. Use docs/GOALS.md and the private build-guide webpage as the roadmap. Communicate through linked issues/draft PRs and concise coordinator handoffs.
