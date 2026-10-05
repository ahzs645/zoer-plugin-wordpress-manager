# Live testing from inside a Zoer computer

This guide is for an AI coding agent (Claude Code, Codex) running in the terminal of a Zoer computer. The agent continues to test and develop WordPress Manager against the live Zoer. Nobody on the operator's machine is involved, so everything here has to work from the computer. When something can't be done from there, stop and ask the user.

**Your lane.** Plugin changes are yours: this repository, test builds pushed with the dev CLI, and live tests on the DDEV test sites. Zoer changes (host routes, limits, migrations, deployment) are the user's. Zoer is **not** deployed from inside Zoer. It is deployed with Proxmox-Playbook (`scripts/zoer-deploy.sh`) from the operator's machine, which needs operator credentials and access that a computer doesn't have. If a fix needs Zoer, write down what has to change and why (file, route, observed answer) and hand it to the user. Don't work around a missing host capability with shell HTTP or borrowed credentials.

## 1. Setup

### Tools in the computer

The default computer image (`kasmweb/chrome` based, `full` variant) has Node 22, Google Chrome, and a global Playwright with Chromium. It does **not** have Bun. Install it once:

```sh
npm install -g bun        # or: curl -fsSL https://bun.sh/install | bash
bun --version
```

### Clone

The repository is private. Use the access the user gives you, and keep the secret out of the repository and out of `.git/config`:

- **GitHub token** (fine-grained, read access to this repository; add write access only if the user wants you to push):
  ```sh
  git clone https://github.com/ahzs645/zoer-plugin-wordpress-manager.git
  # when asked: user name = x-access-token, password = the token
  # or for one command: git -c http.extraHeader="Authorization: Bearer $GITHUB_TOKEN" clone …
  ```
  Never write the token into the remote URL, a file in the checkout, or a commit.
- **Deploy key**: put the private key in `~/.ssh/` (mode 0600) and clone `git@github.com:ahzs645/zoer-plugin-wordpress-manager.git`.

Then:

```sh
cd zoer-plugin-wordpress-manager
bun install --frozen-lockfile
git submodule update --init wordpress-plugins/zoer-connect     # public repository, no token needed
bun run typecheck
bun run test
bun run build
bun tools/zoer-plugin.mjs validate dist/package
```

All five must pass before you push a build to Zoer. `bun run release` (deterministic ZIP + digest) is only needed for a tagged release, and tagging and pushing releases is the user's call.

### Reach Zoer

Zoer doesn't inject its own address into computers (there is no `ZOER_URL` in a computer's environment). Use the Zoer origin the user gives you, or the one in your conversation context, and don't guess a hostname. Then check it:

```sh
export ZOER_URL=https://<zoer origin>
curl -fsS "$ZOER_URL/api/auth/status"        # "mode": "open" → no token needed
bun tools/live-gate/zoer.ts check             # installed WordPress Manager version and state
```

If Zoer is in password mode (`"openAccess": false`), ask the user for a **pairing link**, then run `bun tools/zoer-plugin.mjs pair "<link>"`. It prints `export ZOER_URL=…` and `export ZOER_TOKEN=…`. Keep `ZOER_TOKEN` in the shell environment only. Never copy the user's browser session.

If the computer can't reach the address at all, stop and tell the user. Network reachability from a computer to the live Zoer is not something this repository can fix.

### Install a test build (dev push)

`tools/zoer-plugin.mjs` is Zoer's plugin CLI exported as one file, so you don't need a Zoer checkout:

```sh
bun run build
ZOER_URL=$ZOER_URL bun tools/zoer-plugin.mjs dev dist/package --enable
```

From a Zoer checkout the equivalent is `bun packages/plugin-cli/src/cli.ts dev dist/package --enable`. That needs `bun install` in Zoer's `backend/`, `packages/plugin-sdk` and `packages/plugin-cli`, because the CLI validates with the backend's manifest validator. The exported file avoids all that. Re-export it (`bun run plugin export-cli <path>` in Zoer) only when Zoer's CLI changes.

What `dev` does:

1. Reads `dist/package` (skips `.git`, `node_modules`, `.DS_Store`, refuses symlinks) and validates the manifest.
2. Rewrites the manifest version to a development version: **patch + 1, `-dev.<unix seconds>`**. For example, 0.8.0 becomes `0.8.1-dev.1791212759`. Several pushes of the same source get increasing versions. The committed `plugin/manifest.json` is not changed.
3. `GET /api/extensions/wordpress-manager` (404 means not installed), then `POST /api/plugin-packages/stage-zip` `{ archiveBase64, development: { label } }`. The label defaults to `<hostname>:<path>`; `--label` sets it.
4. If the plugin is not installed: `POST /api/plugin-packages/<recordId>/install`. If it is installed: `GET /api/plugin-packages/<recordId>/upgrade-plan`. Blockers make it fail. If **`requiresReview`** is set (added permissions, network hosts, capabilities or any action change), it **stops** and prints the review link (`<zoer>/#/extensions?import=1`), leaving the package staged. Otherwise it sends `POST …/<recordId>/upgrade { fingerprintSha256 }`.
5. Every upgrade lands disabled. With `--enable`, or when the plugin was enabled before, it calls `POST /api/plugins/wordpress-manager/enable` and waits until Zoer keeps the new version enabled (up to 10 s). If Zoer doesn't, it exits non-zero.

