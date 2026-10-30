# Local Meta grouping and request limits

This iteration ships the Meta Responses adapter, authenticated loopback service, private pairing, and `extension/ai.js` client. The coordinator integrates the dashboard review UI and Safari permissions. **No live inference, real key, or branded Safari extension connection has been tested by this workstream.** All tests use fake providers or loopback-only fake services.

## Start locally

Use Node.js 20.12 or newer on the Mac running Safari. No npm dependencies are needed.

1. Open the extension dashboard and copy its displayed extension origin (`safari-web-extension://…`). Pair exactly that origin from the repository folder:

   ```sh
   node server/pair.mjs 'safari-web-extension://YOUR-EXTENSION-ORIGIN'
   ```

   Pairing makes a private connection file containing a random local token. It prints the file location, never the token or Meta key. Copy the token locally into the dashboard's **local service token** field. This token is different from your Meta API key and stays in page memory; re-enter it after reload. Do not paste either secret into chat or GitHub.

2. If your Meta key is already exported in a terminal, start the service from **that same terminal**. Exports in another terminal do not automatically reach Codex or another process. The service accepts `META_API_KEY`, with `MODEL_API_KEY` as a fallback; `META_API_KEY` takes precedence. Set the remaining non-secret configuration:

   ```sh
   export AI_LIVE_ENABLED=true
   export META_API_PROVIDER_ID=meta
   export META_API_MODEL=muse-spark-1.3
   node server/start.mjs
   ```

   Confirm your account can use the chosen model. The documented example ID is not evidence of your account's access. Without a key/model/explicit opt-in, the service reports unconfigured and sends no provider calls. Starting, pairing and checking status do not request inference.

   Alternatively, copy `server/.env.example` to an ignored `server/.env`, protect it with `chmod 600 server/.env`, edit the key locally, and start with `node --env-file=server/.env server/start.mjs`. Never commit this file. Existing shell variables override Node's env-file values.

3. Connect in the dashboard. Safari may ask to allow access to the local service; the only service URL is `http://127.0.0.1:8788`. Status shows configuration, usage and cooldown without exposing the key.
4. Scan a normal window, review the disclosure, and explicitly choose to send eligible titles and sanitized URLs for suggestions. The service removes URL credentials, query strings and fragments again. Titles and paths can still be sensitive. Page contents are not sent. Suggestion results require review before applying; they cannot directly close or restore tabs.

The default state directory is `~/Library/Application Support/Safari Workspaces/AI`. It is shared across repository copies, so changing worktrees does not silently start a fresh budget. `AI_STATE_DIR` may override it with one private persistent absolute directory (relative paths are rejected to prevent per-checkout budget resets); **every service using this key must share the same directory**. `connection.json` holds the local pairing token; `usage.json` holds counts/timestamps only. Do not serve or publish this directory. Port 8788 is fixed for the packaged client; the server binds only to IPv4 loopback.

If the dashboard origin changes, stop **only the local AI service** with Ctrl+C in its terminal, then run:

```sh
node server/pair.mjs --re-pair 'PASTE_THE_NEW_DASHBOARD_ORIGIN_HERE'
node server/start.mjs
```

Replace the placeholder with the exact origin shown in the dashboard. `--re-pair` updates only the allowed origin, preserves your existing token and `usage.json`, writes privately/atomically and verifies the result. Ordinary pairing still refuses to overwrite a different origin. No Safari restart or rebuild is required for this service-side change. Click **Connect & check status** again with your existing local pairing token. Never delete the usage ledger to re-pair.

## Approved limits and accounting

| Control | Default |
| --- | --- |
| Concurrent suggestions | 1 across both endpoint calls |
| Outbound attempts | 2 per rolling minute; 20 per UTC day |
| Automatic retries / background inference | None |
| Complete suggestion timeout | 30 seconds |
| Serialized sanitized tab input | 12,000 UTF-8 bytes; 1–100 tabs |
| Complete model input | 4,096 tokens, counted by Meta |
| Generated output | 512 tokens including reasoning |

A normal suggestion uses **two attempts**: token count followed by generation. With the default daily budget that permits at most ten complete suggestions per UTC day; failures may reduce that number. Each actual endpoint admission is persisted with its own timestamp before calling the provider. The service holds one shared lock across both calls and preflights room for both. A failed/excessive token count uses one attempt and never generates. An admitted generation failure uses the second attempt. Nothing retries automatically, and status checks consume no provider budget.

Local configuration, consent and input checks consume no attempt. Remote counting checks the full prompt/schema with the exact generation body. The service never guesses tokens or calls another model as fallback. Output limits and `reasoning.effort=minimal` bound the request; truncated/refused/malformed responses fail without applying suggestions.

