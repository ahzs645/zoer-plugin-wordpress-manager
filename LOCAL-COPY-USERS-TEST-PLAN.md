# Live test plan: local copy / restore user accounts

Handoff for a testing agent. Not meant to be committed. Read `AGENTS.md` and `docs/live-testing.md` in this repository first; their site rules apply to everything below.

## What changed (uncommitted, in this working tree)

`copy.local` and `backup.restore-local` gained a `users` input with three modes. The UI shows it in the new WP Migrate-style panels (Database / Find & Replace / Files / After the import) of **Local copies** and **Restore from backup**:

| UI choice | `users` | Expected result on the new DDEV site |
|---|---|---|
| Keep only the local administrator (default) | `local` | Source users are **not** copied. Posts are assigned to the local `admin`, and comments get `user_id` 0. |
| Copy users and user metadata | `source` | Source users and user meta are copied with their **original IDs**. The local `admin` is added beside them (next free ID; renamed `zoer-local-admin` if the source already has an `admin` login) and marked with usermeta `zoer_local_administrator=1`. |
| Replace with the source's users exactly | `exact` | Source users and user meta are copied with their original IDs. **No** local administrator is added (WP Migrate's default behavior). |

All copying modes:
- Meta keys and the roles option starting with the source table prefix take the local prefix (e.g. `WpS_capabilities` → `wp_capabilities`).
- `session_tokens` and `_application_passwords` are dropped.
- Before the table swap, the importer checks that Zoer's Admin button can still sign in. The DDEV bridge signs in as the `admin` login if it exists (it must be an administrator), otherwise as the only administrator. If neither holds, the run stops with a `ZOER_ERROR` message, and nothing is replaced.

Also:
- URL replacement covers http and https, `//host`, JSON-escaped (`\/`) and URL-encoded forms in one pass.
- Values over 1 MiB no longer abort the import.
- `blog_public` is set to 0.
- MySQL 8 `_0900_` collations are converted for MariaDB.
- The `zc_b_*` backup tables are dropped after the final HTTPS check.
- Run cards show a stage checklist and a database summary (tables, rows, URL replacements, users).

## Environment

- Zoer: `https://zoer.k8s.overtheedgepaper.ca`. Open-access mode; dismiss the "Open access" notice with Continue.
- Installed plugin: dev build **`wordpress-manager 0.9.2-dev.1791494242`**, already built from this tree. Rebuild/push only if you change code:
  - `bun run typecheck && bun run test && bun run build && bun tools/zoer-plugin.mjs validate dist/package`
  - `ZOER_URL=https://zoer.k8s.overtheedgepaper.ca bun tools/zoer-plugin.mjs dev dist/package --enable --label local-copy-users`
- `export ZOER_URL=https://zoer.k8s.overtheedgepaper.ca` for `tools/live-gate/*`.
- **Current state:** `ddev-zoer-connect-040-source` is **running** (started for these tests). No approvals are open.

### Site rules (strict)
- Write only to the DDEV test sites (`ddev-zoer-connect-040-source`, `-040-destination`, `-0314-compatibility`) and to **new** DDEV sites these tests create.
- Never touch Hilltop Childcare (`lightpink-vulture-195751`, any `ddev-hilltop-childcare-*`). Not even reads.
- Do not touch `ddev-unbc-intramurals-backup-12d8b897`; it holds the user's manual fix.
- Do not pull from or write to production `overtheedge.unbc.ca` (`external:6787…`) or `intramurals.unbctimberwolves.com`.
- To trash a test site you created: `LIVE_GATE_ALLOW_SITE=<siteId> bun tools/live-gate/zoer.ts start site.archive '{"siteId":"<siteId>"}'`.

### Known tooling quirks
- **Admin button in the built-in browser:** pop-ups are blocked, so the button shows "Allow pop-ups for Zoer". Use the same handoff the button uses, from a Zoer tab:
  `const r = await fetch("/api/computers/<siteId>/wordpress-login-handoffs",{method:"POST",credentials:"include"}); location.assign((await r.json()).path)`
  Then **wait about 4 seconds** for the redirect to set the cookie before navigating. The WordPress session lasts **15 minutes**.
- `bun tools/live-gate/zoer.ts wp <site> …` only allows a read-only subset. `user list --fields=ID,user_login,user_email,roles --format=csv` works. `option get`, `user meta list`, `post list` and `db prefix` are refused. Check those in wp-admin via the handoff (Users, Posts, Dashboard → "Search engines discouraged", Plugins).
- `snap.ts save <site>` works on sources with Zoer Connect active. New copies start with all plugins inactive, so it fails on them; that's expected.
- **Restore file picking:** the built-in browser cannot drive the OS file picker, and the page cannot fetch from localhost. Use a browser tool with file upload (e.g. Claude in Chrome `file_upload`), or have the user pick the files.

## Already passed (2026-10-08)

**T1. Copy users (`source`) from 040 Source.**
- Run: complete in 2m59s. Stages all ticked. Summary "14 tables · 230 rows · 18 URL replacements · 3 users and 48 user meta rows copied".
- Users: `srcadmin`(1, admin, 2 posts), `jdoe`(2, author, 1 post), `onlysource`(3, author, 1 post), local `admin`(4, admin, 0 posts).
- The source prefix `WpS_` → `wp_` rewrite worked: roles resolve.
- Dashboard shows "Search engines discouraged".
- The Admin handoff signed in as the local `admin`.
- That site was trashed afterwards.

