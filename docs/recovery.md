# Save and restore recovery

The background coordinator serializes workspace requests from all manager pages. The dashboard/core message shapes remain unchanged by this milestone.

## Save and close

1. Confirm the target is a normal, non-private Safari window.
2. Fetch each selected live tab and compare its current URL and window with the scan. Pinned/private tabs, missing tabs and tabs with a pending navigation are rejected. A pending navigation can still report its old URL, so matching `url` alone is insufficient.
3. Save the complete ordered snapshot and read it back before closing anything.
4. Recheck each live tab immediately before its close request. A later navigation leaves that tab open, while the saved snapshot retains the original URL.
5. Persist close results after each request. If progress cannot be saved, stop further closes and retain the original complete snapshot.

Browser navigation and closing are separate API calls. The pre-close check narrows the race; it cannot make them atomic or preserve unsaved forms.

## Restore and uncertain results

Restoration opens saved HTTP(S) URLs in snapshot order. A durable `pending` entry is written before a create request, then replaced with `opened` only after Safari returns a tab ID and progress is saved. If a worker or storage write fails during that gap, the item remains uncertain. The user must inspect Safari and mark whether it opened before retrying. Confirmed successes are skipped; failed entries can be retried.

A completed snapshot is kept. **Restore another copy** starts a deliberate new session after confirmation. Replayed session requests and stale dashboards cannot silently reset a completed run.

The coordinator now validates a snapshot and its journal before restoration or uncertainty resolution: version, IDs, ordered unique tab records, restorable URL schemes, field types, timestamps, known journal states and tab references must be valid. Invalid data is retained unchanged and no restore/recovery browser operations begin. Do not delete the local storage entry when diagnosing corruption; a future export/recovery interface can preserve it for repair.

## Verification

`node scripts/check.mjs` passes 19 tests in this branch using a simulated browser/storage API. New cases exercise pending navigation before save and after snapshot, 14 malformed snapshot/journal shapes, malformed storage/request IDs, and non-normal windows. Existing cases cover failed writes/readback, stale scans, partial close/restore, worker restart, replay/concurrency, private browsing and repeated explicit restore sessions.

No live Safari end-to-end or actual browser-restart verification was performed by this agent. The coordinator owns that test session. Safari-specific pending-navigation reporting and permission behavior still need real browser evidence.

## Known limits

- Retrying an earlier failed URL after later URLs opened appends it to the window; the existing journal does not retain reliable live tab anchors across browser restarts. The snapshot itself retains original order. A later ordering milestone should address live insertion without treating session tab IDs as durable saved identity.
- Malformed entries remain in local storage. This change blocks unsafe restore/recovery; it does not provide an export/repair UI or change saved-list rendering.
- URL restoration cannot preserve unsaved forms, history, scroll position, authentication or full page state.
