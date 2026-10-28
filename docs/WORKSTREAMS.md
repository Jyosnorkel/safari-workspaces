# Agent workstreams

Three subagents run concurrently. Each owns a separate managed checkout and branch. The coordinator reviews pull requests, runs integrated checks and controls the single live Safari test session.

| Priority | Workstream | GitHub issue | Milestone | Branch / status |
| --- | --- | --- | --- | --- |
| First wave | [Safari integration](../workstreams/safari/AGENTS.md) | [#1](https://github.com/Jyosnorkel/safari-workspaces/issues/1) | [M1 — Safari integration verified](https://github.com/Jyosnorkel/safari-workspaces/milestone/1) | `agent/safari-integration` — agent dispatched |
| First wave | [Workspace engine](../workstreams/engine/AGENTS.md) | [#2](https://github.com/Jyosnorkel/safari-workspaces/issues/2) | [M2 — Validated workspace domain](https://github.com/Jyosnorkel/safari-workspaces/milestone/2) | `agent/workspace-engine` — agent dispatched |
| First wave | [Saving and restoration](../workstreams/persistence/AGENTS.md) | [#3](https://github.com/Jyosnorkel/safari-workspaces/issues/3) | [M3 — Recoverable workspace operations](https://github.com/Jyosnorkel/safari-workspaces/milestone/3) | `agent/workspace-persistence` — agent dispatched |
| Queued | [Dashboard and popup UI](../workstreams/ui/AGENTS.md) | [#4](https://github.com/Jyosnorkel/safari-workspaces/issues/4) | [M4 — Clear editable review](https://github.com/Jyosnorkel/safari-workspaces/milestone/4) | Not started |
| Queued | [Meta AI integration](../workstreams/ai/AGENTS.md) | [#5](https://github.com/Jyosnorkel/safari-workspaces/issues/5) | [M5 — Real Meta grouping](https://github.com/Jyosnorkel/safari-workspaces/milestone/5) | Not started |
| Queued | [Optional page context](../workstreams/context/AGENTS.md) | [#6](https://github.com/Jyosnorkel/safari-workspaces/issues/6) | [M6 — Permission-based page context](https://github.com/Jyosnorkel/safari-workspaces/milestone/6) | Not started |
| Queued | [Testing and delivery](../workstreams/delivery/AGENTS.md) | [#7](https://github.com/Jyosnorkel/safari-workspaces/issues/7) | [M7 — Reproducible MVP release](https://github.com/Jyosnorkel/safari-workspaces/milestone/7) | Coordinator handles integration now; dedicated agent later |

## Integration gates

Agents push their own branches and open draft pull requests linked to issues. They do not merge their own work or edit another stream's files. Contract changes are discussed before implementation. GitHub is the shared review record; internal agent messages are used for fast coordination.

The first wave is intentionally bounded to focused fixes with tests. Milestones remain open until acceptance targets are verified, including live Safari checks where required. Automated tests are not reported as browser verification. The AI stream remains queued while model access is pending.

The coordinator publishes a new tagged version only after reviewing combined changes and running applicable checks. No copied participant documents, credentials or real browsing inventories belong in GitHub.