These are local request/token limits, **not an account-wide or guaranteed dollar cap**. Other programs or different state paths can spend separately. Pricing is not claimed here. Optional positive settings: `AI_REQUESTS_PER_MINUTE`, `AI_REQUESTS_PER_DAY`, `AI_TIMEOUT_MS`, `AI_MAX_INPUT_BYTES`, `AI_MAX_INPUT_TOKENS`, `AI_MAX_OUTPUT_TOKENS` (minimum 16). Limits must admit two calls for this adapter. In-flight concurrency stays fixed at one.

## Security and recovery

The HTTP service requires all of: loopback peer, exact `Host`, one exact paired `Origin`, and a 256-bit bearer token compared in constant time. It limits request bodies, denies extra credential/config fields, sets no-store responses, and never logs keys, inventories or raw provider errors. CORS preflight permits only GET/POST with Authorization/Content-Type. It deliberately does not accept `Origin: null` or wildcard origins. Safari's actual extension Origin behavior still needs verification; do not weaken these checks to make a fixture work.

The request ledger uses private files, exclusive locks, atomic rename and file/directory sync. Preserve it during upgrades. Clock rollback, corrupt state, failed writes and orphan locks block calls. No quota reset control exists. If the local service crashes with a `.lock`, first stop all service copies and confirm the previous provider operation has settled; preserve `usage.json` before manually removing only the orphan lock. A timed-out provider can still be billed, and the lock remains held if it ignores cancellation. Late token-count completion cannot start generation after timeout.

Supported scope: one user, one local Mac/filesystem and one shared ledger. This is not a distributed quota system or protection against another local process that can read the user's private files. Production distribution still needs packaging/startup UX and real Safari/provider verification.

## Client contract

`WorkspaceAI.status({token})` returns `{ok:true, usage}`. `WorkspaceAI.suggest({token,tabs,consent:true})` returns `{ok:true, result:{groups,ungrouped},usage}`. Errors expose `code`, `retryAt`, and optional `usage`, with safe text. The client has a fixed loopback base, does not retain tokens, follow redirects, or retry. UI usage should disclose `requestsPerSuggestion:2` and preserve manual edits on any failure. No provider key travels through the extension or loopback request.

## Evidence and checks

```sh
node --test tests/ai.test.mjs
```

35 fake-provider/local-only tests cover original durable-budget behavior plus endpoint/schema construction, output bounds, strict response parsing, separate count/generation admissions, slow-count timing, whole-operation concurrency, timeout continuation, daily preflight, key alias precedence, Host/Origin/token checks, CORS, request-body bounds, private pairing and client error propagation. No test runs Safari or a live Meta call.

Primary Meta documentation checked October 30, 2026:

- [Responses protocol](https://dev.meta.ai/docs/protocols/responses): official base URL and example model; stateless requests.
- [Count input tokens](https://dev.meta.ai/docs/api-reference/responses/count-input-tokens): `/v1/responses/input_tokens` measures rendered input without generation.
- [Responses schemas — Token Counts Body and Resource](https://dev.meta.ai/docs/api-reference/responses/schemas#token-counts-body): accepts our `model`, `instructions`, `input`, `reasoning`, `background`, `text`, `tools`, `store`, `stream` and `max_output_tokens`; returns `object:response.input_tokens` and integer `input_tokens`.
- [Structured output](https://dev.meta.ai/docs/structured-output): Responses uses `text.format.strict` and requires the strict object schema rules followed by this adapter.
- [Reasoning](https://dev.meta.ai/docs/reasoning): Responses nests `reasoning.effort`; `minimal` is supported and `none` is unsupported by Muse Spark. Output cap includes reasoning and visible tokens.

## v0.3.1 status connection patch

The user reported origin rejection despite an exact match between the displayed dashboard origin and saved pairing. The wire Origin was not captured, so the precise browser behavior remains unconfirmed. The packaged client now uses an authenticated JSON `POST /v1/status` with `{}` instead of GET. Fetch's [Origin-header algorithm](https://fetch.spec.whatwg.org/#append-a-request-origin-header) includes a non-GET/HEAD path; privileged extension GET requests can bypass normal CORS processing. This patch avoids depending on GET's Origin behavior without accepting missing/null/wildcard origins. Status still never calls Meta or consumes attempts.

The local server retains GET compatibility when a correct Origin is supplied, accepts POST status with an empty JSON object only, and distinguishes missing, opaque and mismatched Origin errors without logging credentials or inventories. Restart only the local AI service after updating the code; keep the existing pairing and usage ledger. Refresh the extension and reload its dashboard to load the new client. Safari does not need to quit. Live success still requires user confirmation.
