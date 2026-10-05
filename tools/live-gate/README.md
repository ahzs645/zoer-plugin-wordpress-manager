# Live-gate helpers

Small Bun scripts for testing WordPress Manager against a live Zoer. The rules and the full procedure are in [`docs/live-testing.md`](../../docs/live-testing.md); read that first.

## Environment

| Variable | Meaning |
|---|---|
| `ZOER_URL` | Zoer origin, e.g. `https://zoer.example` (required; no default). |
| `ZOER_TOKEN` | Optional bearer session token (only for a Zoer in password mode). |
| `LIVE_GATE_ALLOW_SITE` | Comma-separated exact site IDs the **user** allowed for writes, besides the test sites. |
| `LIVE_GATE_SHOTS` | Screenshot folder (default `tools/live-gate/.shots/`, gitignored). |
| `LIVE_GATE_BROWSER_CHANNEL` / `LIVE_GATE_CHROMIUM_PATH` | Use an installed Chrome/Chromium instead of Playwright's. |

## Guard

`guard.ts` refuses every write (an action whose manifest effect is not `read`, and every approval this tool resolves) unless each site the input names (`siteId`, `sourceSiteId`, `replaceSiteId`, `endpointId`) is one of:

- `ddev-zoer-connect-040-source`
- `ddev-zoer-connect-040-destination`
- `ddev-zoer-connect-0314-compatibility`

or is named exactly in `LIVE_GATE_ALLOW_SITE`. Hilltop Childcare (`lightpink-vulture-195751`, `ddev-hilltop-childcare-*`, anything containing "hilltop") is refused always, reads included, override or not. Writes that name no site (`site.create`, `backup.restore-local` into a new site) pass. The guard runs in this tool only. Actions taken in the Zoer UI are not checked by it.

## Scripts

| Script | What it does |
|---|---|
| `zoer.ts` | API helper and CLI: `check`, `get`, `plan`, `start`, `run`, `wf`, `wait`, `pause`, `resume`, `cancel`, `approvals`, `approve`, `decline`, `catalog`, `filesets`, `wp` (read-only WP-CLI). `bun tools/live-gate/zoer.ts help`. |
| `snap.ts` | Site snapshot through `site.test { diagnostics: true }`: address, prefix, table row counts, plugins, themes, post types. `save <siteId> <label>`, `compare <siteId> <baseline> [<label>] [--ignore options,usermeta]`, `list <siteId>`. Stored in `.baseline/` (gitignored). |
| `status.ts` | One line per run with checkpoint fields, `--watch [s]` until stopped. |
| `push.ts` | Gated `transfer.push` of a file set into a test site, approving only its own matching approval, optional `--pause-on-upload`. Prints the import ID. |
| `control.ts` | Gated `transfer.push.control` (`approve`, `finish`, `rollback`, `cleanup`) on one import. |
| `ui-smoke.ts` | Read-only Playwright pass at 1440×900 and 390×844: site list, overview, transfer area and Transfers dialog, history, backups, Trash. Records page/console errors, `/api` answers ≥ 400, legacy-route calls and non-read requests. Exits 1 if anything was recorded. |

Plain `bun run test` covers the guard and the snapshot compare (`tests/live-gate.test.ts`) without network. `bun run typecheck` includes this folder.

## Typical round on 040-destination

```sh
export ZOER_URL=https://<zoer origin>
bun tools/live-gate/zoer.ts check
bun tools/live-gate/zoer.ts start site.start '{"siteId":"ddev-zoer-connect-040-destination"}'
bun tools/live-gate/snap.ts save ddev-zoer-connect-040-destination baseline
bun tools/live-gate/push.ts --set fs_<id> --confirm-target https://<040-destination address>
bun tools/live-gate/control.ts <importId> rollback
bun tools/live-gate/control.ts <importId> cleanup
bun tools/live-gate/snap.ts compare ddev-zoer-connect-040-destination baseline --ignore options
bun tools/live-gate/zoer.ts approvals          # must be []
bun tools/live-gate/zoer.ts start site.stop '{"siteId":"ddev-zoer-connect-040-destination"}'
```

Playwright's browser is not part of `bun install`: run `bunx playwright install chromium` once, or point `LIVE_GATE_CHROMIUM_PATH` at an installed Chromium.
