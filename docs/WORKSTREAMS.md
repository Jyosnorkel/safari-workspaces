# Agent workstreams

The coordinator integrates the Meta service and editable review streams. Safari automation is paused to protect the user’s current sessions. Each owns a separate managed checkout and branch. The coordinator reviews pull requests, runs integrated checks and does not close current Safari sessions/windows or quit Safari.

| Priority | Workstream | GitHub issue | Milestone | Branch / status |
| --- | --- | --- | --- | --- |
| First wave | [Safari integration](../workstreams/safari/AGENTS.md) | [#1](https://github.com/Jyosnorkel/safari-workspaces/issues/1) | [M1 — Safari integration verified](https://github.com/Jyosnorkel/safari-workspaces/milestone/1) | PR #8 integrated; live extension verification pending |
| First wave | [Workspace engine](../workstreams/engine/AGENTS.md) | [#2](https://github.com/Jyosnorkel/safari-workspaces/issues/2) | [M2 — Validated workspace domain](https://github.com/Jyosnorkel/safari-workspaces/milestone/2) | PR #9 integrated; domain checks pass |
| First wave | [Saving and restoration](../workstreams/persistence/AGENTS.md) | [#3](https://github.com/Jyosnorkel/safari-workspaces/issues/3) | [M3 — Recoverable workspace operations](https://github.com/Jyosnorkel/safari-workspaces/milestone/3) | PR #10 integrated; persistence/recovery checks pass |
| Integrated | [Dashboard and popup UI](../workstreams/ui/AGENTS.md) | [#4](https://github.com/Jyosnorkel/safari-workspaces/issues/4) | [M4 — Clear editable review](https://github.com/Jyosnorkel/safari-workspaces/milestone/4) | PR #13 integrated; fake-DOM checks pass, Safari rendering pending |
| Integrated | [Meta AI integration](../workstreams/ai/AGENTS.md) | [#5](https://github.com/Jyosnorkel/safari-workspaces/issues/5) | [M5 — Real Meta grouping](https://github.com/Jyosnorkel/safari-workspaces/milestone/5) | PR #12 integrated; fake-provider/HTTP checks pass, actual provider access pending |
| Queued | [Optional page context](../workstreams/context/AGENTS.md) | [#6](https://github.com/Jyosnorkel/safari-workspaces/issues/6) | [M6 — Permission-based page context](https://github.com/Jyosnorkel/safari-workspaces/milestone/6) | Not started |
| Queued | [Testing and delivery](../workstreams/delivery/AGENTS.md) | [#7](https://github.com/Jyosnorkel/safari-workspaces/issues/7) | [M7 — Reproducible MVP release](https://github.com/Jyosnorkel/safari-workspaces/milestone/7) | Coordinator handles integration now; dedicated agent later |

## Integration gates

Agents push their own branches and open draft pull requests linked to issues. They do not merge their own work or edit another stream's files. Contract changes are discussed before implementation. GitHub is the shared review record; internal agent messages are used for fast coordination.

The first wave is intentionally bounded to focused fixes with tests. Milestones remain open until acceptance targets are verified, including live Safari checks where required. Automated tests are not reported as browser verification. The user reports that the key is configured in their terminal. Our command environment does not inherit it; live calls remain unverified. Fake HTTP tests cannot establish model access.

The coordinator publishes a new tagged version only after reviewing combined changes and running applicable checks. No copied participant documents, credentials or real browsing inventories belong in GitHub.