Other flags: `--build "<cmd>"` runs a build before each push, and `--watch <dir>` pushes again on changes. Zoer must allow development sources: `PLUGIN_ALLOW_DEV_SOURCES=0` on the server makes `stage-zip` answer 403 `dev_sources_disabled`, and only the user can change that. Package limits are 25 MiB archive, 1,000 files, 10 MiB per file and 50 MiB expanded.

### Upgrade review by hand

If the dev push stopped for review, or you staged a package some other way:

```sh
bun tools/live-gate/zoer.ts get /plugin-packages/<recordId>/upgrade-plan     # recordId = the staged package record, not "wordpress-manager"
```

Read `plan.blockers`, `plan.requiresReview` and what the plan **adds** (permissions, capabilities, network hosts, actions, output limits above 4 MiB). Approve only when you understand every added item and it is what your change intended. If anything is unexpected, or a permission widens what the plugin can reach, stop and ask the user. To approve:

```sh
curl -fsS -X POST "$ZOER_URL/api/plugin-packages/<recordId>/upgrade" -H 'content-type: application/json' -d '{"fingerprintSha256":"<plan.fingerprintSha256>"}'
curl -fsS -X POST "$ZOER_URL/api/extensions/wordpress-manager/enable"
```

A stale fingerprint answers 409 `stale_upgrade_plan`: fetch the plan again. (Add `-H "authorization: Bearer $ZOER_TOKEN"` in password mode.)

### Alternatives to the dev push

- **Git staging from GitHub** (`POST /api/plugin-packages/stage-git { url, commit }`, packaging guide in Zoer `docs/src/content/docs/plugins/packaging.md`). It needs an HTTPS URL without credentials or port, on a host in `PLUGIN_GIT_ALLOWED_HOSTS` (default `github.com,gitlab.com`), and an exact full 40- or 64-hex commit. Zoer fetches that commit shallowly and stages **the repository tree as the package**: no build step, no submodules, no symlinks, at most 1,000 files. It also has no private-repository credentials yet. This repository is private, has a submodule, and keeps its source in `plugin/` with a build step, so it can't be staged this way as it is. It would work only for a public repository or branch that contains a built `dist/package` at its root, and that is a user decision.
- **GitHub release**: pushing `v<manifest version>` lets CI publish the release ZIP, which Zoer can stage with `POST /api/plugin-packages/stage-github-release { repository, tag }` when the server has `PLUGIN_GITHUB_TOKEN`. Release tags are the user's.
- **Repos → Plugin** in Zoer builds a committed source with `zoer-plugin.json` on Zoer's build runner (Zoer `docs/repository-plugin-updates.md`). It needs the repository attached in Zoer, and a first install or added permissions still need the user in the Zoer interface.

## 2. Site rules

- **Transfers write only to the DDEV test sites** `ddev-zoer-connect-040-source`, `ddev-zoer-connect-040-destination` and `ddev-zoer-connect-0314-compatibility`. They are usually stopped. Start one with `site.start` before you test, and stop it with `site.stop` when you're done:
  ```sh
  bun tools/live-gate/zoer.ts start site.start '{"siteId":"ddev-zoer-connect-040-destination"}'
  bun tools/live-gate/zoer.ts start site.stop  '{"siteId":"ddev-zoer-connect-040-destination"}'
  ```
- **Hilltop Childcare is never touched**: `lightpink-vulture-195751` (Hostinger) and every `ddev-hilltop-childcare-*` site. Don't read, pull, copy, open or screenshot them.
- **All other sites are the user's development sites.** Treat them as read-only unless the user asks for something specific. Reads are fine: listing, diagnostics, opening their pages read-only.
- **Restore 040-destination to its baseline after every real push**: snapshot first, push, roll back, clean up, then compare with the snapshot. Leave **no open approvals**. `bun tools/live-gate/zoer.ts approvals` must print `[]` when you finish, so decline anything you started but won't finish.
- The helpers in `tools/live-gate/` enforce the test-site list for writes. A write to any other site needs the user's go-ahead, after which you set `LIVE_GATE_ALLOW_SITE=<exact site ID>` for that command only. Hilltop is refused even then. The Zoer UI is not guarded by these helpers, so apply the same rules when you click.

