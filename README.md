# Tabby

A macOS Safari extension that turns open tabs into focused, reusable workspaces.

Built for the Meta Global AI Developer Hackathon, October–November 2026.

## What you can do

- Search your current tabs and switch to an existing tab.
- Create named groups, drag tabs between them, reorder rows and collapse groups.
- Ask Meta AI to organise included ungrouped tabs using your grouping preferences. Existing group names help it extend your organisation without replacing existing members.
- Correct group names and membership manually. Popup AI applies validated results after sharing consent; the dashboard also supports staged review before acceptance.
- Save a whole-window snapshot without closing anything, including pinned web URLs.
- Save and close selected tabs, then restore their saved URLs in order with recovery for interrupted operations.
- Export portable JSON backups to Downloads, import snapshots, or drop a backup to restore it in a new normal window.
- Explicitly cluster eligible tabs in Safari and undo a completed reorder when the window remains unchanged.
- Choose light, dark or system appearance, compact rows and optional snapshots when opening the popup.

The popup provides Home, Organise, Snapshots and settings. The workspace dashboard provides more space for organisation and recovery. Manual organisation and backups work without AI.

See [download and installation options](docs/INSTALL.md) for the prebuilt developer preview and signed-release requirements.

## Build and set up

Requires macOS, Safari, Xcode and its command-line tools. This is a development build, not a notarized public installer.

```sh
./scripts/build.sh
open 'build/Build/Products/Debug/Safari Dev Lab.app'
```

The app and extension display as **Tabby**; the build artifact retains the starter name **Safari Dev Lab**.

1. Enable Safari developer features and **Allow unsigned extensions** for the development build.
2. Enable Tabby in Safari Settings → Extensions and grant the required tab access.
3. Open the toolbar popup to search, organise or save a snapshot.
4. For AI, enter your Meta API key locally in the desktop setup app, explicitly enable AI and start the local connection.
5. Choose **Copy connection token** in the app, paste it into **Local AI connection** in the popup and connect. Review the sharing preview and give consent before requesting organisation.

The desktop app bundles the local service runtime. Keep it running while using AI; closing its window keeps the connection running. The provider key is stored in macOS Keychain, separately from the extension pairing token. Never put keys in chat, issues or the repository.

For terminal-based setup, see [local Meta setup](docs/meta-setup.md). For packaging and distribution requirements, see the [release checklist](docs/release.md).

## Privacy and limits

Snapshots stay in local Safari extension storage. Exported backups contain full saved URLs and titles and should be kept private.

AI receives included eligible ungrouped tab titles and sanitized URLs, plus existing group names/counts and your preferences. URL credentials, query strings and fragments are removed; titles and paths can still contain sensitive information. Private, pinned and restricted tabs are excluded from inference. No page excerpts are sent.

AI requires an explicitly enabled, authenticated local service and sharing consent. Defaults are one in-flight request, ten outbound attempts per rolling minute and two hundred per UTC day, persisted across service restarts, with no automatic retries. Remote token counting and generation count as separate attempts. These are service-local controls, not an account-wide spending cap.

## Scope and limitations

- Restore reopens URLs; it does not recover unsaved forms, scroll position, authentication, history or complete page state.
- Groups belong to Tabby. Safari tab clustering does not create native Safari Tab Groups.
- Live group membership lasts for the browser session; saved snapshots are durable.
- Organisation starts with one normal Safari window. There are no accounts or cloud sync.
- Pinned tabs remain protected from group/close actions but can be included in snapshot-only backups.

## Project documentation

- [MVP goals and implementation history](docs/GOALS.md)
- [Development notes and historical verification](docs/DEVELOPMENT_NOTES.md)
- [Backup format](docs/backup-format.md)
- [Recovery behavior](docs/recovery.md)
- [Popup and dashboard feature mapping](docs/FEATURE_PARITY.md)
- [Safari testing](docs/safari-testing.md)

Source: `extension/` contains the popup, dashboard and browser operations; `native/` contains the macOS host and Safari extension; `server/` contains the local Meta service. Run automated checks with `node scripts/check.mjs`. Automated tests use fake providers and browser APIs; detailed evidence is recorded in the development documentation.

## Original contributions and license

Tabby was developed during the hackathon. Apple's extension packaging tools supplied the initial Safari Dev Lab scaffold on October 27, 2026. Project contributions include the popup/dashboard, manual and AI organisation, snapshot and recovery logic, portable backups, guarded Meta service and desktop setup.

[Tab Session Manager](https://github.com/sienori/Tab-Session-Manager) was reviewed as a reference; no source code from it was copied into this repository.

Original project source is available under the [MIT License](LICENSE). Apple's SDKs and development tools and bundled third-party components remain subject to their respective terms.