## Tests to run

For each: note the run card text (stages, summary, database facts), the users list, the Admin handoff result, and any error. Trash every site you create when done.

### T2. Exact users (`exact`) from 040 Source
1. Zoer → WordPress → *Zoer Connect 040 Source* (shown as "Source Brand Site") → **Transfer & publish** → **Connect Zoer** → scroll down → **Local copies**.
2. Create new local copy, name `Exact copy test`. In the Database panel choose **Replace with the source's users exactly**. Open Find & Replace and check that the five rows show `zoer-connect-040-source.wp.k8s.overtheedgepaper.ca`. Leave Dry run off. Click **Create local copy**.
3. Expected:
   - The run completes. Stages include "Import database and users".
   - Database facts end with "3 users and … user meta rows copied exactly, no extra administrator". The summary says "with 3 source users".
   - `user list` on the new site shows exactly IDs 1 `srcadmin` (administrator), 2 `jdoe`, 3 `onlysource`. **No** `admin` and **no** `zoer-local-admin`.
   - The Admin handoff signs in as **`srcadmin`**: the source has no `admin` login and exactly one administrator.
   - In wp-admin → Posts, authors match T1. Dashboard: "Search engines discouraged". Plugins: all inactive.

### T3. Default mode (`local`) regression from 040 Source
1. Same dialog: new copy `Local mode test`, **Keep only the local administrator**.
2. Expected:
   - `user list` shows only the local `admin`.
   - In wp-admin → Posts, every post's author is `admin`. Comments keep their text but have no linked user.
   - Run card database facts include "local accounts kept".

### T4. Refresh in `source` mode keeps the marked local admin
1. Create a copy in `source` mode (as T1), then in the same dialog choose **Refresh an earlier local copy**, pick it, keep **Copy users and user metadata**, and run it.
2. Expected:
   - A "Recovery backup" stage runs.
   - Afterwards `user list` still has exactly the source's 3 users plus local `admin` at the **same ID as before** (4).
   - No `zoer-local-admin` and no duplicate admin.

### T5. Hostinger restore, real backup with 114 users (the original bug)
Files (on the user's Mac): `~/Downloads/u921325972.intramurals-unbctimberwolves-com.20261006202752.tar.gz` and `~/Downloads/u921325972_zqAXK.intramurals-unbctimberwolves-com.20261006202752.sql.gz`. A sealed upload of the same pair already exists on Zoer (`fs_e723499a7f2e66859ba2200fcef56c63`), so the UI should find it and skip uploading.
1. **New local site** → **Restore from backup** → Backup format **Hostinger** → name `Intramurals users test`.
2. Choose both files. Choose **Copy users and user metadata**. Untick **Dry run**. Click **Upload and restore**.
3. Expected:
   - The run completes with the restore stages.
   - Database facts show **114 users** and about **3,403** user meta rows copied, minus any dropped sessions or application passwords (`droppedMeta`).
   - If the backup has MySQL 8 collations, a fact like "collation utf8mb4_0900_ai_ci → utf8mb4_unicode_520_ci in N tables" appears.
   - `user list` shows **115** users (114 + local admin). The Admin handoff works.
   - In wp-admin a few users' profiles still exist, and Clerk-related meta survived. That's 1,680 Clerk rows in the original backup; check a user's profile, or a Clerk plugin screen after activating it locally if needed.
   - Search engines discouraged; plugins inactive.

### T6. Hostinger restore in `exact` mode (expected outcome depends on the backup's admins)
1. Same as T5 but choose **Replace with the backup's users exactly**.
2. Expected, one of:
   - **(a)** The backup has an `admin` login that is an administrator, or exactly one administrator: it completes with 114 users, and the Admin handoff signs in as that account.
   - **(b)** Otherwise the run stops with a message starting "The copy would have N administrators and none named “admin”…" (or "The copied “admin” account is not an administrator…"), and the site's database is **not** replaced. Report which case occurred and the exact message. Then cancel the run and trash the site.

### T7. UI checks
- Run `bun tools/live-gate/ui-smoke.ts --site ddev-zoer-connect-040-destination --tag local-copy-users`. It's read-only, at 1440 and 390 wide. Look at the screenshots in `tools/live-gate/.shots/`.
- In Local copies and Restore from backup at 390 wide:
  - no horizontal page scroll
  - Find & Replace rules stack as "find → replace / form"
  - the stage list is a single column
- Accessibility: the three user-account radios should be announced by their titles. An earlier accessibility-tree read showed one as just "local", so check what a screen reader actually gets.

## Cleanup and report
- Trash every site created (T2–T6). Stop 040 Source: `bun tools/live-gate/zoer.ts start site.stop '{"siteId":"ddev-zoer-connect-040-source"}'`.
- `bun tools/live-gate/zoer.ts approvals` must print `[]`.
- Report per test: pass/fail, run card text, `user list` output, Admin handoff account, and any error or UI issue (with screenshot file names).
