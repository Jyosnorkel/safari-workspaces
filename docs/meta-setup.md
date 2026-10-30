# Meta integration and usage controls

## Current status

This milestone implements the **server-side usage guard and injectable service boundary**. It does not ship a Meta HTTP provider adapter, HTTP server, or extension/dashboard connection. No live inference or API spending has been tested. The `suggest` button remains unavailable until those pieces are implemented and verified.

All provider functions used by `tests/ai.test.mjs` are local fakes, explicitly labelled. They cannot demonstrate real Meta integration.

## Selected defaults

The user selected these conservative defaults:

| Control | Default |
| --- | --- |
| In-flight requests | 1 |
| Attempts per rolling 60 seconds | 2 |
| Attempts per UTC calendar day | 20 |
| Automatic retries | 0 |
| Request timeout | 30 seconds |
| Serialized tab input | 12,000 UTF-8 bytes |
| Complete input prompt | 4,096 actual model tokens |
| Maximum output | 512 tokens, passed to the provider adapter |

A rejected local validation/consent/configuration check consumes no attempt. An admitted provider attempt is persisted **before** provider execution; failures, invalid model responses and timeouts still consume one. No automatic retries or request queue are implemented. A limit error carries a stable `code` and, where known, a Unix-millisecond `retryAt` timestamp for a future UI.

**These controls are not a dollar spending cap.** Prices and model access have not been verified. Input counting and the output-token parameter must be correctly implemented by the eventual provider adapter. Request/token limits apply only to calls routed through this service, not other programs or other uses of the same API key. Provider-side budgets remain useful separately.

## Credential setup

`server/.env.example` contains blank credential placeholders and `AI_LIVE_ENABLED=false`. Never place a real key in source, the extension, a GitHub issue/PR, screenshots, or logs. Copying the example to an ignored local `.env` is optional; environment loading is the responsibility of the future server entrypoint. The current modules do not read dotenv files automatically.

Required live configuration is:

- `AI_LIVE_ENABLED=true` (explicit opt-in)
- `META_API_PROVIDER_ID`: must match the installed adapter's `id`
- `META_API_MODEL`: a verified callable model ID
- `META_API_KEY`: local environment only
- An actual provider adapter with the functions below

Missing/disabled configuration fails closed without reserving budget or calling a provider. Do not enable live inference merely to test limits.

Optional positive-integer settings: `AI_REQUESTS_PER_MINUTE`, `AI_REQUESTS_PER_DAY`, `AI_TIMEOUT_MS`, `AI_MAX_INPUT_BYTES`, `AI_MAX_INPUT_TOKENS`, and `AI_MAX_OUTPUT_TOKENS`. In-flight concurrency is deliberately fixed at one. Higher limits require a deliberate configuration change; the app does not increase limits automatically.

## Integration contract

```js
import {createAIService} from '../server/ai-service.mjs';

const service = createAIService({
  env: process.env,
  provider: reviewedMetaAdapter,
  statePath: '/a/private/local/state/directory/meta-usage.json'
});

const usage = await service.status();
// Show the data disclosure and obtain an explicit user action before consent:true.
const suggestions = await service.suggest(scannedEligibleTabs, {consent: true});
```

The future server must keep this service instance and state path private to its authorized local client. No unauthenticated HTTP endpoint is included. It must route **every** inference request through `suggest`, not call the provider directly. The dashboard must disclose that titles and URL paths can contain sensitive information, and forward explicit user consent. Browser/storage actions remain deterministic extension code, separate from AI output.

The adapter interface is:

- `id`: configured provider identifier.
- `countInputTokens({tabs, model})`: a synchronous, local count of the **complete prompt actually sent**, including system/instruction overhead, using the actual model tokenizer. A guess, incomplete count, Promise, or missing counter is not an acceptable implementation.
- `generate({tabs, model, apiKey, maxOutputTokens, signal})`: exactly one provider request, with provider retries disabled, the actual provider output-token cap applied, and `AbortSignal` forwarded. Return parsed `{groups:[{name, reason, tabIds}]}`. The adapter must not silently call another model, retry, or log the request/key.

No endpoint, HTTP schema, model ID, tokenizer, provider price or API compatibility is assumed here. The provider adapter is a separate integration task requiring current official Meta documentation and actual account access.

The service validates tab IDs and cardinality, excludes private/pinned/unsupported inputs, strips URL credentials/queries/fragments, checks byte/token limits, and validates returned group names and assignments against the supplied IDs. It rejects invented or duplicate assignments. Unassigned tabs remain listed as ungrouped. Titles and paths are **not anonymized**. Model-supplied URLs are never returned as restoration instructions.

`status()` exposes counts, limits, busy state and reset times, never the key, tab titles, URLs or model response. Do not serialize the internal `readConfig()` result: it is server-only and contains the key.

## Durable usage and deployment scope

`UsageGuard` is supported for **one account on one local machine using one shared private state path**, on a local filesystem supporting exclusive creation and atomic rename (macOS/Linux). Every service instance/process using the key must share that path. Multiple machines, serverless replicas and network filesystems require a transactional shared datastore and distributed concurrency control before deployment.

Reservations are written to a private temporary file, synced, atomically renamed, and the directory synced before provider execution. The ledger contains counts/timestamps only. A sidecar `.lock` is exclusively created and held for the entire provider operation; separate instances cannot concurrently admit calls. Do not put the ledger in the repository or serve its directory over HTTP. `server/.data/`, lock files and temporary files are ignored.

The daily window resets at **00:00 UTC**, independent of machine timezone. Rolling-minute attempts remain enforced across midnight. Restarting the process with the same state file preserves counts. Moving the system clock backwards blocks requests until it catches up. Deleting/replacing the state file resets local accounting, so preserve it when upgrading or restarting. There is no reset-budget button.

Corrupt/unreadable state, failed writes, and existing locks fail closed. Crash recovery does not silently reset a quota or auto-expire a lock. If a service dies holding a lock, first stop all copies, verify that the prior provider request has finished or been cancelled, preserve the usage JSON, and only then remove the orphan `.lock` manually. An in-flight provider operation may still be billed even when the local process has exited.

Timeouts abort the provider signal and return an error, but if an adapter ignores cancellation the concurrency lock remains held until its promise actually settles. A hung adapter therefore blocks subsequent calls rather than permitting extra billable requests. Stopping a hung service can leave an orphan lock; use the recovery procedure above.

## Verification

```sh
node --check server/usage-guard.mjs
node --check server/ai-service.mjs
node --test tests/ai.test.mjs
node scripts/check.mjs
```

The AI tests cover rolling-minute/daily windows, UTC reset, cross-midnight accounting, instance restart, concurrent instances, failed writes/corrupt state/orphan locks, clock rollback, timeouts including ignored cancellation, disabled/missing configuration, byte/token limits, consent, sanitization, redacted provider errors and invalid model assignments. They do not make network requests. The shared test runner does not yet discover this new suite; coordinator integration must add it before release.
