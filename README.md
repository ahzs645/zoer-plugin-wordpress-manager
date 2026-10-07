# WordPress Manager for Zoer

Independent source and releases for the `wordpress-manager` native plugin. This repository owns its interface and isolated workers. Zoer provides reviewed host services, shared controls and provider credential storage. The first extracted release is **0.5.0**; **0.5.1** adds the shared public type snapshot and reliable source resolution, preserving the existing plugin ID and site/account/backup/transfer state.

## Features

- Hostinger overview offers **Make a local copy**, including connector/Pull setup and the existing verified-download-to-DDEV workflow.
- DDEV, Playground, Hostinger and Zoer Connect site inventory, previews and administrator handoffs.
- Local WordPress creation, start/stop, rename and recoverable removal.
- Hostinger account API/browser login, plan inventory, free temporary domain generation, reviewed website creation, cache purge/bypass and installation detection.
- UpdraftPlus five-component sets and Hostinger hPanel website `.tar.gz` + database `.sql.gz` backups restore into a new DDEV site (`backup.restore-local`); portable backups with optional Files retention.
- Core version checks, backup-before-update review and publishing preflight; plugin/theme search, install, activation, updates, removal and rollback safeguards.
- Opt-in resumable large-database exports with source-pause acknowledgement and table/row/part progress (Zoer Connect 0.5.0 and the matching Zoer host required).
- Pull, push, database filters, media/theme/plugin selection, serialized replacements, staged review, recovery, resumable progress, local copies and transfer history, all as this plugin's resumable actions (0.8.0).
- Existing isolated DDEV inventory, health, user, snapshot, backup and bounded WP-CLI actions.

Provider capabilities remain visible. Hostinger acceptance must be followed by content verification; hPanel remains a recovery/manual import fallback when an accepted import does not replace the site's root. A stopped/unsupported runtime does not gain operations simply by installing this plugin.

## Build and release

```sh
bun install --frozen-lockfile
bun run typecheck
bun run test
bun run build
bun tools/zoer-plugin.mjs validate dist/package
bun run release
```

`dist/package` contains the manifest, workers, reviewed computer command resources (including the scanner runtime), and bundled `native/index.js` / `native/style.css`. `dist/release` contains a deterministic ZIP and digest descriptor. Push `v<manifest version>` to publish those assets through GitHub Actions. Optional signing uses the host's documented `ZOER_PLUGIN_SIGNING_KEY` and `ZOER_PLUGIN_KEY_ID`; private keys never belong in this repository. Run the exported CLI under **Bun**.

Zoer can build a committed source through Repos → Plugin using `zoer-plugin.json`, or install the ZIP/GitHub release through Plugins. This repository is private like Zoer; configure GitHub access for release discovery or upload the downloaded ZIP. Review the added `workspace:native` and `workspace:wordpress` permissions. Use normal versioned upgrades/rollback, keeping `wordpress-manager` as the ID. The plugin negotiates WordPress host contract version 1; install the accompanying Zoer host changes first.

## WordPress-side plugins (`wordpress-plugins/`)

The PHP plugins installed *into* WordPress sites moved here from the Zoer repository (Zoer `docs/plugin-shared-services.md`, section 16.3, phase P1). Neither is part of the Zoer package built above: `scripts/build.ts` copies only `plugin/` and the native module, and `typecheck`/`test` cover only `src`, `tests` and `scripts`.

