# Recovering a timed-out download

Open WordPress, choose the source site, then open Transfers. Under Recent transfers, a timed-out Pull, Backup, Export or local export offers **Recover download**. Recovery starts a new run with the original download ID and selection; the original failed run remains visible. Follow the new card until it says Complete. A newer recovery hides the older recovery button.

Recovery reuses the source export and the host download cursor when the source still exists. A fully verified file set can have its completion receipt restored without downloading again. If the source export has expired or been removed, start a new pull. Recovery does not import, publish or change a site's database, themes, plugins or media. It excludes source-maintenance exports, dry runs and delete/release actions.

Preparation, downloading and final verification have separate durable phase checkpoints. Downloads report byte progress; verification reports file progress. The host's optional bounded sealing verifies up to 250 entries, 64 MiB, or 20 seconds between 256 KiB blocks and persists its cursor and SHA-256 state, including within one large file. Writes freeze during verification, and an integrity failure clears that freeze for repair. Hosts without bounded sealing still receive a fresh worker slice for final verification. Partial-file verification reports byte progress and finished file counts; a changed file is refused. Source requests are capped by the remaining worker deadline with an eight-second checkpoint reserve.

## Incident that motivated the change

On October 15, 2026, the Apex pull started at 10:19:10 Pacific and was marked failed after 6 minutes 35 seconds. Audit receipts show 6,216 entries and all 135,017,135 bytes downloaded successfully. Final host verification started late in the same five-minute slice; the worker timed out while the host continued its call, leaving the catalog labelled Downloading. Increasing the action timeout would hide the missing phase checkpoint and leave the same failure possible on larger sites.

Regression coverage includes phase boundaries, sealed receipt recovery without source chunk requests, repeated bounded-verification slices, inbound-only UI recovery, host cursor persistence across restart, write freezes, and corrupt-file refusal/repair.


## Larger sites and real limits

The work is bounded by entries, bytes and time, rather than by a whole site or file. A long source outage parks an inbound transfer after automatic retries; it keeps the checkpoint and partial file set for Resume. A host storage-quota refusal also parks instead of discarding the download. Cancel still performs the documented cleanup.

Current hard limits remain: 100,000 entries per file set; 4 GiB per file (the installed host contract); a default 16 GiB per-plugin quota and 64 GiB instance quota, which operators can configure within the documented bounds; seven days of idle retention for open unpinned sets; and a seven-day overall resumable run budget. Zoer Connect paged exports currently have a one-hour idle expiry refreshed by requests and a 24-hour absolute lifetime. Expired sources cannot be reconstructed from partial bytes; start a new pull or narrow the selection. Large transaction-mode SQL snapshots are still bounded by the source's PHP/database limits; the opt-in source-maintenance export supports resumable table/row progress. No workflow can promise unlimited site sizes or indefinite source availability.

Scale coverage includes a 20,000-file pull/preview/push with bounded outputs/checkpoints, within-file byte checkpoints across store restarts, prefix mutation, quota suspension/resume, outage suspension/resume, and deadline-clamped network requests. These tests complement the real 6,216-file full-pull qualification; they are not claims of a live multi-gigabyte or 100,000-file qualification.