## 3. Helpers and a standard round

`tools/live-gate/` ([README](../tools/live-gate/README.md)) holds the API helper (`zoer.ts`), the snapshot and baseline compare (`snap.ts`), run status (`status.ts`), the push and control helpers (`push.ts`, `control.ts`) and the UI smoke test (`ui-smoke.ts`). They read `ZOER_URL` and refuse to run without it.

A push round on 040-destination:

```sh
bun tools/live-gate/zoer.ts start site.start '{"siteId":"ddev-zoer-connect-040-source"}'
bun tools/live-gate/zoer.ts start site.start '{"siteId":"ddev-zoer-connect-040-destination"}'
bun tools/live-gate/snap.ts save ddev-zoer-connect-040-destination before-<topic>
bun tools/live-gate/zoer.ts start transfer.pull '{"siteId":"ddev-zoer-connect-040-source"}'   # → run ID
bun tools/live-gate/zoer.ts wait <runId>                                                       # output has the set ID (fs_…)
bun tools/live-gate/push.ts --set fs_<id> --confirm-target https://<040-destination address> --dry
bun tools/live-gate/push.ts --set fs_<id> --confirm-target https://<040-destination address>   # stops at review (needs-user)
bun tools/live-gate/control.ts <importId> rollback
bun tools/live-gate/control.ts <importId> cleanup
bun tools/live-gate/snap.ts compare ddev-zoer-connect-040-destination before-<topic> --ignore options
bun tools/live-gate/zoer.ts approvals                                                          # []
bun tools/live-gate/zoer.ts start site.stop '{"siteId":"ddev-zoer-connect-040-destination"}'
bun tools/live-gate/zoer.ts start site.stop '{"siteId":"ddev-zoer-connect-040-source"}'
```

`--confirm-target` is the destination's Zoer Connect address exactly as the push dialog shows it. For 040-destination that was `https://zoer-connect-040-destination.wp.k8s.overtheedgepaper.ca`; check it in the dialog if a plan says "Confirm the exact destination address". Use `zoer.ts filesets` or `zoer.ts catalog pull` to find an existing ready set instead of pulling again. Some actions (`site.start`, pulls) may wait for approval when Zoer is configured that way. `zoer.ts approvals` lists them, and `zoer.ts approve <id>` approves only test-site approvals.

UI check after a UI change (read-only, 1440 and 390 wide):

```sh
bunx playwright install chromium       # once; or LIVE_GATE_BROWSER_CHANNEL=chrome to use the image's Chrome
bun tools/live-gate/ui-smoke.ts --site ddev-zoer-connect-040-destination --tag <topic>
```

It exits 1 when it recorded console or page errors, `/api` answers ≥ 400, calls to Zoer's removed legacy transfer routes, or requests that write. Look at the screenshots, not only at the exit code.

## 4. Tests still open

These come from Zoer `docs/plugin-shared-services.md` §17, Wave 4 status. 0.7.1 passed the live gate on the DDEV test sites (pull, preview, local export, delete, gated push with review/approve/finish, one-approval rollback to baseline, clean refusal, pause/resume, cancel). The tests below were deferred when the legacy engine was removed.

1. **Restore with UpdraftPlus (`backup.restore-local`)** on a DDEV test site.
   - Start 040-source and open its WordPress admin in the Zoer browser (site page → WordPress admin).
   - Install and activate UpdraftPlus, then make one backup with database, plugins, themes, uploads and others.
   - Take a snapshot: `snap.ts save ddev-zoer-connect-040-source before-updraft`.
   - Download the five backup parts and restore them through the plugin: Overview → Restore from backup. This is DDEV only, and it creates a **new** DDEV site.
   - Compare the new site with the snapshot. Use `snap.ts save <newSiteId> restored`, then compare the two JSON files in `tools/live-gate/.baseline/`, which are kept per site. Also check the front page and admin login.
   - Afterwards, move the restored site to the trash (`site.archive`) and deactivate or remove UpdraftPlus on 040-source if the user wants the site back as it was.
2. **`copy.local` from a hosted site that is safe to read.** No such site exists yet: the only hosted test site is Hilltop, which is never touched. **Ask the user** for a hosted site that may be read. Then run it with `LIVE_GATE_ALLOW_SITE=<that site ID>` and compare the copy with a snapshot of the source.
3. **Pause mid-upload on a larger push.** The 16 MB test push finished uploading before the pause landed. Make 040-source larger (add media through WP admin, for example a few hundred MB), pull it, then run `push.ts … --pause-on-upload --pause-seconds 20`. The log shows how long the run took to park (the target is within about 30 s) and the uploaded bytes at the pause. Then roll back and clean up as usual.

