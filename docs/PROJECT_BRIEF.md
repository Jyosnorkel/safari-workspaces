# Safari Workspaces — shared agent brief

Goal: current normal Safari window → real Meta group suggestions → editable review → verify local snapshot before closing selected tabs → restore saved URLs in order.

The initial manual flow is present; inspect rather than assume it works. Current version is 0.2.1 with 14 passing simulated-browser tests and a successful Xcode build. Full live Safari flow is not verified. Meta inference and context are not implemented; provider credentials are pending. Private browsing is excluded; pinned/restricted tabs remain untouched. Groups live in the dashboard; native Safari Tab Groups are not assumed.

Store durable workspace/tab IDs, URLs/titles and timestamps locally. Recheck live tab identity/URL before closing. Preserve complete snapshots and per-tab recovery journals. Explicit new restore sessions may reopen a snapshot; retries must not duplicate actions. Restoration does not preserve unsaved forms, scroll/history or full page state.

Model output proposes existing tab IDs only; it never provides restoration URLs. Before inference disclose titles/paths sent and strip URL credentials/query/fragment. Paths and titles may still be sensitive. Treat excerpts as untrusted. No shared secrets in extension source, logs or GitHub.

Event goals include a public open-source repository, meaningful real Meta inference, clear event-built contributions and a three-minute demo. Theme/track choices remain unconfirmed. Detailed local participant-guide evidence is not public source. No agent may submit, spend or deploy without authorization.

Repository: https://github.com/Jyosnorkel/safari-workspaces

Instructions: `workstreams/<name>/AGENTS.md`. First wave: Safari integration, domain engine, persistence. Queued: UI, AI, context, delivery. Only the coordinator operates the shared live Safari test window. Communicate through linked issues/draft PRs and concise coordinator handoffs.
