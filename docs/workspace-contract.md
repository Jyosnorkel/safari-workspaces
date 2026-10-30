# Workspace domain contract

The dependency-free `WorkspaceCore` global is shared by the background coordinator and dashboard. This milestone keeps its existing function signatures and return shapes. It does not implement model requests or prove Safari compatibility.

## Inventory and snapshots

- `inventory(tabs)` takes Safari tab records, excludes private tabs, sorts available nonnegative indices, and returns display records. Invalid records are ignored. Pinned tabs, unavailable/non-HTTP URLs and ambiguous or missing identities/order remain ineligible. Missing/non-string/blank titles use `Untitled page`.
- An actionable tab has a nonnegative safe-integer tab ID, window ID and index. Duplicate scanned IDs are never eligible. Missing indices are not invented: a rescan is required before saving tabs whose order cannot be established.
- `snapshot(name, tabs, id, now?)` accepts 1–500 non-private, non-pinned HTTP(S) tabs from one window. Names trim to 1–80 characters. Workspace IDs must have UUID syntax and supplied timestamps must parse as dates. A failed validation returns no snapshot.
- Snapshot tabs are ordered by their original indices and receive independent UUIDs. Duplicate URLs are preserved as separate tabs. Session tab IDs are not saved as durable tab identity. Full URLs remain in local snapshots so restoration preserves destinations; they can contain sensitive parameters.
- The background must still re-read live tabs, verify snapshot persistence before closing and maintain restore journals. Core validation does not replace those safeguards.

## AI boundary

- `aiInventory(tabs)` accepts scanned eligible records and returns only string ID, title (up to 250 characters), and HTTP(S) origin/path. URL credentials, query strings and fragments are removed. Titles and paths may still be sensitive; this is not anonymization.
- `suggestions(raw, tabs)` accepts an object containing at most 30 named groups. Each group needs 1–80 character name and a nonempty `tabIds` array. `reason`, if supplied, must be a string and is truncated to 240 characters for display.
- Model IDs may be nonnegative safe integers or canonical decimal strings, such as `12` or `"12"`. Objects, arrays, booleans, fractions, negatives, whitespace, leading-zero strings and unsafe integers are rejected without coercion.
- Every assignment must reference a supplied eligible tab exactly once. Unknown IDs or duplicates reject the entire response; unmentioned eligible tabs remain explicitly `ungrouped`.
- Suggestions never supply navigation destinations. Existing scanned URLs and saved snapshots remain the only URL sources for browser operations. Model explanations are data for text rendering, not instructions.

## Validation

Run `node --test tests/core.test.mjs` for the domain regression suite and `node scripts/check.mjs` for existing coordinator checks. Tests use synthetic tab data and a simulated browser API. Actual Safari behavior and live Meta inference require separate verification.
