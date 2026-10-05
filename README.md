# WordPress Manager for Zoer

Independent source and releases for the `wordpress-manager` native plugin. This repository owns its interface and isolated workers. Zoer provides reviewed host services, shared controls and provider credential storage. The first extracted release is **0.5.0**; **0.5.1** adds the shared public type snapshot and reliable source resolution, preserving the existing plugin ID and site/account/backup/transfer state.

## Features

- Hostinger overview offers **Make a local copy**, including connector/Pull setup and the existing verified-download-to-DDEV workflow.
- DDEV, Playground, Hostinger and Zoer Connect site inventory, previews and administrator handoffs.
- Local WordPress creation, start/stop, rename and recoverable removal.
- Hostinger account API/browser login, plan inventory, free temporary domain generation, reviewed website creation, cache purge/bypass and installation detection.
- Five-component Updraft import, validation and DDEV or Playground restoration; portable backups with optional Files retention.
- Core version checks, backup-before-update review and publishing preflight; plugin/theme search, install, activation, updates, removal and rollback safeguards.
- Opt-in resumable large-database exports with source-pause acknowledgement and table/row/part progress (Zoer Connect 0.5.0 and the matching Zoer host required).
- Pull, push, database filters, media/theme/plugin selection, serialized replacements, staged review, recovery, resumable progress, local copies, profiles and transfer history.
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

`dist/package` contains only the manifest, workers and bundled `native/index.js` / `native/style.css`. `dist/release` contains a deterministic ZIP and digest descriptor. Push `v<manifest version>` to publish those assets through GitHub Actions. Optional signing uses the host's documented `ZOER_PLUGIN_SIGNING_KEY` and `ZOER_PLUGIN_KEY_ID`; private keys never belong in this repository. Run the exported CLI under **Bun**.

Zoer can build a committed source through Repos → Plugin using `zoer-plugin.json`, or install the ZIP/GitHub release through Plugins. This repository is private like Zoer; configure GitHub access for release discovery or upload the downloaded ZIP. Review the added `workspace:native` and `workspace:wordpress` permissions. Use normal versioned upgrades/rollback, keeping `wordpress-manager` as the ID. The plugin negotiates WordPress host contract version 1; install the accompanying Zoer host changes first.

## WordPress-side plugins (`wordpress-plugins/`)

The PHP plugins installed *into* WordPress sites moved here from the Zoer repository (Zoer `docs/plugin-shared-services.md`, section 16.3, phase P1). Neither is part of the Zoer package built above: `scripts/build.ts` copies only `plugin/` and the native module, and `typecheck`/`test` cover only `src`, `tests` and `scripts`.

