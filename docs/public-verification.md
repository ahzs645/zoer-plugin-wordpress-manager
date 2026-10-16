# Public verification and cache clearing

A completed transfer is not proof that visitors see it. On 2026-10-16 an Apex publication
(`ddev-apex-local-4b8eb374` → `ep_73d84bc948dd4cd991c6a9e8db5525c0`,
`https://bisque-ant-827212.hostingersite.com/`) completed with database, themes, plugins and
uploads, and the public WordPress page records matched the local ones. The plain homepage was
still an `x-hcdn-cache-status: HIT` from Hostinger's CDN with theme 1.5.11 / plugin 1.4.5, while
a cache-busting query URL looked correct, so query-based checks missed it. The exact cause of
the stale cache entry was not established. This feature makes that state visible and fixable
without treating the transfer as failed.

## Four separate facts

| Fact | Where it is recorded |
| --- | --- |
| Transfer completed | The push run and its `history:` record (unchanged). |
| WordPress cache purge requested | Zoer Connect's per-layer receipt (`wordpressCache` in the check record; `publication.purge` output). |
| Hosting/CDN purge accepted | `cache-purge:<siteId>` catalog record, one entry per layer. |
| Expected content observed publicly | `publication-check:<siteId>` catalog record. |

Only the last one can turn the status green.

## Status labels

| Status | Meaning |
| --- | --- |
| Amber · **Published · check pending** | The transfer completed; no public check of this publication yet. |
| Green · **Current on checked pages** | The expected publication was observed on every listed request. The text names the pages, variants, asset count and time, and says other CDN locations and earlier visitors' browsers can still hold older copies. |
| Amber · **Old content detected** | At least one public response contains an earlier publication, an older page revision, no marker, or an old CSS/JS file. Affected addresses are listed. |
| Amber · **Caches cleared · still old / rechecking** | A purge was accepted but the public site has not caught up yet. Never green on its own. |
| Red · **Check failed** | The check hit an actual error (HTTP error, timeout, security challenge, maintenance page, HTTP-200 WordPress error page, redirect to another host). This is not a transfer failure. |
| Neutral · **Not verifiable** | The site cannot report what it publishes (Zoer Connect before 0.6.0, or no publication recorded yet), with the upgrade explanation. |

Colors are always paired with the text label and an icon.

## How "current" is defined

Zoer Connect 0.6.0 commits a new opaque publication ID (random, not the import ID) for every
completed import or rollback, bound to that import. Public HTML carries it in
`<meta name="zoer-publication">` and `X-Zoer-Publication`; singular pages also carry
`<meta name="zoer-revision">`, a short hash of the post ID, modification time and content. The
authenticated `GET /publication` returns the expected ID and the home page plus up to eight
recently modified pages/posts with their revisions, read from the database (not the object
cache). This avoids whole-page HTML comparison, so URL rewriting, nonces, generated IDs and
image optimisation do not cause false alarms.

- A theme version alone cannot detect stale database content: the page revision does.
- Changed CSS/JS whose version number did not change: the check hashes each linked
  `wp-content/themes|plugins/*.css|js` file (as served, including its `?ver=`) and compares it
  with the SHA-256 of the same path in the pushed file set. Images are not compared (hosting
  image optimisation rewrites them).
- A cache HIT is fine when it carries the current publication; HTTP 200 alone is not success.

## What the check requests

`publication.verify` (resumable worker, `local_write` for its catalog record) reads, for each
expected page, the exact canonical URL — no query, no cookies, no key — as a desktop and a
mobile browser, follows up to three redirects on the same host, and records status, final URL,
redirects, publication ID, revision and cache headers (`cache-control`, `age`, `expires`,
`vary`, `x-hcdn-cache-status`, `cf-cache-status`, `x-cache`, `x-litespeed-cache`, …). For a
stale page it adds one fresh-response diagnostic with `?zoer-check=<id>`; that result is only
shown as "a fresh response is current", never counted as success, and is not proof of direct
origin access.

Requests go through the Zoer host's `network.fetch` scope `endpoint-public` (manifest
`requiredEndpoints[site].publicProbe`): only the endpoint's own HTTPS host, GET/HEAD, outside the
keyed `/wp-json/zoer-connect/v1/` API, with no key, cookie or authorization; the endpoint's
address policy is pinned; responses are bounded (4 MiB per response, 60 requests per slice,
40 public requests per slice, 9 pages × 2 variants + 8 assets per attempt). There is no
arbitrary URL-fetching route.

The result is one `publication-check:<siteId>` record per destination. A check never overwrites
a record of a newer publication (`committedAt`) or a newer check of the same publication, and a
check started for an import's Finish is "superseded" when that import has since been rolled back
(the rollback is a newer publication with the same import ID). Verification failures never
republish, replace the database or roll back.

