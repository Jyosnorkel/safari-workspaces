# Downloadable macOS release

The intended customer flow is: download → move Safari Workspaces to Applications → open it → enable the Safari extension → optionally configure AI in the app. Manual grouping and backups must work without an AI account. Customers should not install Xcode, Node.js, edit configuration files, use Terminal, or change Safari developer/security settings.

This is the release target, not evidence that the present development app meets it. The existing ad-hoc build requires Safari's unsigned-extension development setting. A ZIP of that build remains a developer preview.

## Distribution route

Apple supports distributing a Safari web extension inside a macOS app outside the Mac App Store using Developer ID signing and notarization. This requires Apple Developer Program access and the appropriate signing identity; App Store publication is unnecessary for this route. See [Apple's Safari distribution guide](https://developer.apple.com/documentation/safariservices/distributing-your-safari-web-extension) and [notarization guide](https://developer.apple.com/documentation/security/notarizing-macos-software-before-distribution).

Use Xcode's archive/distribution workflow after validating the complete bundled app. Sign nested executable components, including any runtime, before the outer app. Preserve hardened runtime and use only required entitlements. Notarize the final app, staple its ticket, then package it. Never modify bundle resources after signing. Signing, account enrollment and uploading for notarization require the user's release authorization and account setup; the package script performs none of them.

```sh
# Developer preview of an already built app; no release claim:
./scripts/package-release.sh --development "$PWD/build/Build/Products/Debug/Safari Dev Lab.app"

# Only after a Developer ID app has been notarized and stapled:
./scripts/package-release.sh --release '/absolute/path/to/exported/Safari Workspaces.app'
```

The script verifies the existing bundle signature. Release mode additionally requires Developer ID, a stapled ticket and Gatekeeper assessment. It creates a ZIP and SHA-256 file under `build/releases/`, refuses to overwrite an existing archive, and does not upload anything. Passing these checks does not establish the functional tests below.

## Local AI runtime

The app must own startup and stop/recovery for its local AI service. Never depend on a customer's shell exports or the first `node` found in PATH. Runtime lookup should use the signed app bundle. A development fallback, if offered, must be clearly identified as development-only.

For bundled Node, pin an exact supported release and architecture. Obtain macOS binaries from Node's official release site, verify their SHA-256 using the signed release manifest and trusted Node release keys, and retain the exact version, archive hash and verification evidence in the release record. Include Node's full LICENSE and bundled third-party notices. See [Node's binary-verification instructions](https://github.com/nodejs/node#verifying-binaries) and [license](https://github.com/nodejs/node/blob/main/LICENSE). No runtime has been downloaded or approved by this document. Test Apple silicon and Intel separately unless the shipped artifact explicitly supports both.

Credentials belong in macOS Keychain, outside extension storage, bundle resources and logs. Initial AI enablement must remain explicit. Per-request metadata preview/consent and the service-side durable budget remain in force. Use the existing shared state location so upgrades do not reset usage or pairing. Existing terminal-started services must not be killed or silently replaced. Closing the setup window should not unexpectedly stop the app's service; provide an explicit quit/stop path and accurate connection status.

## Release acceptance evidence

- Fresh Mac/user without developer tools or Node: downloaded, quarantined artifact passes normal Gatekeeper, opens and enables in Safari without unsigned-extension settings.
- Real Safari: app-owned AI connection, popup dismissal/reopen, reviewed suggestions and clear missing-key/offline/busy/permission states. No inference during startup/status checks.
- Keychain save/read/update/delete, cancellation/denial and relaunch tested without logging keys. Pairing token stays distinct from provider key.
- Upgrade preserves durable snapshots, backups, pairing and usage; failed startup/occupied port never resets state or kills an unrelated process.
- Restart, crash and quit/service lifecycle tested using a disposable user/session with separate approval. Current personal Safari windows must remain open; do not quit Safari under current project restrictions.
- Manual backup and restore reliability gates in [GOALS.md](GOALS.md) remain required. Record actual Safari/provider results separately from automated fake-provider checks.
- Public source, license/third-party notices, architecture/minimum macOS requirement, installation instructions and a recoverable tagged build accompany the download. Verify public links signed out.

No release readiness, clean-install result or real Meta account access is established solely by a successful native build, packaging command or signature check.

## v0.10.0 local preview evidence — November 1

The local build bundles the developer machine’s Node v24.14.0 arm64 executable and full LICENSE (the current app requires macOS 26.5 or newer), selected only during developer packaging. It does not establish independently verified download provenance or Intel compatibility. `WORKSPACES_NODE_PATH` and `WORKSPACES_NODE_LICENSE` select a different developer runtime; customers never supply these. A public release must replace this with a pinned, independently verified official runtime per architecture.

The containing app deliberately uses the direct-download, unsandboxed host route to keep the existing shared per-user ledger; the Safari extension remains sandboxed. The nested Node executable uses hardened runtime with the [JIT entitlement](https://developer.apple.com/documentation/bundleresources/entitlements/com.apple.security.cs.allow-jit); the host does not receive this exception. Disabling JIT broke Node’s WebAssembly-based HTTP parser in local tests, so that configuration was rejected. Ten fake-provider/local HTTP and desktop tests pass using the corrected bundled executable. The full automated suite has 205 passing checks. Native build and strict bundle signature verification pass.

Keychain prompts, setup-window appearance, real Safari connection, clean-user install and signed distribution remain unverified. No app launch, user key access, live inference, Safari controls or window closure occurred during this iteration. Closing the host window keeps its child alive; quitting the host closes only its own child. No launch-at-login registration was added.

Configuration-presence check found no Developer ID Application signing identity in the current keychain. Public distribution is blocked on the owner supplying that signing setup and authorizing notarization upload; no enrollment or upload was performed.
