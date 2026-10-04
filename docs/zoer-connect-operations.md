# Zoer Connect: operating guide and implementation lessons

> Moved from the Zoer repository (`docs/`) with the Zoer Connect submodule (Zoer `docs/plugin-shared-services.md` section 16.3). `wordpress-plugins/zoer-connect/` now refers to this repository's submodule; other repository paths (`backend/...`, `frontend/...`, `docs/...`, `output/...`) still refer to the Zoer checkout.

This guide consolidates the SparkLab migration on Zoer Connect 0.3.4 and the 0.3.5 large-file implementation. The [plugin README](../wordpress-plugins/zoer-connect/README.md) defines the supported product boundary. The dated qualification and publication report (Zoer's local, untracked `output/ui-audit/2026-09-08-zoer-connect-032/README.md`) contains actual results, release hashes, job IDs and recovery receipts. Older handoffs are historical; consult these current documents before repeating work.

## What has been demonstrated

A managed local DDEV WordPress site can publish database content, selected themes, plugins and media to a shared-hosted WordPress installation through Zoer Connect's authenticated HTTPS API. The migration does not require hosting-panel APIs, SSH access to the destination, or restarting its PHP pool. Local Kubernetes/DDEV administration is a separate source-development pathway.

SparkLab's successful transfer included 3,806 files and a database artifact, totaling 737,665,800 bytes, with 14,491 migrated database rows. All seven published pages matched the source after URL replacement; representative public assets matched byte lengths and SHA-256. The existing destination administrator session still reached the dashboard. Labs retained the source's redirect to the researchers directory. Backups and private recovery journals were retained.

This establishes compatibility with the tested installation, not every WordPress host or plugin. Installing a ZIP alone does not configure pairing, permissions, destination readiness, matching schemas or storage.

## Repeatable first migration

1. Establish the exact source and destination. Confirm the destination URL, selected resources and replacement policy. Keep an independent destination backup and a verified source snapshot.
2. Install the qualified release through WordPress's plugin upload/replacement screen. Test the actual native connection afterward; the ZIP's version and a successful local build do not prove what the live server executes.
3. Pair the destination's connection key in Zoer and enable Push. In WordPress Tools → Zoer Connect, enable Shared-hosting migration with its explicit replacement acknowledgement.
4. Prepare the source export through Zoer's managed-local pathway. Preserve both canonical/original source URLs and the managed HTTPS alias for replacement. Select database, themes, plugins and media as needed. Core and MU-plugin publication are outside the current import boundary.
5. Compare selected source table schemas with the destination before cutover. Every imported nonidentity table must exist with a matching schema, InnoDB engine and primary key. Check plugin versions and normal schema initialization; do not silently omit missing plugin tables.
6. Review exclusions and filenames. SparkLab excluded hidden paths and WP Migrate scratch files; that was a reviewed site-specific choice, not a rule to discard every hidden file on every site. Some installations rely on hidden configuration files that require separate handling.
7. Start one native push and let one controller advance it. Job IDs, offsets and journals support retrying the same operation after a lost response. Do not run UI Resume and a separate step loop concurrently.
8. Uploading, cached-file reuse, file checks and the database scan precede the protected import. Ordinary WordPress requests pause during table preparation, row staging, verification, file application and table activation. Maintenance can last minutes; small requests do not imply zero downtime.
9. At `verification_required`, finish through the same authenticated job to reopen WordPress. Verify public pages, redirects, representative files, rewritten URLs, retained administrator access and connector health. HTTP 200 alone is insufficient: compare actual content.
10. Retain original backups and record the completed job, installed release and evidence. Subsequent edits can make automatic rollback refuse; backup retention does not promise lossless reversal after new content is written.

## Shared PHP pools and writer protection

The original verified-worker design inspected every PHP worker under an operating-system account. On shared hosting, that account may also run unrelated sites, so worker isolation cannot be inferred from a successful WordPress login or a period of waiting.

Shared replacement is an explicit alternate policy. Its private readiness receipt binds the destination and protection code without declaring that all workers were verified or external writers stopped. The earliest site MU bootstrap pauses ordinary requests reaching it and serves authenticated recovery before regular plugins/themes run. Earlier requests, early drop-ins and external SQL writers are not guaranteed to stop. Avoid concurrent edits; this is replacement, not a merge or distributed multi-host transaction.

Keep the stricter mode available for environments that can establish its conditions. Never turn shared-mode consent into a false worker-isolation claim. Do not delete an active fence or rotate its key to resolve a stalled job.

## Export and import architecture

Managed-local database exports run in an independent DDEV CLI worker with one consistent InnoDB snapshot. A large database cannot acquire transaction consistency by continuing OFFSET reads in fresh PHP requests. A failed snapshot must start a new transaction and must never advertise partial output as complete. Hosted remote Pull still has its separate single-request snapshot limit; successful local-to-hosted Push does not remove that limitation.

The importer parses the supported snapshot format as data. It stages matching tables, records replayable row sequences and verifies counts/fingerprints before activation. It retains original tables by rename and backs up selected files. Global rollback checks precede restoration. Destination URLs, administrator identities, roles, connector identity and selected environment settings are preserved. Source post authors map to the retained destination connection administrator; source users are not substituted for destination users. The destination cron queue is retained.

Authenticated recovery must remain reachable while normal WordPress boot is blocked. In the managed proxy, connector routes bypass ordinary WP-CLI canonical-URL discovery, which would itself be blocked by the fence. Credentials and trusted HTTPS metadata remain confined to the connector namespace.

## Failures that changed the implementation

| Finding | Resolution and continuing lesson |
| --- | --- |
| Shared PHP pool prevented strict worker readiness | Added explicitly acknowledged shared replacement; no host restart or isolation claim. |
| Legitimate font commas and Unicode screenshot spaces failed an ASCII filename whitelist | Added bounded Unicode filename support. Traversal, hidden/dot segments, controls, encoded paths, symlinks, executable uploads and connector/config files remain rejected. |
| Source had three Simply Static tables absent on live | Inspected the matching plugin's initialization; activated and immediately deactivated the already installed plugin through WordPress to create its schemas. No static export ran. Took a second snapshot and verified all schemas matched. This action is plugin-specific, not a universal schema repair procedure. |
| Action Scheduler schedule object failed URL replacement before the first row | Preserve opaque serialized bytes unchanged when no literal rule can match, without deserializing objects. Objects/references needing changes and regex object processing remain unsupported. Test real plugin data, not only tiny core fixtures. |
| Retrying a fully staged migration would repeat a long upload | Reuse exact matching files from terminal jobs bound to the same destination/key. Link them in bounded steps and rehash before protection/cutover. Upload and authenticate database chunks again. Skip automatic reuse of incomplete file caches. |
| Whole operations across thousands of files created many round trips | Batch file lifecycle/checksum work with durable progress and bounded step budgets. Table activation keeps individual recoverable transitions. Preserve the final protected rollback checkpoint even when batching. |
| A generic error concealed which row failed | Read the saved remote phase through the authenticated API. Reproduce on the disposable peer with the actual snapshot. Do not print raw SQL, credentials or serialized private values into logs. Structured safe error diagnostics remain an improvement opportunity. |

The first live attempt uploaded and checked all artifacts, then failed on an unchanged serialized Action Scheduler object. Native rollback completed before any content activation and reopened the original site. The corrected attempt reused the uploaded files, imported the actual database successfully and completed publication. See the dated report for IDs and timings; do not restart or modify those historical jobs as fixtures.

## Size limits: Zoer Connect versus WP Migrate

**The 32 MiB individual-file cap was the Zoer Connect 0.3.4 limit. It is not a general WordPress, Hostinger or WP Migrate limit.** Precisely, it is 32 MiB = 33,554,432 bytes, not 32,000,000 bytes. It applied to each selected incoming file and an existing destination original that must be backed up. Version 0.3.5 supports 2 GiB per file with the updated Zoer backend; the legacy path keeps its old cap.

| Boundary | Zoer Connect 0.3.4 |
| --- | --- |
| One incoming file / existing original | 32 MiB |
| One decoded upload block | 256 KiB |
| Native import JSON request | 2 MiB |
| Destination database artifact | 2 GiB |
| Row staging batch | 4 MiB |
| Replacement input/output string | 1 MiB, with bounded nesting/rules |
| Managed-local export | 2 GiB total; 30-minute worker deadline |
| Hosted remote database Pull | 256 MiB; up to 40 seconds in one snapshot request |

The legacy file cap is enforced in `backend/src/wordpress-push.ts` and `includes/TransferImport.php`. Network chunks already support transferring one file in many requests. However, `includes/FilePublication.php` still performs whole-file copy/hash operations during preparation, backup, activation and restoration. `TransferImport` also hashes whole files during artifact checks. A two-second batch deadline is checked between operations; it cannot interrupt one large copy/hash in progress. The cap bounds those operations' input size, but it is not a universal wall-clock guarantee on slow storage.

The provided WP Migrate Pro **2.7.11** source takes files larger than its transfer bottleneck and splits them into chunks in `class/Pro/Transfers/Files/Payload.php`. `class/Common/Transfers/Files/Chunker.php` resumes from a byte offset and uses bounded stream copying. That implementation does not treat the request bottleneck as a maximum total file size. The reviewed paths do not impose Zoer's fixed 32 MiB rule; this is not a claim that every WP Migrate feature or host has unlimited capacity.

Official documentation describes adaptive request sizes and distinguishes request packing from overall migration size: [WP Migrate 2.4 transfer architecture](https://deliciousbrains.com/wp-migrate-db-pro-2-4-released/). Hosting request limits can still reject a request: [413 troubleshooting](https://deliciousbrains.com/wp-migrate-db-pro/doc/413-request-entity-large/). These sources concern WP Migrate by Delicious Brains; do not confuse it with All-in-One WP Migration's separate limits/licensing.

### Large-file work completed in 0.3.5

The following requirements were implemented and qualified after 0.3.4:

- Made verification, backup, destination staging and restore resumable within a large individual file. Persist byte cursors and a verifiable block/hash scheme across requests; do not rely on an in-memory PHP hash context surviving.
- Preserved atomic destination replacement, original permissions, disk-space checks and idempotent recovery after interrupted copies. A partial temporary file must never become the live file.
- Qualified files over 32 MiB, large destination originals, interrupted uploads/copies, lost responses, corruption, low disk space and rollback after activation on the disposable peer.
- Raised matching limits behind capability negotiation after qualification. Merely changing the number does not qualify large-file backup or recovery.

### 0.3.5 protocol and qualification

`ChunkedFilePublication` journals per-block copy/check progress, uses stable temporary names, and atomically renames only completed verified copies. The updated backend computes whole-file and 256 KiB block hashes from the same source bytes. The destination checks those authenticated block hashes, including reused artifacts; original files have independently recorded block digests. Copy retries truncate to the last committed offset. Each rollback attempt resets file preflight before global restoration. Old manifests and journals retain `FilePublication` recovery.

New-client/new-plugin file and original limits are 2 GiB; the source export total is still 2 GiB. A destination must advertise `chunkedFilePublication` before Zoer sends block manifests or allows files over 32 MiB. Cached uploads from a different file protocol are not reused automatically. Whole-file hashing/copying in the legacy implementation does not apply to new block manifests.

Qualification used a 37 MiB replacement over a 41 MiB original under a 16 MiB PHP memory limit; native HTTPS tested a 40 MiB replacement over a 48 MiB original, both alone and with database import. Real PHP-FPM worker deaths during application/restoration recovered exact bytes, permissions, business records and administrator identities. Injected low-space/short-write errors, source/backup corruption, lost rename journals, changed destination contents and empty/absent files were covered. This does not claim a measured 2 GiB host stress test. See the large-file evidence (Zoer's local, untracked `output/ui-audit/2026-09-09-zoer-connect-large-files/README.md`).

## Verification and operational details

Use `zoer-connect-transfer-peer` for destructive tests, preserving its URL and administrator access. Qualification includes permissions/revoked keys, expired exports, interrupted downloads, real HTTPS imports, process death during table activation, fresh-request rollback, retained administrator access and rollback after dashboard access. Check both business records and runtime-state preservation. Source-fixture and engine tests are not substitutes for a real WordPress HTTP import.

Run artifact-free PHP lint/tests before packaging; package reproducibility/layout checks create ZIPs and belong after integration qualification. Strict-worker unit fixtures can see unrelated FPM workers if run under the same UID. Run those isolated fixtures under a distinct test UID; do not stop real workers or weaken the readiness assertions to force a pass.

WordPress can regenerate transients and untouched blank auto-drafts during ordinary admin visits. Fingerprint exclusions should remain narrow and evidence-based. Preserve detection of meaningful posts/options/metadata changes. Revoke only test-created sessions and keys; restore the peer's previous connection and verify no active fence remains.

For browser upload, use the actual file chooser and review WordPress's current/uploaded version comparison, then verify the update result and native version probe. A stale Zoer browser tab may need reload after deployment changes asset URLs. Lazy-loaded images should be checked after visiting their section; an unloaded image alone is not proof of a broken asset.

Keep local source changes, plugin ZIP qualification, live WordPress installation, Zoer container rollout and live publication verification separate in reports. The DDEV bridge is a separate deployed service from server-dev. Preserve unrelated work in the shared checkout. Store keys, SQL artifacts and private filesystem data in private storage; documentation should contain only identifiers and nonsecret evidence needed for recovery.

## Register a website from another host

In Zoer → WordPress, choose **Add site**, enter its canonical HTTPS URL (including a WordPress subdirectory if applicable), an optional name and the generated Zoer Connect key. The backend verifies `/status`, the returned site identity and plugin capabilities before creating a host-only encrypted secret and durable external-site record. A hosting-provider account is not required. Existing listed addresses and concurrent duplicate submissions are rejected; select the existing site to reconnect or replace its key.

External sites appear as **External · Zoer Connect**. Use **Connect Zoer** for testing, key replacement, remote Pull and managed-local Push, according to the destination's permissions/readiness. Adding a site does not transfer content. Remote Pull downloads artifacts; a completed full download now exposes **Make a local copy**, followed by **Create local copy**. This creates a dedicated DDEV site, resumes chunked artifact uploads and imports verified database records while preserving the new URL and administrator. Source plugins remain inactive; WordPress mail, HTTP requests and automatic cron are disabled. Copy jobs retain progress and errors for explicit resume. The Aram external-source UI copy is qualified through import, file checksums, homepage/media and administrator login; broader compatibility remains partial. Full plugin/theme administration and hosting management remain outside this connector surface. The existing 0.3.5 plugin works; registration is a Zoer application feature, not a new plugin release.

Disconnect removes the saved key while retaining the external site entry for reconnecting. Keep the original connection available during migration recovery. Keys never belong in query caches, URLs, audit output or public site records. The native HTTPS requester pins DNS results, validates certificates and does not forward the key through redirects.


### Private storage diagnostics (0.3.6)

Pull start and resume require a fresh successful storage readiness check. Older plugins receive an actionable fallback message; 0.3.6 reports a safe reason code without disclosing paths through the connector API. WordPress administrators can inspect the path and PHP restrictions under Tools → Zoer Connect. First-time configuration validates a writable private folder outside public roots. A configured constant remains authoritative; existing configuration, transfer data or installed import protection prevent relocation. Never put export snapshots in public uploads to bypass this check.

A connector key does not grant WordPress administrator access or permission to change filesystem restrictions. If no permitted private folder is writable, a plugin update alone cannot make storage available. Record the actual diagnostic before selecting a remedy.

Local-copy import currently requires a complete database/themes/plugins/media selection without exclusions. It preserves fresh local users, deactivates source plugins, maps authors to the local administrator and retains database backups. Resume recovers a lost database cutover receipt. It does not provide a general rollback UI for a partially created copy; it targets only its dedicated new site. Hosted source database exports still have the single-request snapshot limit above.


### WP Migrate reference for large file counts (September 9, 2026)

Inspected the user-provided WP Migrate Pro 2.7.11 package at `/Users/ahmadjalil/Downloads/wp-migrate-db-pro 2`. Its `class/Common/Filesystem/RecursiveScanner.php` tracks directory offsets and completion in a saved manifest, with a default 5,000-entry scan-cycle bottleneck. `class/Common/Queue/QueueHelper.php` reads queue pages of 1,000 items. `class/Pro/Transfers/Files/Payload.php` packs multiple small files up to a request byte budget, while `class/Common/Transfers/Files/Chunker.php` persists large-file byte offsets. `class/Common/Util/Util.php` calculates the transfer budget using server post limits, a configurable maximum and an upper default of 25 MiB. These are batch/request limits, not a 20,000-file total-site cap.

Zoer's paged-export work follows those architectural patterns with independent implementation: durable bounded traversal, paginated manifest delivery, bounded batches of small files and checksum-verified resume. Qualification and rollout status belongs in dated UI audit evidence. This does not remove the separate single-request database snapshot or individual-file export limits.

### Dotfile behavior in the WP Migrate 2.7.11 reference

`class/Common/Filesystem/Filesystem.php:516` scans dotfiles and skips only the exact `.` and `..` entries (line 540); its WP filesystem fallback asks for hidden files too. `class/Common/Transfers/Files/FileProcessor.php:287` retains files when no exclusions are supplied; `class/Common/Transfers/Files/Excludes.php:26` implements pattern exclusions with `!` inclusion overrides. There is no blanket dotfile ban in these paths. Thus selected content `.htaccess` files are eligible unless an exclusion matches. Root rewrite regeneration is separate (`class/Common/Migration/Flush.php:91`).

Aram's 0.3.7 snapshot contains 21,745 files / 278,954,616 bytes. Zoer's blanket hidden-component rule rejected upload `.htaccess` protection files and inert plugin `.editorconfig`, `.gitignore`, `.gitkeep` metadata (including a file-manager `.trash` placeholder). Narrow content-path allowances preserve those files; traversal components, hidden credentials and Git repositories remain rejected. The WPForms upload `index.php` is a fixed 404-header placeholder; the local-copy gate accepts only a bounded, exact known placeholder grammar and still rejects arbitrary upload scripts.

### Local-copy transport

The DDEV bridge accepts authenticated `POST /projects/:project/connect-copy-batches/:copy` for an existing private copy reservation. Requests are bounded to 2 MiB JSON, 1 MiB decoded bytes and 256 operations. Only integer artifact indices and offsets are accepted; callers cannot supply destination file paths. The bridge verifies the DDEV container label, streams data through Docker stdin to a fixed PHP receiver, checks private staging/pending state and rejects symlinks. Each write is flushed/fsynced and checked against its chunk and final file hash. File ownership is retained from the private staging directory. The backend advances its durable cursor only after acknowledgment. Retries truncate uncommitted suffixes before replay.

This replaces the slow 24 KiB shell-payload loop for local copies. It uses the already authenticated private DDEV bridge; it does not expose WordPress export keys or require another source plugin update. Deploy the bridge files before the matching backend. DDEV CLI `exec --raw` did not forward stdin in the tested runtime; Docker `exec -i` did. Retain peer tests for native transport rather than assuming CLI stdin works.

Local-copy URL replacement now parses standard PHP serialized arrays, objects, scalar references and nested serialized strings directly; it updates byte lengths and preserves keys/class names/reference IDs without calling `unserialize` or object hooks. Opaque `C:` payloads that require replacements still need an adapter and fail rather than being rewritten blindly. WP Migrate 2.7.11 reference `class/Common/Replace.php:640–735` has reference-check skipping and recursive object/value handling; our implementation is independent and does not construct plugin classes. This support currently applies to the backend local-copy importer; do not advertise it as a changed plugin Push contract.

### Selective Push (2026-09-09)

The Push UI now has a comparison/selection pathway alongside the full-export option. The destination plugin must advertise `selectivePush`. A completed immutable local export is compared in bounded read-only requests; new and changed files are selected by default. Filter paths to scope a theme/plugin/folder, clear matches, and choose individual files. Database content is explicitly unchecked and remains replacement, not a record merge. Destination-only files are retained. Selective database imports preserve destination plugin/theme activation settings.

Destination hashes and source hashes are kept in a private expiring preview, bound to the saved connection generation. Import creation validates the reviewed subset; each selected file carries a destination hash/null precondition that is checked before file preparation under the writer fence. A conflict requires rollback and a fresh comparison. The existing full-export path remains for older plugins and large destination files: selective comparison currently blocks destination files over 32 MiB as well as paths rejected by publication validation. See `output/ui-audit/2026-09-09-selective-push/README.md` for qualification status and WP Migrate source references. Do not claim row-level DB merging, deletion synchronization or unrestricted file comparison.

## Cache drop-ins and shared-hosting replacement (0.3.9)

WP Migrate Pro 2.7.11 `class/Common/Migration/Flush.php` uses `wp_cache_flush()` and regenerates rewrite rules after migration. Zoer 0.3.9 supports regular advanced-cache.php and object-cache.php in explicitly acknowledged shared-hosting mode, preserving its narrower guarantee: early cache responses and external writers are not fenced. Strict verified-worker setup still rejects early drop-ins. Keep `/wp-json/zoer-connect/` and its query-route equivalents out of page caches. Purge page/CDN caches after publication; object-cache invalidation alone does not purge them. Native import/recovery authentication reads the current database key, and object-cache flush failures retain the import fence for retry. Do not remove cache files temporarily and then restore them under a strict-mode bootstrap: that invalidates protection. See the scoped plugin release evidence for tested boundaries.

On Aram, PHP `link()` is disabled. Version 0.3.10 supports atomic setup publication without it and reports artifact reuse unavailable, allowing ordinary authenticated upload instead. Never assume a hosting PHP function exists merely because the local DDEV image permits it. PHP storage permission tests must run as an unprivileged user. Aram static HTML responses also carry a one-year browser TTL: purging Breeze does not invalidate already-loaded browser assets; use a hard refresh for existing visitors, or plan a versioned embed URL in a future page update.


### Packaged development metadata during Pull

Plugin and theme release ZIPs can include Composer/npm development metadata and `.github` workflow files. The backend Pull validator accepts reviewed complete metadata basenames only beneath plugin/theme paths, including nested vendor packages. It checks every hidden path component independently: `.git` repositories, `.env` variants, `.npmrc`, SSH/AWS credentials, traversal and unknown dotfiles remain rejected. This is a backend compatibility policy, not a change to the connector's publication validator or a new WordPress plugin release. Do not exclude entire plugins or delete source protection files to work around a rejected metadata entry.

When a Pull reports an unsupported path, inspect the existing export manifest for all hidden components before extending the reviewed policy; test both representative package layouts and hidden-credential/traversal rejection. Retry the same saved Pull after deployment when its resource selection remains valid. Zoer Connect 0.3.12 excludes Finder metadata and repository control files from new hosted export profiles by default. Older plugin releases need explicit `**/.DS_Store`, `**/__MACOSX/`, and any source-specific reviewed metadata exclusions on a new Pull. Keep database, themes, plugins and media selected. Record source-specific evidence in `output/ui-audit/`.

### PGAIR live follow-up (2026-09-23)

The PGAIR selective Push retained the destination's active plugin/theme options, as designed in `backend/src/wordpress-push.ts`; the Wood Smoke course therefore required separate activation of Zoer Content Modules after its files were published. WP Migrate Pro 2.7.11's `class/Common/Sql/Table.php` exposes a `keep_active_plugins` setting for its own migration behavior. Do not infer that Zoer Push activates newly copied plugins or updates WordPress core. The destination WordPress dashboard updated core from 6.9.9 to 7.1.2 separately. A verified Pull saved the live database, themes, plugins, and uploads on the Zoer server before that update (650.92 MB, 7,619 files); core and must-use plugins were not selected. Zoer Connect 0.3.12 was then installed on the live destination and Zoer's connection test reported plugin 0.3.12. The homepage and embedded Wood Smoke course loaded afterward. The public GitHub update feed contains 0.3.12, but a later dashboard update from that feed still needs a newer release to verify end to end. The Zoer Push UI clarification passed local frontend checks but could not be rolled out while the private k3s node at `10.70.20.50` was unreachable.

### Destination settings and permalink refresh (0.3.13)

WP Migrate Pro preserves `blog_public` and refreshes rewrite rules after a migration. Zoer Connect 0.3.13 preserves the destination `blog_public` option during database replacement. It queues a soft rewrite refresh for the first ordinary WordPress request after completed database/plugin/theme publication or rollback, so the final code and options are loaded before rule generation. It does not regenerate `.htaccess` or purge host/CDN caches. Generated `rewrite_rules` and the pending marker are excluded from rollback content fingerprints, while authored `permalink_structure` and `blog_public` remain guarded. See `wordpress-plugins/zoer-connect/releases/0.3.13.md` for the disposable WordPress qualification.

On 2026-09-23 the 0.3.13 ZIP and manifest were published to the public `ahzs645/zoer-connect-releases` repository. The PGAIR WordPress dashboard discovered the update from its existing 0.3.12 install and completed the native plugin update. The plugin remained active, its admin page displayed 0.3.13, and Zoer's connection test reported 0.3.13 with Push/Pull still enabled. WordPress Reading Settings still had “Discourage search engines” unchecked, and both the homepage and Wood Smoke course returned HTTP 200. This verifies the GitHub-fed update path without running a second production Push. The Zoer Push UI clarification remains local because the private k3s node was unreachable; do not describe that UI change as deployed.

The private `ahzs645/zoer-connect` source repository was synchronized through PR #2 and tagged `v0.3.13`. The tagged GitHub Actions run passed PHP 8.1–8.3, receipt/package checks, private release creation, and idempotent public-feed publication. The private release ZIP and public feed both report SHA-256 `7ac3b68e64c01b0c1f6feac8bd29588b2bd6d04d630c1249bfd5738bba91e6d5`.

## Zoer Connect 0.4 and WP Migrate parity (stable, 2026-10-02)

**Status: live and qualified on the OTE deployment.** Stable connector 0.4.0 and WordPress Manager 0.5.4 passed real Zoer UI, native public HTTPS, authorized Hostinger review-site and dedicated DDEV qualification. See [the dated audit](https://github.com/ahzs645/zoer/blob/main/docs/qualification/zoer-connect-040/README.md), the sealed connector receipt and release notes. New options remain capability-gated; older plugins keep their legacy behavior. Documented size/schema limits still apply.

| Area | Location |
| --- | --- |
| Option types, validation, capability gates | `backend/src/wordpress-transfer-options.ts` (mirrored in `frontend/src/lib/api/types/wordpress-transfer.ts` and `frontend/src/lib/wordpress-transfer/options.ts`) |
| Push and replace jobs, batch loop | `backend/src/wordpress-push.ts` |
| Batch packing, framing, adaptive controller, learned limits | `backend/src/wordpress-push-upload.ts` |
| Connector requests (JSON and binary), diagnostics cache | `backend/src/wordpress-connect.ts` |
| Pulls, downloads, runners | `backend/src/wordpress-pull.ts`, `wordpress-pull-runner.ts`, `wordpress-tar-stream.ts`, `routes/wordpress-pulls.ts` |
| Push, replace, profile, history and diagnostics routes | `backend/src/routes/wordpress-transfers.ts` |
| Profiles and history | `backend/src/wordpress-transfer-profiles.ts`, `wordpress-transfer-history.ts` |
| Local exports, inventory, local copies | `backend/src/wordpress-local-export.ts`, `wordpress-local-copy.ts`, `ddev-bridge/src/connect-export.ts`, `connect-export-worker.php`, `connect-inventory.ts` |
| Dialog UI | `frontend/src/components/extensions/WordPressConnect.tsx`, `frontend/src/components/extensions/wordpressTransfer/` |

### Connect dialog

Open **WordPress** and select a site. External sites show **Connect Zoer** in the site header; managed sites (DDEV, Hostinger) with the plugin active show it in the **Deployments** tab ("Zoer Connect is installed") and the **Plugins** tab. The dialog (a sheet on phones) shows:

- **Connected site card:** URL, last verification, plugin version, API version and migration mode; Push, Pull, Publish and Private staging chips; one chip per advertised 0.4 capability; diagnostics warnings (plus a table-prefix mismatch warning during Push); "Update available" when the plugin's own update check reports a newer version, or an "older Zoer Connect" hint when `apiVersion` is below 2. **Connection details and diagnostics** lists WordPress, PHP, database size, MU plugins and drop-ins, with **Test connection**, **Replace key** and **Disconnect from Zoer**.
- **What do you want to do?** Pull, Push, Find & Replace, Backup or Export. An unavailable action stays visible with its reason (Pull disabled, private storage unavailable, Push disabled, no import-capable plugin, or "Requires Zoer Connect 0.4.0" for Find & Replace).
- **Saved profiles** bar: load, save, overwrite, rename and delete profiles of the current settings.
- **View local copies**, and a note that transfers keep running on the server when the dialog closes.

Settings panels are collapsible with a one-line summary. Defaults for a new run:

| Action | Panels and defaults |
| --- | --- |
| Pull | **Database:** included; all tables with the site's prefix (or selected tables); all post types (or selected, which starts without `revision`); exclude revisions off, exclude spam off, exclude transients on. **Files:** themes, plugins and media on; themes and plugins "All" (or Active only, Only selected, All except selected); media "All uploads" (or modified since a date, or since the last migration, which resolves to the date of this site's newest completed Pull with media, or all uploads when there is none); must-use plugins and WordPress core off and marked download-only; exclusion globs, one per line (up to 100). **Start pull.** A ready Pull offers **Make a local copy**. |
| Backup | Database only (locked). **Back up database** keeps a verified snapshot on the Zoer server. |
| Export | Pull panels, then **Start export**; the finished download offers **Database (.sql)** and **Archive (.tar.gz)** to this device. |
| Push | **1. Choose the source:** Local DDEV site (a running DDEV site, exported by the bridge) or Another connected site (Pulled from its plugin); the source's Database and Files panels; **Prepare export** / **Pull from source**; choose **Push this** on a verified result. **2. What to push:** Compare and select files (default, needs `selectivePush`) or All items. **3. Options:** Database "On the destination" (replace GUIDs on; active plugins and active theme Automatic; authors "Match users by login or email"; create missing tables off), Find & Replace (automatic replacements on with a read-only preview of the URL and path rules; URL variants on; replace filesystem path on; custom rules; review before applying off), Safety (Keep site online while staging; purge page caches on). **4. Confirm:** type the exact destination address and accept replacement (shared-hosting mode) or confirm WordPress-only writers (verified-worker mode); **Push all items** / **Push N selected items**. |
| Find & Replace | Tables "All tables except users and user meta" (or selected; users and usermeta are never offered); at least one rule; "Also replace in post GUIDs" on; Safety with the fence locked to online staging; purge caches when supported; confirm; **Preview replacements**. It always stops for review. |

Push and Find & Replace jobs appear below their flow with stage, bytes, files, tables and rows, elapsed time, the upload summary (`N requests · transport · batch size`) and controls: **Pause**, **Resume**/**Retry**, **Apply changes** or **Cancel** at review, **Finish and reopen site** at verification, **Roll back…**, **Clean up backups…** (after a terminal state) and **Delete record…** (removes Zoer's record only). The WordPress Manager adds **Backups & import → Backups on the Zoer server** (Back up database now, Database (.sql), Archive (.tar.gz), delete) for Zoer Connect sites, and a **Transfer history** tab filtered by site and type.

The UI defaults (`defaultImportOptions`) are variants, paths, GUID replacement, author matching, online staging and cache purge on; table creation and review off; activation settings automatic; transients excluded. They differ from the protocol defaults on purpose: an omitted option means 0.3.14 behaviour to the plugin (`legacyImportOptions`).

### Capability gating

- **Backend.** `/status` is read fresh when a Push or replace job is created, and the capability flags are stored on the job; the saved connection keeps `apiVersion` and capabilities from the last connection test. `importOptionsToPlugin` sends each option only when its capability is advertised (defaults included). A non-default choice without its capability is refused with "Update Zoer Connect on the destination to 0.4.0 to use …, or turn that option off." With no capabilities and the legacy defaults, the create body is exactly the 0.3.14 body (no `options` key). Pull filters are checked against the source by `assertExportCapabilities`; local DDEV sources support every filter. A table-subset source sends `partialDatabase` and needs `databaseFilters` or `createTables`. Replace jobs need `siteReplace`, and cache purge in them needs `cachePurge`. `/diagnostics` and the new import actions map a 404 to "needs Zoer Connect 0.4.0".
- **Frontend.** Controls whose capability is missing are disabled with "Requires Zoer Connect 0.4.0 on the destination" (or "on this site" for sources). Before sending, `applyImportCapabilities` and `applyExportCapabilities` downgrade any unsupported option to its 0.3.14 value and list what was turned off, so the UI does not trip the backend refusal.

### Server-owned runners

Pulls, local exports, Push jobs, replace jobs and local copies each run in one backend loop per job (`WordPressTransferRunner`, `runLocalCopy`). Closing the browser does not stop them. Checkpoints are persisted after every step; after a backend restart a job shows `runner: "idle"` and needs **Resume**, which always re-reads the destination's state first.

- Transient failures (network errors, HTTP 5xx, 429, plugin 409 "busy", DDEV bridge timeouts) are retried three times with 1 s, 3 s and 9 s delays; then `lastError` is recorded and the loop stops (status `failed`, **Retry** resumes). A pause during backoff is not a failure. Batched uploads add their own backoff inside the step (below).
- Pause is cooperative: the loop stops between steps. During import phases, when the plugin advertises `importPauseResume`, Zoer also calls the plugin's `/pause` and later `/resume`. Pause does not release a destination fence that is already reserved.
- Approve waits for the current step, calls `/approve` and restarts the loop. Rollback pauses the loop first; a refused rollback leaves the job `complete` and shows "The destination changed after this import." Cleanup repeats the plugin's bounded `/cleanup` (up to 60 calls or 120 s per request) until it reports `cleanedUp`. Delete removes only terminal (or never-sent) local records.
- The client-driven `/pushes/:id/step` remains for older clients and is refused while the server loop runs. One non-terminal Push or replace job is allowed per destination.

### Batched adaptive upload

When the destination advertises `capabilities.batchUpload` (and 256 KiB blocks), Push uploads through `POST /imports/{id}/batch` instead of one `/chunks` request per block. Jobs created against older plugins have no `transfer` state and use the unchanged `/chunks` loop.

**Adopted from WP Migrate:** packing many small files and several blocks of large files into one request, adapting the request size to what the host accepts, and learning a host's body limit from 413 responses. **Kept from Zoer:** every 256 KiB block is re-hashed locally against the sealed `chunkSha256` before it is sent and verified by SHA-256 on the destination before it is written; the durable journal, idempotent retries, private staging and about 2 s of server work per request. **Deliberately not copied** from the WP Migrate 2.7.11 reference: MD5-only payload integrity, appends that are not idempotent when a request is retried, writing media into the live tree during transfer, and no resume after an interrupted upload.

- **Cursor.** Every runner start, and every `gap`/`bounds` rejection, re-reads `GET /imports/{id}?view=upload`; the local index and offset are never trusted over the destination's. More than five resyncs without progress fail the job ("The destination upload position stopped advancing").
- **Packing.** Spans are packed forward from the cursor while the raw total fits the batch size B (always at least one block) and within 1,024 spans. Zero-byte files have no spans; artifacts already complete are skipped.
- **Adaptive size.** B starts at 768 KiB, or 0.75 × the learned batch size for this site, clamped to [256 KiB, min(`limits.maxBatchBytes`, learned ceiling)]. After an accepted batch: `deadlineHit` → B/2 (and marked slow); under 1 s and never slow → 2B; under 1.6 s → 1.25B; over 2 s → B × (2000 / t) × 0.9.
- **Body limits.** A 413 or `zoer_import_body_limit` is not a failure: if the plugin reports a `maxBatchBytes` smaller than the sent body, Zoer adopts it and sets the ceiling to 0.95 × that value; otherwise the ceiling becomes 0.75 × the sent wire size. The batch is retried immediately without backoff or a transport change. A 413 for a one-block batch counts as a failure.
- **Failures.** Timeouts, resets, 5xx, 429 and "busy" halve B and back off 1, 2, 4, 8, 15, 30 s with ±20% jitter, honouring `Retry-After` (up to 5 minutes). Eight consecutive failures at the 256 KiB floor move to the next transport.
- **Transports and fallback.** `octet-stream` (ZBT1 frame) → `multipart` (file part `batch`) → `json` → legacy `/chunks`, limited to what `/status` advertises. A 415 for a batch body moves to the next transport at once (for example a firewall rule against `application/octet-stream`). A `decode` rejection turns deflate off, or without deflate moves to the next transport. When every transport is exhausted the job pauses with `lastError`; **Resume** starts the chain again. `unverifiable` artifacts (files sent without block digests because the destination lacks `chunkedFilePublication`) go through `/chunks`. `digest_mismatch` fails the job ("Source artifact changed.").
- **Deflate.** Only when `batchDeflate` is advertised and the batch contains compressible spans (`database.sql` and `.sql .js .css .json .html .txt .svg .xml .po .php`). Each compressible span is compressed as a zlib (RFC 1950) stream at level 6 and kept only if at least 10% smaller; other spans are stored as zlib level 0, because `enc` applies to the whole batch. The batch is sent deflated only when the whole payload shrinks by at least 10%. The JSON transport is never deflated by Zoer; its raw budget is (`maxJsonBatchBytes` − 64 KiB) × 3/4.
- **Timeout.** min(55 s, 4 × `deadlineMs` + the body at 1 Mbit/s), at least 1 s.
- **Sender.** `requestWordPressConnectBody` shares the JSON requester's DNS pinning, headers, 8 MiB response cap and error mapping; it accepts only `/imports/{id}/batch` and the three content types.
- **Learned per-site limits.** `DATA_DIR/wordpress-pushes/upload-limits.json` (private, atomic) holds `{batchBytes, ceiling, updatedAt}` per SHA-256 of site ID and URL, newest 500 entries. It is written after a body-limit lesson and when an upload completes.
- **Public view.** Push jobs expose `progress.requests` and `transfer: {transport, batchBytes, ceiling, wireBytes}`; the job card shows `N requests · transport · batch size`.

Local interop evidence (2026-09-29, `backend/scripts/zoer-connect-batch-interop.ts` against the plugin's Docker fixture; 243 artifacts, 8,745,132 bytes; a `/chunks` push needs 243 uploads): baseline 4 octet-stream requests with deflate; after `post_max_size` was lowered to 1M mid-upload, four 413 responses, a learned ceiling of 927,314 bytes and 10 accepted requests; with octet-stream refused (415), 6 multipart requests; with octet-stream and multipart refused, 7 JSON requests. Each run completed review, approval, finish, data verification, rollback and cleanup. This is a local fixture, not a hosting result.

### Remote → remote Push

A Push source can be a completed, verified Pull of another connected site (`source: {kind: "pull", sourceSiteId, pullId}`), not only a local DDEV export. In the dialog, **Another connected site** lists only external Zoer Connect sites (added through **Add site**), and **Local DDEV site** lists running DDEV sites; a managed DDEV site cannot also be added as an external site, so the UI cannot use a DDEV site's Pull as a remote source (the API accepts it). The source must differ from the destination. `verifiedFiles` re-hashes every downloaded file and requires the source site's saved connection (key generation) to be unchanged. Pulls that include MU plugins or core cannot be pushed; start a new Pull without them. A table-subset Pull needs a destination that accepts partial databases. Path replacement uses the Pull's recorded `source.abspath` (0.4 sources); when it is missing, path replacement is skipped with a job warning. The original URLs sent for replacement are the ones the source export recorded.

### Replace-only jobs

`POST /connect/:siteId/replacements` with `{requestId?, confirmTarget, replacementAccepted | wordpressOnlyWriters, options: ImportOptions, tables?}` creates a Push-store job with `kind: "replace"` that uses the same `/pushes/:id/*` routes. It needs Push permission, an import-capable plugin and `siteReplace`; at least one custom row is required; `users` and `usermeta` are refused. The plugin receives only the custom rows, `tables`, `replaceGuids`, `review: true`, `fence: "activation"` and (with `cachePurge`) `purgeCaches`. History summarizes it as "Find & replace: N rules".

### Profiles, recent runs, history and audit

- `DATA_DIR/wordpress-transfer-profiles.json` (private, atomic): up to 100 profiles (`name` up to 80 characters, `action`, optional `siteId`/`sourceSiteId`, `exportOptions`, `importOptions`) and the last 10 runs' options, recorded automatically when a Pull, Backup, Export, Push or replace job starts. Local DDEV exports are not recorded; the Push that uses one is.
- Job records: `DATA_DIR/wordpress-pulls/`, `DATA_DIR/wordpress-local-exports/`, `DATA_DIR/wordpress-pushes/<sha256(siteId)>/<id>.json` (Push and replace), `DATA_DIR/wordpress-local-copies/<id>.json`; connections in `DATA_DIR/wordpress-connect/`.
- `GET /transfers?limit=100&siteId=` merges Pulls, local exports (reported as `kind: "pull"` with a "Local export:" summary), Pushes, replacements and local copies, newest first (limit 1–500); `siteId` also matches the source side.
- Audit action `wordpress.transfer` with `{kind, operation, jobId, sourceSiteId?}`: `start`, `finish`, `rollback` (including refused ones, with the error), `cleanup` (once the plugin reports it finished) and `delete`. Pull and local-export finishes are recorded when the download is verified. Keys and local paths are never included.

### Downloads and tickets

`GET /connect/:siteId/pulls/:id/download?part=database|archive` (and the same under `/local-exports/:siteId`) streams `database.sql` or a pax `.tar.gz` of every file, `database.sql` included. It needs a finished download but not the original connection, so saved backups stay downloadable after a key change. File sizes are checked up front and SHA-256 digests while streaming; a changed file aborts the response. Browsers use `POST …/download-ticket {part}` and receive a URL with a single-use ticket valid for 5 minutes, bound to that exact path (site, job and part) with scope `wordpress:download:read`. Tickets live in backend memory (a restart invalidates them) and are not bound to a user identity: anyone holding the URL can use it once within 5 minutes.

### Diagnostics and inventory

- `GET /connect/:siteId/diagnostics` proxies the plugin's read-only `/diagnostics` (30 s timeout), cached for 60 s per connection generation; `?fresh=1` bypasses the cache.
- `GET /local-exports/:siteId/inventory` asks the bridge (`GET /projects/:project/wordpress/connect-inventory`), which runs a read-only `wp --skip-plugins --skip-themes eval` and returns the diagnostics subset `{wordpress, database: {tables}, postTypes, themes, plugins}`, bounded and type-checked; 60 s cache, 90 s timeout.
- The dialog uses them for table, post type, theme and plugin pickers, warnings and the prefix check. Table names outside `[A-Za-z0-9_]` cannot be selected.

### Local DDEV exports and hidden files

The bridge worker applies the same database filters and resource modes as the plugin inside its consistent snapshot, resolves active plugins and theme from that snapshot, and records `abspath` and the exported tables. File planning always excludes `**/.git/`, `**/node_modules/`, `**/.env`, `**/.env.*`, `**/*.log` and the connector plugin, fails on symlinks and stops at 20,000 files. Hidden-file policy: Finder, Windows and VCS litter (`.DS_Store`, `._*`, `__MACOSX`, `.AppleDouble`, `.LSOverride`, `.Spotlight-V100`, `.Trashes`, `.fseventsd`, `.TemporaryItems`, `Thumbs.db`, `ehthumbs.db`, `desktop.ini`, `.git`, `.svn`, `.hg`) is skipped silently; any other name starting with `.` is skipped and reported as `hidden`, and names with backslashes or control characters as `unsafe-name` (the first 200 are listed with a total count), because Push refuses dot segments. This differs from WP Migrate, which transfers dotfiles unless excluded: a content `.htaccess` in uploads is not pushed from a local export.

### Local copy refresh

Local copies now run on the server (`POST /connect/:siteId/local-copies/:id/run`) with the same transient retries; **Run again** resumes the same destination. They still need a complete Pull (database with every table, themes, plugins and media; only Mac metadata exclusions; no core or MU plugins). `replaceSiteId` refreshes an existing local copy instead of creating a site, only when Zoer recorded it as a completed copy of the same source and the DDEV site is running. A DDEV portable backup is taken first (not retained in Files); if it fails, nothing is changed. Limitations: files removed from the source since the previous copy remain in the refreshed copy; there is no automatic rollback of a refresh (the portable backup is the recovery point); source plugins stay inactive and mail, outbound HTTP and cron stay disabled as for new copies.

### Routes

All under `/api/wordpress-manager`, behind the WordPress Manager authentication, with `Cache-Control: no-store`:

- Connection: `GET|POST|DELETE /connect/:siteId`, `POST /connect/:siteId/test`, `POST /external-sites`, `GET /connect/:siteId/diagnostics`, `GET /local-exports/:siteId/inventory`.
- Pulls (and the same under `/local-exports/:siteId`): `GET|POST /connect/:siteId/pulls`, `POST …/pulls/:id/run|step|pause|resume`, `DELETE …/pulls/:id`, `GET …/pulls/:id/download?part=`, `POST …/pulls/:id/download-ticket`, `GET …/pulls/:id/download/:part?ticket=`.
- Push and replace: `GET /connect/:siteId/pushes`, `POST /connect/:siteId/pushes/preview`, `POST /connect/:siteId/pushes`, `POST /connect/:siteId/replacements`, `POST /connect/:siteId/pushes/:id/run|resume|pause|approve|finish|rollback|cleanup|step`, `DELETE /connect/:siteId/pushes/:id`.
- Local copies: `GET|POST /connect/:siteId/local-copies`, `POST …/local-copies/:id/run|step`.
- Profiles and history: `GET|POST /transfer-profiles`, `GET /transfer-profiles/recent`, `PATCH|DELETE /transfer-profiles/:id`, `GET /transfers`.

### Tests

```sh
cd backend
bun test --isolate src/__tests__/wordpress-transfer-options.test.ts src/__tests__/wordpress-push.test.ts \
  src/__tests__/wordpress-push-runner.test.ts src/__tests__/wordpress-push-upload.test.ts \
  src/__tests__/wordpress-connect-batch.test.ts src/__tests__/wordpress-connect.test.ts \
  src/__tests__/wordpress-pull.test.ts src/__tests__/wordpress-pull-runner.test.ts \
  src/__tests__/wordpress-pull-download.test.ts src/__tests__/wordpress-transfer-history.test.ts \
  src/__tests__/wordpress-local-copy.test.ts src/__tests__/wordpress-manager.test.ts
bun x tsc --noEmit

cd ../frontend
bun test src/components/extensions/wordpressTransfer src/lib/wordpress-transfer src/lib/queries/wordpress-transfer.test.ts
bun x tsc --noEmit && bun run build

cd ../ddev-bridge
bun test            # connect-export.test.ts also runs the PHP filter fixtures; needs php on PATH
bun run typecheck
```

Interop with the real plugin (local only; needs Docker and the `zoer-connect` repository beside this one, or `ZC_E2E_DIR`):

```sh
cd ~/github/zoer-connect/tests/e2e-docker && KEEP=1 ./run.sh 1     # or ./setup.sh
cd ~/github/zoer/backend && bun scripts/zoer-connect-batch-interop.ts
cd ~/github/zoer-connect/tests/e2e-docker && ./teardown.sh
```

It runs four full pushes of one real paged Pull (baseline, 413 ceiling, multipart fallback, JSON fallback), each through review, finish, rollback and cleanup, with TLS verified against the fixture's own CA. Exit code 0 means every assertion held. The plugin's own `tests/e2e-docker/run.sh` covers the protocol without Zoer.

### Open decisions

- **Rollback after the first page view.** Block themes create a fallback `wp_navigation` post and a `custom_css_post_id` theme mod on the first front-end view after activation. When the source never rendered them, that first view counts as a later edit and rollback refuses. This is correct under the current fingerprint policy but surprising after a Push of a never-viewed local site; decide whether to treat these generated rows as ephemeral or to tell users to view the source first.
- **siteurl heuristic.** With 0.4 options, any original URL beneath the source home path maps to the destination siteurl rather than home. That is right for a WordPress-in-a-subdirectory siteurl but would also catch another alias recorded under the home path. Decide whether Zoer should send an explicit source-to-destination URL map instead.
- **Remote source picker.** Manager 0.5.4 lists connected DDEV, Hostinger and external sources with Pull permission, excluding the destination and unsupported Playground sites. A verified Pull can be used for remote-to-remote Push.
- **Download tickets are not user-bound.** A ticket URL works once, for 5 minutes, for whoever holds it. Decide whether tickets should also bind the issuing session or user.

### Qualification and remaining bounds

October 2–3 qualification supersedes the earlier September local-only status. The OTE backend/frontend were rolled out and verified in the browser. Pull, Backup, Export/downloads, local and remote-source Push, Find & Replace, saved profiles, local copy creation/refresh and desktop/mobile flows passed. Real host body limits, cache exclusions/authentication, case-folded MariaDB, worker deaths and large-transfer limits are recorded in [the audit](https://github.com/ahzs645/zoer/blob/main/docs/qualification/zoer-connect-040/README.md).

Local exports stop at 2 GiB; hosted database Pull stops at 256 MiB/40 seconds. Forced cache layers must exclude connector routes and purge existing entries. The qualification instance uses Open access, which bypasses download-ticket auth/expiry middleware; live enforcement was not claimed. Profile rename/deletion and every cache vendor combination were not separately qualified.

### Deployment and live qualification runbook

1. **Merge first.** Deploy only merged `main`, from `~/github/zoer`, never an unrelated feature branch. The helper syncs the working tree including uncommitted files, so start from a clean checkout of `main` that contains the matching plugin copy in `wordpress-plugins/zoer-connect/`.
2. **Check that nothing is running.**
   ```sh
   export KUBECONFIG=~/github/personalprox/kubeconfig.yml
   bun run server:dev:status
   kubectl -n zoer get pods -l zoer.plugin-runner=true
   ```
   The helper refuses to deploy while plugin worker pods or durable plugin runs are active; let them finish. It does not know about WordPress transfers: open WordPress → Transfer history (or `GET /api/wordpress-manager/transfers`) and let running Pulls, Pushes, replace jobs and local copies finish or pause them. A backend restart leaves them idle until Resume.
3. **Deploy the DDEV bridge first.** The 0.4 integration changes `ddev-bridge/src/index.ts`, `connect-export.ts`, `connect-inventory.ts` and `connect-export-worker.php`. Copy them to the bridge host's `/opt/zoer-ddev-bridge` with backups, verify the installed hashes, restart `zoer-ddev-bridge.service` and check its authenticated `/health`, before the backend rollout.
4. **Deploy the backend and frontend** to the `192.168.1.50` environment that serves `zoer.k8s.ahmad.sh`:
   ```sh
   cd ~/github/zoer
   KUBECONFIG=~/github/personalprox/kubeconfig.yml bun run server:dev
   ```
   Then verify tags, pods and `https://zoer.k8s.ahmad.sh/api/health` as in [agent-development.md](https://github.com/ahzs645/zoer/blob/main/docs/agent-development.md#verify-what-is-actually-live). The public `zoer.k8s.overtheedgepaper.ca` instance is a separate deployment path through `Proxmox-Playbook` (`scripts/zoer-deploy.sh`); do not use `server:dev` for it.
5. **Prepare disposable sites only.** In WordPress Manager create disposable DDEV sites: a local source A and a destination B, each reachable through its managed HTTPS URL. Remote → remote in the UI also needs a disposable connected source C with Pull permission (DDEV, Hostinger or external), for example the disposable transfer peer used for destructive tests, with its owner's authorization. Never use SparkLab, PGAIR, Aram or any production site.
6. **Install the qualified stable plugin on B and C** from its release ZIP or real WordPress update feed. For a new development candidate, in `wordpress-plugins/zoer-connect/` (or the plugin repository) run `make test` and `make build`, which writes `dist/zoer-connect-0.4.0.zip` without needing a receipt. Upload it through the disposable site's **Plugins → Add New → Upload Plugin**, or copy it into the DDEV project on the bridge host and run `ddev wp plugin install zoer-connect-0.4.0.zip --force --activate` there. In **Tools → Zoer Connect** generate a key (this enables Push and shared-hosting migration), enable Pull on C, and connect both in Zoer. For the mixed-version check, install 0.3.14 from its published release ZIP on one more disposable site. A future candidate must repeat qualification and seal a new receipt before stable publication; never overwrite a published package.
7. **Exercise every flow at desktop width and at 390 px:**
   - Connection card: version 0.4.0, API v2, capability chips, diagnostics details and warnings, Test, Replace key.
   - Pull from C (and from B) with table and post-type filters, revisions/spam exclusion, theme and plugin modes and a media date; pause and resume; delete a download.
   - Backup of C; Export of C with both downloads (`.sql`, `.tar.gz`), including a ticket URL opened after 5 minutes (must fail) and twice (second must fail).
   - Push A → B (local source) with the UI defaults, compare-and-select and all items, a custom literal and regex rule, review with counts and samples, apply, verification, finish, then front-end and admin checks on B.
   - Push C → B (remote → remote from a verified Pull), with review and **Cancel** at review (site unchanged), then a completed push and **Roll back…**, including a refused rollback after an edit on B.
   - Find & Replace on B with selected tables, review, apply, finish and rollback; **Clean up backups…** afterwards (rollback must then be refused).
   - The job card's request count, transport and batch size during upload; pause during upload and during import; close the dialog and reopen it while a job runs.
   - Profiles: save, load, overwrite, rename, delete; recent runs; Transfer history filters; Backups & import tab.
   - Make a local copy from a complete Pull of C, then refresh it with `replaceSiteId`.
   - The 0.3.14 destination: new options disabled with "Requires Zoer Connect 0.4.0", pushes still complete through `/chunks`.
8. **Record the evidence** (dated, with job IDs and plugin/backend versions, no secrets) under `output/ui-audit/`, then update the plugin's `releases/0.4.0.md` checklist. Only a completed plugin checklist allows a qualification receipt and a `v0.4.0` tag.


## Zoer Connect 0.5 large transfers (stable 2026-10-03)

This section supersedes older size-bound statements above for clients that negotiate `largeTransfer` with Zoer Connect 0.5.0. Legacy clients, selective comparison and the separate Updraft browser-upload workflow retain their documented limits. See [measured qualification](https://github.com/ahzs645/zoer/blob/main/docs/qualification/zoer-connect-050/README.md).

| Path | Current bound / behavior |
| --- | --- |
| Incoming local/Pull/import transfer | 16 GiB default per-transfer quota, configurable 1 MiB–64 GiB |
| Individual artifact | 4 GiB; bounded copy, block verification, publication, original backup and restoration |
| Free-space reserve | 64 MiB, checked repeatedly before allocations and recovery |
| Hosted read-only database snapshot | Existing consistent transaction, 256 MiB / up to 40 seconds |
| Optional hosted source-pause database export | Typed primary-key checkpoints; SQL parts target 4 MiB / about three seconds, 16 MiB single statement |
| Selective file comparison | Existing 32 MiB bound; use a full export for large files |
| Updraft browser upload | Existing 1 GiB component / 2 GiB set |

Set `ZOER_WORDPRESS_TRANSFER_QUOTA_BYTES` consistently on the Zoer backend and DDEV bridge. Hosted quota is in **Tools → Zoer Connect → Transfer storage quota**; a `ZOER_CONNECT_TRANSFER_QUOTA_BYTES` wp-config constant overrides it. Imports preserve destination quota settings. Quotas limit incoming bytes per transfer; they do not reserve shared account storage. Simultaneous transfers and retained original backups consume additional disk. Each manifest is bounded to 8 MiB, so many block hashes can reach that request bound before a configured quota.

For a large hosted database, use Connect Zoer → Pull, Backup or Export → **Pause source while exporting database**. Confirm **Background jobs and external database writers are stopped** only after stopping them and earlier requests. This requires native Push+Pull, current request protection, InnoDB primary keys and supported MySQL/MariaDB query execution budgets. The source pauses normal WordPress requests while SQL is prepared; caches may still serve pages. The UI shows table/row/part progress. Downloading files starts after the database seals and the source resumes. Cancel releases the pause. An idle source pause expires after one hour, with a 24-hour maximum lifetime; start a fresh export after expiry. Multi-request SQL export cannot preserve a single transaction and cannot protect against writers that bypass WordPress. SQL execution interruption is cooperative rather than a hard wall-clock HTTP deadline.

0.5.0 changes sealed fence code. Repeat native request-protection setup before new imports or source-pause exports. Existing authenticated recovery remains available. Never update during an active transfer, remove private journals or stop a runtime with unrecovered imports. Persist connector storage outside the document root on a mounted directory; DDEV's ephemeral web container can be removed by Stop.

The default consistent-snapshot local database worker remains a background process with its existing 30-minute deadline; ongoing disk checks and quota validation now protect its output and subsequent download. New block-root source manifests are verified by Zoer and converted to normal whole-file SHA-256 before Push, local-copy restoration or download. Legacy export request hashes and recovery journals retain their prior interpretation.