## 5. Known minor issues to pick up

- **The same pull appears twice in Transfer history**, once as "Ready" and once as "Pull finished". The history tab merges `history:` records with recent runs. A finished pull probably shows up both as its run and as its record or history entry. Look at the merge in the Transfer history view and the history record written by the pull.
- **The rollback progress card can't be viewed while a site is fenced mid-rollback**, because the site's Transfers dialog won't open. This was fixed in 0.7.1 (`7233aae`: `PluginSiteRuns` renders with only the site ID and shows `TRANSFER_FENCE_NOTICE`). Check whether 0.8.0 regressed it. 0.8.0 removed the per-site engine records, and the fallback in `WordPressConnect.tsx` (`!connection && loadError && <PluginSiteRuns …/>`) and the site view in `WordPressManager.tsx` should still apply. Reproduce with `control.ts <importId> rollback` and open the dialog during the rollback.
- **A rolled-back push card still also says "Import complete on …".** Finished push cards follow a later rollback or cleanup of their import (0.7.1). The completion line should give way to the rollback state. See `pluginEngine/runState.ts` and the run card.

Fix these in this repository, add unit tests, push a dev build and verify on the test sites.

## 6. Zoer facts

- **One transfer engine.** Since 0.8.0 every managed site uses the plugin's own transfer actions (`transfer.pull`, `transfer.local-export`, `transfer.preview`, `transfer.push`, `transfer.replace`, `transfer.push.control`, `copy.local`, `backup.restore-local`). There is no per-site engine switch any more. Zoer's legacy transfer engine and its routes are deleted (P4), and `tests/host-routes.test.ts` fails if shipped source calls them.
- **Limits:**
  - **Runtime calls:** Zoer refuses the 251st `runtime.invoke` or runtime-peer request in one execution, and every resumable slice is a fresh execution. The workers stop at 200 per slice.
  - **Output:** Zoer's default output limit for an action that declares none is 1 MiB. This manifest declares its own: 128 KiB for the lifecycle and snapshot actions, 512 KiB for refreshes, 2 MiB for `site.test`, 4 MiB for the transfers and **12 MiB for `transfer.push`** (one upload batch per slice). Limits above 4 MiB are part of the upgrade fingerprint.
  - **Resumable slices:** checkpoints are at most 64 KiB, and a run is a chain of slices bounded by `stepTimeoutMs` and `maxSteps` (see the manifest). `transfer.push` and `transfer.replace` resume manually after a restart.
  - **Retention:** workflow runs are pruned after 30 days (`ZOER_WORKFLOW_RUN_RETENTION_DAYS`).
  - **Push batch:** capped by the endpoint body limit (8 MiB − 128 KiB).
- **Remaining host routes** (Zoer `/api/wordpress-manager`, kept until P3.6):
  - `/sites*`
  - `/connections*` (with `/oauth`)
  - `/connect/:siteId` (+ `/test`)
  - `/hostinger/websites`
  - `/deployments*`
  - `/recovery-points`
  - `/extension-search`
  - `/extension-actions/*`
  - `/admin-link`
  - `/workspace/*`

  **P3.6 and the mount removal are still to do in Zoer.** That work moves these routes into the plugin, then drops the `/api/wordpress-manager` mount, `workspace:wordpress`, the deprecated SDK modules and `packages/api-types/src/wordpress.ts`. It is a Zoer change, so it's the user's lane. Don't start it from here without the user.
- **Approvals.** `transfer.push`, `transfer.replace` and `transfer.push.control` always need an approval. Open approvals are listed at `GET /api/runtime/approvals?status=open` and resolved with `POST /api/runtime/approvals/:id/resolve { status, reason }`. Push and control in the helpers approve only their own run's approval, after checking its reviewed input.
- **Screenshots.** `ui-smoke.ts` writes to `tools/live-gate/.shots/` (gitignored; `LIVE_GATE_SHOTS` changes it). Screenshots stay in the computer and are never committed. Tell the user the folder and file names, and they can open them through the computer's Files view in Zoer.

## 7. Before you finish

- `bun run typecheck`, `bun run test`, `bun run build`, `bun tools/zoer-plugin.mjs validate dist/package` pass.
- 040-destination compares equal to its baseline (`snap.ts compare … --ignore options`), and every import you created is rolled back and cleaned up.
- `bun tools/live-gate/zoer.ts approvals` prints `[]`.
- The test sites you started are stopped.
- Commits explain what changed and what was tested live (run IDs help). Push to GitHub only if the user asked for it.
- Report to the user: the dev version installed, what was tested and how, what's still open, and anything that needs a Zoer change.
