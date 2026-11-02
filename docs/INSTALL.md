# Install Tabby

## Developer preview

A prebuilt developer preview avoids installing Xcode or building from source. It is not a signed, notarized consumer release.

1. Download the `developer-preview.zip` asset from the repository's GitHub Releases page, when available. **Code → Download ZIP** downloads source code, not the app.
2. The current preview targets Apple silicon Macs running macOS 26.5 or newer. Intel support is not established.
3. Unzip the archive and move **Safari Dev Lab.app** to Applications. Its displayed product name is Tabby.
4. Open the app. If macOS blocks it, this preview has not passed normal signed distribution; do not disable Gatekeeper or remove quarantine as an installation step. Use the source-build instructions or wait for the signed release.
5. Enable Safari's developer features, then **Allow Unsigned Extensions** in its developer options. Enable Tabby in Safari Settings → Extensions and approve tab access. Safari may reset unsigned-extension permission after quitting.
6. Click the Tabby toolbar icon. Search, manual groups and snapshots do not require an AI account.
7. For AI, enter your own Meta API key in the desktop setup window, explicitly enable AI and start the connection. Copy the separate connection token into **Local AI connection** in the Safari popup.
8. Keep the desktop app running for AI. Preview the metadata and give sharing consent before organising.

Start with a non-closing snapshot. Restores reopen URLs, not forms or complete page state. Keep backups private.

## Signed public release

The intended installation is download → Applications → open → enable the extension. It must not require Xcode, Terminal or unsigned-extension settings.

This route is blocked until a Developer ID Application identity is available and the complete app/runtime is signed, notarized, stapled and tested from a quarantined download. See [release requirements](release.md). A developer-preview ZIP must never be relabelled as that release.

## Preserved development baseline

The GitHub version before installation work is preserved as tag `dev-checkpoint-2026-11-02` and branch `codex/dev-checkpoint-2026-11-02`. Installation work proceeds separately on `codex/simpler-installation`.