- `wordpress-plugins/zoer-connect` is a Git submodule pinned to the public [Zoer Connect repository](https://github.com/ahzs645/zoer-connect) (same remote and commit Zoer pinned). Run `git submodule update --init wordpress-plugins/zoer-connect` after cloning. Connector changes, tests (`make test`), builds (`make build`), release tags and the update feed belong in that repository; commit here only to move the pin. `branch = main` allows an explicit `git submodule update --remote`.
- `wordpress-plugins/zoer-content-modules` is the standalone Content Modules plugin. Build and test it from its folder as its README describes (`php tests/package.php`, `node tests/upload.cjs`, `python3 build.py`, which writes `dist/zoer-content-modules-<version>.zip` plus a SHA-256 sidecar).

The Zoer Connect operating guide and the historical handoff are in [`docs/zoer-connect-operations.md`](docs/zoer-connect-operations.md) and [`docs/zoer-connect-handoff.md`](docs/zoer-connect-handoff.md). Agents editing an existing Zoer-managed DDEV site from outside Zoer use the [site-edit skill](.agents/skills/zoer-wordpress-site-edit/SKILL.md).

## Host API and reuse

Domain code is in `src/components/extensions`, `src/lib/queries`, `src/lib/wordpress-transfer` and the typed API client. All supported HTTP calls pass through `host.request("api.request", ...)` with the reviewed `/wordpress-manager` scope. WordPress-specific runtime calls use `/wordpress-manager/workspace`; no broad `/computers` or secrets endpoint is exposed. Downloads use existing exact-resource host links. Shared `@zoer/plugin-ui/controls` and `@zoer/plugin-ui/workspace` are supplied by Zoer at runtime; React and React Query share the host instances. Native UI is trusted code in the viewer's page, not an isolation boundary. Workers are separately isolated.

Other plugins can consume the host-owned `wordpress-site` adapter through an explicitly selected existing site, operation grants and `requiredAdapters`. Versioned operations cover public inspection, core status/check, extensions, health, backup metadata and sanitized deployment history. They do not grant production mutations or archive content. `wordpressSite(context, alias)` is available in the Zoer SDK for isolated workers. Trusted native plugins can use `createWordPressWorkspaceClient(host)` for the full typed WordPress API after reviewing `workspace:wordpress`; host confirmations and recovery checks still apply. the host's `examples/plugins/wordpress-maintenance` demonstrates a second consumer. Publishing/restores/core installation keep their reviewed workspace workflows.

See [Zoer's architecture guide](https://github.com/ahzs645/zoer/blob/main/docs/wordpress-plugin.md) for the exact contract and boundaries. `packages/api-types` is a committed public contract snapshot from Zoer, so builds need no sibling checkout; refresh it deliberately when changing the contract. Shared UI declarations contain types only, not host control implementations.

## Verification

Unit tests cover transfer/replacement options, capability availability, grouping, lifecycle restrictions, clipboard parsing, progress/history labels and bridge cancellation/session fencing. The build rejects unexpected or dynamic native imports and local filesystem paths, and scopes plugin CSS including portaled dialog content. CI typechecks, tests, builds, validates and archives every push. Host tests cover runtime/upload restrictions, per-site operation grants/revocation, sanitized outputs and installed-worker file permissions. Browser integration is checked against Zoer's real cluster; UI unit stubs supply shared-module imports only.

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
route to the existing supported UpdraftPlus import. Hostinger sites can open
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

Transfers still run on the Zoer host (`/wordpress-manager/*`); moving them into this plugin is phase P3.

## Plugin transfer engine (0.7.0)

0.7.0 adds a second implementation of transfers that runs inside this plugin on Zoer's shared services (Zoer `docs/plugin-shared-services.md`, phase P3). It needs the Zoer release with the P3 host changes (runtime transfer peers, `fileset.describe` block digests, runtime-only command bundles, removal-plan approval highlights, the `wordpress-manager.transfers-to-plugin` migration).

- **Engine switch, per site.** Every site stays on the **legacy** engine (Zoer host routes, unchanged) until the user switches that one site to the **plugin** engine in its transfer area and confirms it is a non-production test target. The choice is a catalog record `site-engine:<siteId>`; every plugin-engine action refuses a site without it, before any network call. Production sites are never switched implicitly.
- **Actions** (`worker/transfers.js`, resumable S1 slices; one transfer per site at a time through the lock `site-transfer:<siteId>`):
  - `transfer.pull` / `transfer.local-export` — Zoer Connect site or local DDEV site → verified, sealed file set (`site-export` file rules, S3 downloads, block digests converted to SHA-256) plus a `pull` catalog record.
  - `transfer.preview` — compares a pull with a destination (20 paths per request) and stores the classification for a selective push.
  - `transfer.push` / `transfer.replace` — external writes, approval always, resume manual after a restart: import manifest with 256 KiB block digests, `zbt1-v1` batch upload with the destination's cursor as authority, then the import steps; review and verification park the run (`needs-user`) until `transfer.push.control` approves, finishes or rolls back.
  - `copy.local` — pull (or a given pull), new or refreshed DDEV site (S9), staging through the DDEV bridge (S3 runtime peer), the reviewed import scripts in `computer/wordpress/` (S8 `runtime.exec.v1`), its own address (S5), plugins inactive, HTTP check.
  - `backup.restore-local` — five-part UpdraftPlus set uploaded into a file set (`updraft-set` rules) restored into a new DDEV site; the database is converted to data-only SQL by `prepare-updraft.php` (a port of the host's Python preparation, checked against it by the parity harness).
- **Dry runs.** `dryRun: true` on every action: pull downloads into a scratch set and keeps nothing; push and replace build and check the plan and send nothing that writes; local copy restores into a scratch site `zoer-dryrun-<id>` that goes to the trash; restore inspects the archives and plans without creating a site.
- **Parity harness.** `bun tools/parity/transfers.ts --zoer <Zoer checkout>` runs both engines in one process against fake Zoer Connect sites (no servers, no network) and compares file sets byte for byte, import manifests, remote calls in order, destination results, the Updraft preparation and the import scripts. Unit tests (`tests/transfers.test.ts`) use the same fakes.
- **Migration.** `ZOER_URL=… ZOER_TOKEN=… bun tools/migrate-host-transfers.ts [--apply]` runs the operator migration (dry run by default): legacy pulls become retained file sets and `pull` records, profiles become presets, history, local-copy links, deployments and recovery points become catalog records. Engines are not switched by it.
- **New reviewed permissions:** `workspace:filesets`, `workspace:catalog`, `runtime:files`, `runtime:commands:write`, `routes:hosted` (+ `hostedRoutes` family `wp`), the two file rule sets and five runtime command bundles.

Known differences from the legacy engine: push batches are capped by the endpoint body limit (8 MiB − 128 KiB instead of up to 64 MiB); a retried upload slice re-reads the destination cursor first; pulls refuse executable files under `wp-content/uploads` that are not "silence" placeholders already at the pull (the legacy engine refused them only at local copy); artifact reuse between pushes and the remote pause during an import are not used; a remote DDEV site whose Zoer Connect reports its DDEV canonical home instead of the endpoint address is refused as "does not match this connection"; a database import must finish within one 14-minute command.
