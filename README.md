# WordPress Manager for Zoer

Independent source and releases for the `wordpress-manager` native plugin. This repository owns its interface and isolated workers. Zoer provides reviewed host services, shared controls and provider credential storage. The first extracted release is **0.5.0**; **0.5.1** adds the shared public type snapshot and reliable source resolution, preserving the existing plugin ID and site/account/backup/transfer state.

## Features

- DDEV, Playground, Hostinger and Zoer Connect site inventory, previews and administrator handoffs.
- Local WordPress creation, start/stop, rename and recoverable removal.
- Hostinger account API/browser login, plan inventory, free temporary domain generation, reviewed website creation, cache purge/bypass and installation detection.
- Five-component Updraft import, validation and DDEV or Playground restoration; portable backups with optional Files retention.
- Core version checks, backup-before-update review and publishing preflight; plugin/theme search, install, activation, updates, removal and rollback safeguards.
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

## Host API and reuse

Domain code is in `src/components/extensions`, `src/lib/queries`, `src/lib/wordpress-transfer` and the typed API client. All supported HTTP calls pass through `host.request("api.request", ...)` with the reviewed `/wordpress-manager` scope. WordPress-specific runtime calls use `/wordpress-manager/workspace`; no broad `/computers` or secrets endpoint is exposed. Downloads use existing exact-resource host links. Shared `@zoer/plugin-ui/controls` and `@zoer/plugin-ui/workspace` are supplied by Zoer at runtime; React and React Query share the host instances. Native UI is trusted code in the viewer's page, not an isolation boundary. Workers are separately isolated.

Other plugins can consume the host-owned `wordpress-site` adapter through an explicitly selected existing site, operation grants and `requiredAdapters`. Versioned operations cover public inspection, core status/check, extensions, health, backup metadata and sanitized deployment history. They do not grant production mutations or archive content. `wordpressSite(context, alias)` is available in the Zoer SDK for isolated workers. Trusted native plugins can use `createWordPressWorkspaceClient(host)` for the full typed WordPress API after reviewing `workspace:wordpress`; host confirmations and recovery checks still apply. the host's `examples/plugins/wordpress-maintenance` demonstrates a second consumer. Publishing/restores/core installation keep their reviewed workspace workflows.

See [Zoer's architecture guide](https://github.com/ahzs645/zoer/blob/main/docs/wordpress-plugin.md) for the exact contract and boundaries. `packages/api-types` is a committed public contract snapshot from Zoer, so builds need no sibling checkout; refresh it deliberately when changing the contract. Shared UI declarations contain types only, not host control implementations.

## Verification

Unit tests cover transfer/replacement options, capability availability, grouping, lifecycle restrictions, clipboard parsing, progress/history labels and bridge cancellation/session fencing. The build rejects unexpected or dynamic native imports and local filesystem paths, and scopes plugin CSS including portaled dialog content. CI typechecks, tests, builds, validates and archives every push. Host tests cover runtime/upload restrictions, per-site operation grants/revocation, sanitized outputs, discovery precedence and installed-worker file permissions. Browser integration is checked against Zoer's real cluster; UI unit stubs supply shared-module imports only.
