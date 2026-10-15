# Recovering a timed-out download

Open WordPress, choose the source site, then open Transfers. Under Recent transfers, a timed-out Pull, Backup, Export or local export offers **Recover download**. Recovery starts a new run with the original download ID and selection; the original failed run remains visible. Follow the new card until it says Complete. A newer recovery hides the older recovery button.

Recovery reuses the source export and the host download cursor when the source still exists. A fully verified file set can have its completion receipt restored without downloading again. If the source export has expired or been removed, start a new pull. Recovery does not import, publish or change a site's database, themes, plugins or media. It excludes source-maintenance exports, dry runs and delete/release actions.

Preparation, downloading and final verification have separate durable phase checkpoints. Downloads report byte progress; verification reports file progress. The host's optional bounded sealing verifies batches of up to 250 entries or 20 seconds between files and persists its cursor. Writes freeze during verification, and an integrity failure clears that freeze for repair. Hosts without bounded sealing still receive a fresh worker slice for final verification. Very large individual files can exceed the nominal batch target.

## Incident that motivated the change

On October 15, 2026, the Apex pull started at 10:19:10 Pacific and was marked failed after 6 minutes 35 seconds. Audit receipts show 6,216 entries and all 135,017,135 bytes downloaded successfully. Final host verification started late in the same five-minute slice; the worker timed out while the host continued its call, leaving the catalog labelled Downloading. Increasing the action timeout would hide the missing phase checkpoint and leave the same failure possible on larger sites.

Regression coverage includes phase boundaries, sealed receipt recovery without source chunk requests, repeated bounded-verification slices, inbound-only UI recovery, host cursor persistence across restart, write freezes, and corrupt-file refusal/repair.