### When it runs

- After **Finish**: the push run card shows the public check and starts it once for that import
  (it runs as a durable Zoer run; you can close the page). If the page was closed before the
  card loaded, the card shows "Published · check pending" with **Check now** next time.
- **Recheck** on the run card or on the live site's Overview.
- **Clear caches and recheck**: rechecks with a resumable backoff of 30 s, 1, 2, 4 and 8 minutes
  (about 16 minutes) while old content remains; the record says "rechecking" in between.

## Clear caches and recheck

Each layer has its own capability and receipt:

| Layer | How | Receipt |
| --- | --- | --- |
| WordPress caches | `publication.purge` → Zoer Connect `POST /cache/purge` (Zoer approval, `external_write`). LiteSpeed Cache, WP Rocket, W3TC, WP Super Cache, Breeze, WP Fastest Cache, Cache Enabler, SiteGround Optimizer, Autoptimize, object cache. | Per plugin: `requested` (hooks give no confirmation), `not-detected`, `failed`; object cache `flushed` / `failed`. |
| Hosting cache | Zoer's existing Hostinger site tool (`DELETE /api/hosting/v1/accounts/{username}/websites/{domain}/cache/clear`). | `accepted` with time, or `unavailable` / `failed` with the manual path. |
| CDN | Hostinger documents that the same website cache clear also purges its CDN when enabled; there is no separate CDN API. | `requested`, never "completed": only the public check confirms it. |

The hosting layer needs an explicit link from the Zoer Connect site to a Hostinger website
(`cache-link:<siteId>`). Candidates are only websites that a connected Hostinger account lists
with exactly the endpoint's host name; the user confirms one. Zoer never guesses an account from
a domain. Before clearing, Zoer tests the account; an expired authorization is shown on the site
page with **Reconnect** and the manual path:
*Hostinger hPanel → Websites → domain → Dashboard → Clear cache, then Performance → CDN → Flush
cache.* Caching is never disabled and no other site is purged.

Other providers can join through the same shape: a cache link record, a `PurgeLayer`
(`layer`, `provider`, `state`, `detail`, `at`) and the shared recheck.

## Browser caches

Anonymous Apex HTML currently carries `Cache-Control: public, max-age=604800` and a seven-day
`Expires` (2026-10-16, `x-hcdn-cache-status: DYNAMIC`); theme CSS carries `max-age=2592000`.
A browser that has the page considers it fresh for seven days and does not ask the server. **No
CDN purge and no new response header can reach HTML already cached in a visitor's browser**; a
hard reload or the expiry does. The check reports this as an advisory when HTML may be reused
for an hour or more.

Recommended policy (to qualify per provider before rollout; not changed on Apex):

- HTML: `Cache-Control: public, max-age=0, must-revalidate` for browsers (they revalidate with
  `ETag`/`Last-Modified` and get `304` when nothing changed). Shared caches may keep it longer
  through `s-maxage` or the CDN's own rules, which a purge can clear.
- Versioned/hashed static assets (`?ver=` or hashed names): long `max-age` (30 days to a year)
  plus `immutable` where the file name or version changes with the content. Unversioned assets
  that change in place need a short `max-age` or a version bump, otherwise "stale asset with an
  unchanged version" recurs.
- Keep browser policy separate from shared/CDN policy. On Hostinger the HTML `max-age` comes from
  the hosting/LiteSpeed browser-cache configuration, not from WordPress; qualifying a change
  needs an authorized Hostinger test site and a before/after public check of both headers and
  content.

## Limits

- One server location and two request variants cannot prove every CDN edge or every visitor's
  browser is current; the green text states the checked scope and time.
- Sites behind a bot challenge or maintenance page report "Check failed" with that reason.
- Zoer Connect older than 0.6.0 is "Not verifiable". A site whose last import predates 0.6.0 is
  "Not verifiable" until it is published to again.
- The hosting layer currently supports Hostinger only.

## Tests

`tests/publication-verify.test.ts` reproduces stale caching with a deterministic fixture (an
origin plus a CDN keyed by exact URL and optionally device): old plain URL but current query URL,
old page content with the new theme, stale asset with an unchanged version, desktop/mobile
variants, HTTP-200 error pages, challenges, maintenance, timeouts and off-site redirects, legacy
connectors, purge accepted while still stale (bounded backoff) and later clearing, overlapping
publications and rollbacks, restart/resume, and the browser HTML cache advisory.
`publicationCheck.test.ts` covers labels, hosting-link candidates and expired authorization.
Zoer host: `plugin-endpoints.test.ts` (endpoint-public scope), `wordpress-connect-proxy-headers.test.ts`
and `ddev-bridge/tests/http-proxy.test.ts` (key forwarding for the new routes). Zoer Connect:
`tests/publication-identity.php`, `tests/cache-purge.php`.