- `wordpress-plugins/zoer-connect` is a Git submodule pinned to the public [Zoer Connect repository](https://github.com/ahzs645/zoer-connect). Run `git submodule update --init wordpress-plugins/zoer-connect` after cloning. Connector changes, tests (`make test`), builds (`make build`), release tags and the update feed belong in that repository; commit here only to move the pin. `branch = main` allows an explicit `git submodule update --remote`.
- `wordpress-plugins/zoer-content-modules` is the standalone Content Modules plugin. Build and test it from its folder as its README describes (`php tests/package.php`, `node tests/upload.cjs`, `python3 build.py`, which writes `dist/zoer-content-modules-<version>.zip` plus a SHA-256 sidecar).

Zoer Connect **0.5.2** migrates WordPress update checks and downloads to the public `zoer-connect` GitHub Releases. Its final compatibility bridge remains in `zoer-connect-releases` for older installations; future connectors and release jobs use the source repository directly. The submodule pin tracks the qualified bridge source.

The Zoer Connect operating guide and the historical handoff are in [`docs/zoer-connect-operations.md`](docs/zoer-connect-operations.md) and [`docs/zoer-connect-handoff.md`](docs/zoer-connect-handoff.md). Agents editing an existing Zoer-managed DDEV site from outside Zoer use the [site-edit skill](.agents/skills/zoer-wordpress-site-edit/SKILL.md).

## Host API and reuse

Domain code is in `src/components/extensions`, `src/lib/queries`, `src/lib/wordpress-transfer` and the typed API client. All supported HTTP calls pass through `host.request("api.request", ...)` with the reviewed `/wordpress-manager` scope. WordPress-specific runtime calls use `/wordpress-manager/workspace`; no broad `/computers` or secrets endpoint is exposed. Downloads use existing exact-resource host links. Shared `@zoer/plugin-ui/controls` and `@zoer/plugin-ui/workspace` are supplied by Zoer at runtime; React and React Query share the host instances. Native UI is trusted code in the viewer's page, not an isolation boundary. Workers are separately isolated.

Other plugins can consume the host-owned `wordpress-site` adapter through an explicitly selected existing site, operation grants and `requiredAdapters`. Versioned operations cover public inspection, core status/check, extensions, health, backup metadata and sanitized deployment history. They do not grant production mutations or archive content. `wordpressSite(context, alias)` is available in the Zoer SDK for isolated workers. Trusted native plugins can use `createWordPressWorkspaceClient(host)` for the full typed WordPress API after reviewing `workspace:wordpress`; host confirmations and recovery checks still apply. the host's `examples/plugins/wordpress-maintenance` demonstrates a second consumer. Publishing/restores/core installation keep their reviewed workspace workflows.

See [Zoer's architecture guide](https://github.com/ahzs645/zoer/blob/main/docs/wordpress-plugin.md) for the exact contract and boundaries. `packages/api-types` is a committed public contract snapshot from Zoer, so builds need no sibling checkout; refresh it deliberately when changing the contract. Shared UI declarations contain types only, not host control implementations.

## Verification

Unit tests cover transfer/replacement options, capability availability, grouping, lifecycle restrictions, clipboard parsing, progress/history labels and bridge cancellation/session fencing. The build rejects unexpected or dynamic native imports and local filesystem paths, and scopes plugin CSS including portaled dialog content. CI typechecks, tests, builds, validates and archives every push. Host tests cover runtime/upload restrictions, per-site operation grants/revocation, sanitized outputs and installed-worker file permissions. Browser integration is checked against Zoer's real cluster; UI unit stubs supply shared-module imports only.

Live testing against a real Zoer, including by an agent working inside a Zoer computer, follows [`docs/live-testing.md`](docs/live-testing.md): setup, dev-push installs and upgrade review, the test-site rules, the open tests and the `tools/live-gate/` helpers (API, snapshots, push/rollback controls, UI smoke check).

## One-operation local copies (0.5.8)

Hostinger and connected external sites expose **Overview → Make a local copy**.
Choose a name or an existing copy to refresh, then create. The Zoer host must
provide `/connect/:siteId/copy-workflows`: the server persists the destination,
prepares a complete read-only Pull, verifies the download and runs the existing
DDEV import without a second browser action. Closing the dialog does not stop
work. After a backend restart, Resume continues the saved job. Pause and Cancel
are available during download; cancellation retains the paused Pull in advanced
transfers. Imports retain their existing backup, guards and retry behavior.

Unpaired sites show connector setup guidance and a **Restore from backup instead**
route to the supported UpdraftPlus or Hostinger backup import. Hostinger sites can open
WordPress through the existing authorized login flow. Automatic connector
installation/pairing and SSH-only exports are not implemented. A public URL or
hosting account connection alone cannot export the database. The finished copy
links to WordPress update checks and reviewed plugin activation. Source plugins
start inactive; email, cron and outgoing WordPress HTTP remain blocked locally.

## Matching website connections (0.5.9)

A Hostinger installation and an external Zoer Connect entry with the same HTTPS installation address appear as one website. Hostinger supplies hosting, admin, cache and publishing controls; the saved external connection supplies transfers, backups and local copies. Both existing deep links open the combined view. Local copies and transfer-history filters include either original connection.

Matching preserves installation paths and ports, and does not infer aliases from titles, `www`, redirects or hosting accounts. Multiple matches remain separate. **Show connections separately** / **Combine connections** saves a display preference in this browser. Credentials, permissions, backend IDs and historical job ownership are preserved; the backend and other plugins still see the original inventory entries. Transfers saved independently under the Hostinger connection can be accessed by showing connections separately.

## Shared host services (0.6.0)

0.6.0 moves WordPress Manager onto Zoer's generic plugin services (Zoer `docs/plugin-shared-services.md`, phase P2). It needs a Zoer release with the shared services (runtime operations S8/S9, OAuth browser sign-in S7a and endpoint keys S7b); older hosts refuse the manifest.

- **Permissions.** The WordPress-only names became the generic ones: `runtime:read`, `runtime:lifecycle`, `runtime:commands:read`, `runtime:snapshots`, `runtime:backups`. Zoer treats each pair as the same permission, so the rename alone needs no review. New and reviewed: `runtime:manage`.
- **Local site lifecycle.** New DDEV sites (`site.create`), Move to trash (`site.archive`), the **Trash** dialog (`sites.trash` with `includeArchived`, `site.restore`) and **Remove from Zoer** (`site.removal-plan`, then `site.remove`: `destructive`, approval always, the plan fingerprint and the typed phrase) run as plugin actions on `runtime.create/list/archive/restore/removal-plan/remove.v1`. Sites created by WordPress Manager are recorded as its own; older DDEV sites stay manageable because the DDEV connector allows adoption. Playground sites (a Docker profile, not a runtime connector) keep the workspace routes and the Zoer Computers trash.
- **Hostinger.** "Sign in with Hostinger" uses Zoer's connection dialog (`connections.connect`, alias `hostinger`, several accounts) and then loads the account's websites (`POST /wordpress-manager/connections/oauth`). Accounts already connected to WordPress Manager in Zoer can be loaded from the same panel. API tokens are unchanged. `hostinger.check` verifies one account through host bearer auth.
- **Zoer Connect sites.** "Connect existing site" adds the site as a Zoer endpoint (`endpoints.add`, alias `site`): Zoer confirms, probes the status route and keeps the key. `site.test` then applies the Zoer Connect checks; a site that fails them is offered for removal. Transfers, backups and local copies keep using the Zoer host routes, which read the same endpoints.
- **Workers.** Runtime refusals carry the next one-use ticket; inventories report a refused site and continue. WP-CLI arguments use the host's bounds (1–24 single-line arguments of at most 500 characters).

Transfers still run on the Zoer host (`/wordpress-manager/*`); moving them into this plugin is phase P3 (0.7.0, below).

## Plugin transfer engine (0.7.0)

0.7.0 adds a second implementation of transfers that runs inside this plugin on Zoer's shared services (Zoer `docs/plugin-shared-services.md`, phase P3). It needs the Zoer release with the P3 host changes (runtime transfer peers, `fileset.describe` block digests, runtime-only command bundles, removal-plan approval highlights, the `wordpress-manager.transfers-to-plugin` migration).

- **Engine switch, per site.** Every site stays on the **legacy** engine (Zoer host routes, unchanged) until the user switches that one site to the **plugin** engine in its transfer area and confirms it is a non-production test target. The choice is a catalog record `site-engine:<siteId>`; every plugin-engine action refuses a site without it, before any network call. Production sites are never switched implicitly.
- **Actions** (`worker/transfers.js`, resumable S1 slices; one transfer per site at a time through the lock `site-transfer:<siteId>`):
  - `transfer.pull` / `transfer.local-export` — Zoer Connect site or local DDEV site → verified, sealed file set (`site-export` file rules, S3 downloads, block digests converted to SHA-256) plus a `pull` catalog record.
  - `transfer.preview` — compares a pull with a destination (20 paths per request) and stores the classification for a selective push.
  - `transfer.push` / `transfer.replace` — external writes, approval always, resume manual after a restart: import manifest with 256 KiB block digests, `zbt1-v1` batch upload with the destination's cursor as authority, then the import steps; review and verification park the run (`needs-user`) until `transfer.push.control` approves, finishes or rolls back (resumable since 0.7.1: one approval drives a rollback or cleanup to its end).
  - `copy.local` — pull (or a given pull), new or refreshed DDEV site (S9), staging through the DDEV bridge (S3 runtime peer), the reviewed import scripts in `computer/wordpress/` (S8 `runtime.exec.v1`), its own address (S5), plugins inactive, HTTP check.
  - `backup.restore-local` — five-part UpdraftPlus set uploaded into a file set (`updraft-set` rules) restored into a new DDEV site; the database is converted to data-only SQL by `prepare-updraft.php` (a port of the host's Python preparation, checked against it by the parity harness).
- **Dry runs.** `dryRun: true` on every action: pull downloads into a scratch set and keeps nothing; push and replace build and check the plan and send nothing that writes; local copy restores into a scratch site `zoer-dryrun-<id>` that goes to the trash; restore inspects the archives and plans without creating a site.
- **Parity harness.** `bun tools/parity/transfers.ts --zoer <Zoer checkout>` runs both engines in one process against fake Zoer Connect sites (no servers, no network) and compares file sets byte for byte, import manifests, remote calls in order, destination results, the Updraft preparation and the import scripts. Unit tests (`tests/transfers.test.ts`) use the same fakes.
- **Migration.** `ZOER_URL=… ZOER_TOKEN=… bun tools/migrate-host-transfers.ts [--apply]` runs the operator migration (dry run by default): legacy pulls become retained file sets and `pull` records, profiles become presets, history, local-copy links, deployments and recovery points become catalog records. Engines are not switched by it.
- **New reviewed permissions:** `workspace:filesets`, `workspace:catalog`, `runtime:files`, `runtime:commands:write`, `routes:hosted` (+ `hostedRoutes` family `wp`), the two file rule sets and five runtime command bundles.

Known differences from the legacy engine: push batches are capped by the endpoint body limit (8 MiB − 128 KiB instead of up to 64 MiB); a retried upload slice re-reads the destination cursor first; pulls refuse executable files under `wp-content/uploads` that are not "silence" placeholders already at the pull (the legacy engine refused them only at local copy); artifact reuse between pushes and the remote pause during an import are not used; a remote DDEV site whose Zoer Connect reports its DDEV canonical home instead of the endpoint address is refused as "does not match this connection"; a database import must finish within one 14-minute command.

## Plugin transfer engine fixes (0.7.1)

0.7.1 is the result of the live gate runs of the plugin engine on Zoer Connect test sites. Same Zoer host requirements as 0.7.0. The permission fingerprint changes (upgrade review): `transfer.push.control` became resumable and `transfer.push` may write up to 12 MiB per slice (`worker:output:12582912`); the other output limits rose to 4 MiB, which Zoer does not fingerprint.

- **Prepare speed.** A pull or local export polls the source's export inside one slice until it is ready (no 2 s pause between steps, like the legacy runner), instead of one remote step per slice: a small dry run went from 905 slices / 80 min to 5 slices / about a minute.
- **Slice budgets.** Every slice counts its runtime calls (Zoer refuses the 251st `runtime.invoke` or runtime-peer request; the workers stop at 200 across all phases) and its stdout bytes against `maxOutputBytes` (host-call lines included; 80 KiB kept for the checkpoint). Long loops (preview pages, uploads, manifest declarations, bridge polling, local-copy plans) continue in the next slice instead of being cut off. Tested with a 20,000-file site.
- **Push idempotency.** The import is created in its own slice after a checkpoint with its ID and manifest digest; a retry or resume re-posts the identical manifest and Zoer Connect returns the same import.
- **Delete removes the site's export.** Deleting a pull or local export (`remove: true`) also removes the export on the site or DDEV bridge, so the site accepts the next export; failures to do so are shown.
- **Failed-run cleanup.** A failed pull or local export deletes its partial file set and the source's export and marks its record failed, like a cancel; failed runs are written to the transfer history.
- **Local exports.** The bridge gets the legacy route's body (`sourceUrl` = the site's Zoer address, the full-snapshot filters as an object); bridge refusals fail at once with the bridge's message, only transport errors retry.
- **Files Zoer Connect refuses.** Push and preview leave out files the destination's import would refuse (hidden files such as `.htaccess`, executable uploads, protected files; the rules of `StageStore::validateManifest`) and list them as "skipped: not accepted by Zoer Connect" in the plan, the review and the result. The WordPress-side rule is unchanged.
- **Resumable import controls.** One approved Roll back or Clean up drives every rollback phase (`rollback_reset` … `rolled_back`) or cleanup batch to its end across slices, continuing a rollback from wherever it stopped. Finished push cards follow a later rollback or cleanup of their import.
- **Clean failures.** A definite refusal by the site (an HTTP error answer) ends a push or control with a failure result and the site's message instead of "outcome unknown"; a refused import still before the fence is cancelled and cleaned up in the same run. The push dry run lists tables the destination lacks while "Create missing tables" is off.
- **Pause during upload.** Upload and import stretches end every 30 s and at the end of the upload, so a pause parks the push within about 30 s instead of at review.
- **Review.** The review reason lists the skipped files and reads as sentences; the run card lists them too. The preview's result is its summary.
- **Site paused by a transfer.** The transfer dialog and its run cards open even while a push or rollback fences the site; Recent transfers keeps failures of the last seven days.

## One transfer engine (0.8.0)

0.8.0 removes WordPress Manager's dependence on Zoer's legacy WordPress transfer engine, which Zoer deletes in phase P4 (Zoer `docs/plugin-shared-services.md`, section 16.5). Every managed site uses the plugin transfer engine of 0.7.x. Same Zoer host requirements as 0.7.0; run Zoer's data migration `wordpress-manager.transfers-to-plugin` (or `tools/migrate-host-transfers.ts --apply`) before Zoer removes the legacy engine so earlier transfers stay visible. The permission fingerprint is unchanged (checked with Zoer's `computePermissionFingerprint`: no upgrade review).

- **No engine switch.** The per-site "Transfer engine" control, its typed-host confirmation and the "Plugin engine (test)" badge are gone. The workers no longer read `site-engine:<siteId>` records or refuse a site with `engine_legacy`: pull, local export, preview, push, Find & Replace, import controls, local copy and backup restore work on any managed site. Leftover `site-engine:` records are deleted by the UI once per page load; nothing depends on them.
- **No legacy transfer routes.** The UI no longer calls Zoer's legacy pulls, local exports, pushes and replacements, transfer profiles, transfer history, local copies, copy workflows, pull download tickets, backup restores or the Playground UpdraftPlus import. `tests/host-routes.test.ts` fails if any shipped source references them. The remaining host calls are `/wordpress-manager/sites*`, `/security-sites`, `/connections*` (with `/oauth`), `/connect/:siteId` (+ `/test`), `/hostinger/websites`, `/deployments*`, `/recovery-points`, `/extension-search`, `/extension-actions/*`, `/admin-link` and `/workspace/*` (contract, connectors, Playground computers and login handoffs).
- **Replacements.** Site transfers show their run cards (the site page summary, the Transfers dialog); the Backups tab lists downloads from `pull:` records; the Transfer history tab lists `history:` records (migrated ones are marked "Earlier engine") merged with recent runs; "Make a local copy" uses `copy.local`; "Restore from backup" uses `backup.restore-local` (DDEV only: the Playground restore was a legacy route and is gone).
- **Inventory for the transfer panels.** Zoer Connect sites: `site.test` with `diagnostics: true` reads the site's `/diagnostics` through its endpoint (output limit raised to 2 MiB, below the fingerprinted 4 MiB). Local DDEV export sources: three bounded `wpcli.read` runs (`db tables`, `plugin list`, `theme list`); post types are not in the bridge's read-only WP-CLI allowlist, so local sources cannot filter by post type.
- **Migrated data.** Migrated pulls and local exports (`fs_<pullId>` + `pull:` records, `engine: "legacy-migrated"`) are ready push and copy sources, with or without the `status` field. Migrated `local-copy:` records are listed and can be refreshed; `site-link:` records group local copies under their source site in the sidebar (after Zoer P4, `/sites` always returns `sourceSiteId: null`). Migrated `deployment:` and `recovery-point:` records supplement Zoer's deployment receipts and the Hostinger recovery points; a newly recorded recovery point is also kept in the catalog because Zoer's site details never listed them.
- **Deployments** (DDEV → Hostinger publish, plan/apply/verify) still run on Zoer's `/wordpress-manager/deployments*` routes. They never used the legacy push engine (they upload a DDEV export bundle to Hostinger and call Hostinger's WordPress import), so they cannot move onto `transfer.push`, which imports into Zoer Connect sites.
- **Parity harness.** `tools/parity/transfers.ts` is historical and pinned to Zoer `6b614068` (the last commit before P4 deleted the legacy engine); with a later checkout it exits and says so.

