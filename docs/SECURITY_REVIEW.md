# Security review — November 3, 2026

Scope: local source, all locally reachable Git refs/history, supplied README screenshots, the 0.21.0 developer-preview ZIP, authenticated loopback service, provider boundary, native credential setup/export and extension rendering/message admission. Authorized defensive review; no real credentials, personal browsing inventories, live Meta calls or Safari control used.

## Results

- Secret patterns: 663 reachable Git blobs plus tracked working files scanned; zero candidate matches. Patterns cover private keys, common GitHub/provider/AWS credentials and literal credential assignments. Repeated-character and explicitly fake/example fixtures are excluded. Heuristic coverage is not comprehensive entropy scanning and cannot prove absence of secrets. Images were visually inspected; no OCR sweep of historical binary images was performed.
- Authentication: 72 combinations of routes, missing/hostile/foreign origins and absent/wrong bearer tokens were rejected. A known fake bearer with hostile webpage Origin was also rejected. No status read, pairing mutation or inference occurred.
- Injection: malformed JSON, null/array input, prototype fields, injected key and alternate endpoint fields all rejected before inference.
- Full suite: 246 automated tests pass, including existing exact-Host/DNS-rebinding, null-origin, authenticated rebinding, consent, limits, provider redirection, safe error diagnostics, unknown/duplicate model IDs, storage/readback and recovery tests. Fake providers and isolated temporary servers only.
- Source review: no confirmed credential-exfiltration or authentication-bypass path identified. Provider endpoint is fixed HTTPS with redirects rejected. Credentials pass to the app-owned helper through a bounded private pipe rather than command arguments/environment. Rendering uses DOM text nodes/textContent, not model-controlled HTML. Extension messages require its own sender identity/origin. Native export chooses its own unique Downloads filename rather than accepting arbitrary paths.

The separately recorded package scan examines decompressed ZIP members with the same secret patterns. It does not run the app or establish Gatekeeper trust.

## Limits and residual risks

- A malicious process already running as the same macOS user can read the local pairing file or interfere with service files. Bearer possession permits authenticated local requests with forged HTTP headers; Origin is a browser protection, not authentication against local malware. The service does not independently prove that a claimed tab inventory came from Safari.
- Exported backups deliberately contain plaintext full URLs/titles; they are not encrypted. Treat downloaded backups as private.
- Prompt injection may affect grouping quality. Untrusted titles/URLs and names are bounded and results restricted to supplied IDs; the model has no browser tools or authority to supply restore URLs. This is containment, not a guarantee that every grouping is correct.
- The downloadable app is ad-hoc signed, not Developer ID signed/notarized. The bundled Node runtime's provenance, dependency/CVE inventory, Intel support and clean-machine installation remain release gates. This audit is not a comprehensive binary or operating-system penetration test.
- Stale accounting/repair locks fail closed and can require recovery after interruption; a local attacker can cause denial of service. Limits are service-local, not an account-wide spending cap.
- No real-account takeover, live service intrusion, real secret retrieval, external website penetration, or public vulnerability-database completeness claim is part of this report.

## Repeatable checks

```sh
python3 scripts/security-scan.py
node scripts/check.mjs
```

The scanner checks reachable local refs and tracked working files; explicitly pass additional untracked files as arguments. It never prints matched values. Fetch all relevant refs before a full history review. GitHub Actions now runs it with full checkout history, then the automated suite. Archive members require decompression before scanning.

No application-code vulnerability fix was necessary based on confirmed findings in this review. The changes add preventive checks and evidence; passing them is not a guarantee that the app is unhackable.
