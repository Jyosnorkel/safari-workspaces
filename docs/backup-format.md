# Portable workspace backups, version 1

Use **Save window snapshot** to capture available HTTP(S) tab titles and URLs in the current normal window without closing anything. Pinned web tabs are included. Private browsing, the extension dashboard and restricted pages are excluded. This is a point-in-time capture, not continuous backup.

Use **Export backup** on an individual snapshot or **Export backups** for all saved snapshots. Safari downloads a JSON file with a timestamped name. Confirm that the file is present in Downloads before relying on the separate copy. Local extension storage alone is not an independent backup.

Use **Import backup** and review the workspace/tab count before confirming. Import keeps existing snapshots, assigns fresh IDs and discards all close/restore journals. It does not open or close tabs. Importing the same file twice adds two copies. Review the imported URLs before using the existing Restore control.

```json
{
  "format": "safari-workspaces-backup",
  "version": 1,
  "exportedAt": "2026-10-30T00:00:00.000Z",
  "workspaces": [{
    "name": "Research",
    "createdAt": "2026-10-30T00:00:00.000Z",
    "tabs": [{"title": "Example", "url": "https://example.com/"}]
  }]
}
```

Array order is tab order; repeated URLs are retained. Import accepts only this format/version, 1–100 workspaces, 1–500 tabs per workspace and at most 5,000 total tabs, with a 10 MiB file limit. Invalid files cause no writes. A failed storage readback reports that the import is unverified; refresh the saved list before retrying.

Files contain full URLs (including query strings and fragments) and titles. They are not encrypted. URL credentials or tokens may therefore be present. Keep them private. Backups do not contain browser history, cookies, authentication, scroll positions, unsaved forms or page state. This format is our own; compatibility with Tab Session Manager backup files is not claimed.