Risks: restore and `copy.local` were not gate-tested on live sites before the switch; every site, including any production site, now runs pushes and Find & Replace through the plugin engine (each still needs Zoer's approval and stops for review before activating).

## Backup, logs and local tooling (0.9.0)

0.9.0 adds Hostinger backup restore, extension controls and saved update receipts, and the local scan/report and isolated profiling interface below. The scanner interface requires the matching reviewed Zoer host capability; upgrading this package alone does not install it.

## Hostinger backup restore

**New site → Restore from backup → Backup format → Hostinger** accepts the matching website `.tar.gz` archive and MariaDB `.sql.gz` dump downloaded from hPanel. Choose both original filenames from the backup folder; the account, domain and timestamp must match. Each file is limited to 1 GiB and the pair to 2 GiB. Verified uploads resume when the same files are chosen after a reload. The dry run inspects the archive without creating a site; large archive counts are explicitly partial, and SQL validation happens during the actual restore.

The real restore uses the existing DDEV local-copy guard, administrator preservation, staged table cutover, serialized URL replacement, content checksums and HTTP verification. It accepts exactly one standard-root WordPress installation and one database with InnoDB tables and literal INSERT values. It rejects multisite, nested installations, links, special files, unsafe paths, executable uploads, unsupported SQL, files over 64 MiB, expanded archives over 2 GiB and databases over 512 MiB. Uploaded configuration and SQL are never evaluated. The destination uses its installed WordPress core; archived core, server configuration, hidden configuration, cache/drop-ins, must-use plugins, Zoer Connect and known archived database-backup folders are omitted. Restored plugins begin inactive; email, cron and outbound WordPress HTTP stay disabled locally. Review core/theme/plugin compatibility before publication.

This adds the `hostinger-backup` file rules and a reviewed `wordpress.hostinger.prepare` runtime command bundle. Install through the normal plugin upgrade review; it needs no Zoer backend deployment. Existing Updraft uploads and restore runs remain compatible.

## Updates and extension logs

**Plugins** and **Themes** show the supported Activate, Deactivate, Update and Delete actions directly. Delete uses the existing reviewed `uninstall` plan, confirmation and recovery workflow. Active themes cannot be deleted or deactivated; must-use plugins and drop-ins have no mutation controls. Available updates and automatic-update On/Off values come from the provider inventory. Missing policy values say **Not reported**; changing automatic-update policy remains in WordPress or the hosting dashboard. Security claims require a provider check; unscanned inventory says **Security: not checked**.

**Updates & logs** shows managed DDEV core updates and their latest operation, plus saved extension-change receipts for the selected website and its explicitly matched connections. Receipts include requested/completed times, operation, extensions, status and expandable details, with plugin/theme filters and refresh. A queued Hostinger request says **Accepted · waiting for verification**. Direct WordPress/hPanel changes and failed extension requests are not included in this receipt list (failures remain in Zoer's audit log); core history is limited to its latest operation. Website health after a change is not recorded in these receipts. Opening the logs does not run Site Health.

## External security scanning component

`security/zoer-wordpress-security` is a pinned submodule of our independent, private [Zoer WordPress Security repository](https://github.com/ahzs645/zoer-wordpress-security). Initialize it with `git submodule update --init security/zoer-wordpress-security` when your Git credentials can read that repository. CI does not initialize the private submodule: `security/runtime/` commits the reviewed ZIP and its source/version/digest descriptor. Builds verify its full SHA-256 and size against the reviewed constants, and `sourceCommit` against the pinned Git submodule. With scanner source initialized, builds also rebuild deterministically and require identical ZIP and descriptor bytes. Updating the scanner requires reviewing and refreshing its source pin, committed artifact and digest constants together; the Zoer host must approve that runtime digest separately. No CI credential or automatic upstream download is added. Its standalone entry point is `python3 tools/security-scan.py --help`; see the component README for private snapshot, direct database, pinned AMWScan and official core checksum inputs.

The standalone CLI scans snapshots and explicitly selected existing databases without executing uploaded WordPress configuration/plugins. Findings and per-check coverage stay separate; failed, skipped, truncated and unavailable checks never produce a clean verdict. It has no automatic cleanup or account deletion. Reports, source archives and credentials must remain outside Git and the site's public filesystem.


## Local scan, review and performance interface

**Scan & report** is a local DDEV workspace. It requires the corresponding Zoer host security runtime; upgrading this UI package alone does not install that host capability. Hosts without the endpoint show an upgrade-required message. External/provider sites retain the existing pull or restore to local-copy workflow and do not receive a direct scan control.

Choose files, database and core checks, then **Run scan** for read-only inspection. Reports retain progress/history, per-check coverage/errors, findings and a full JSON download. Incomplete coverage stays prominent; no-findings results apply only to the checked scope. Core detections are grouped separately only when the host verifies the exact scanned file hash against an official checksum. Existing Databases navigation reuses its inventory entry; phpMyAdmin appears only when the host supplies a supported service link. Direct Scan & report bookmarks and its site refresh use metadata-only local inventory; opening it does not bootstrap site PHP, create a database or run Site Health. Normal WordPress inventory/overview inspection can execute site PHP.

Remediation is separate from scanning. **Review quarantine** is offered only for eligible plugin-file findings; **Review core repair** requires a reported core mismatch or missing file. Quarantine remains partial where the runtime cannot move files atomically into private storage; its control is disabled with the filesystem reason while core repair stays separate. The host prepares an exact file manifest and fingerprint. Core plans show the bound WordPress release, version-file baseline, missing-file state and replacement byte digests. Applying it requires the matching typed phrase. Findings never trigger automatic cleanup. Action history includes the recorded remediation status, scope, errors and private recovery location, including imported operator actions when the host supplies them.

**Tooling versions** distinguishes installed, repository and runtime versions/digests and supports an explicit upstream version check. Checking does not install scanner updates. **Performance profile** is opt-in isolated WP-CLI tooling: enable it, then run Stage or Hook profiling. It executes the local site's WordPress code and does not install a WordPress plugin. The compatible pinned official profile-command **2.1.5** supports Stage and Hook with WP-CLI **2.12.0**; Queries remains unavailable with a compatibility explanation. Stage output can still report database timing and query counts. Saved profile summaries show rounded timing and query/row counts; detailed rows are expandable and Download profile preserves the raw JSON values and tooling metadata. No global WP-CLI upgrade or automatic production deployment is performed.
