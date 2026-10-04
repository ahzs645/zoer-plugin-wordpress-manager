---
name: zoer-wordpress-site-edit
description: Edit an existing Zoer-managed DDEV WordPress development site from an agent working outside Zoer. Use for theme, plugin, or Gutenberg page changes when the user has authorized that site; not for generic Zoer Sites deployments or production Hostinger replacements.
---

# Edit a Zoer WordPress site from outside Zoer

This skill covers an **existing WordPress · DDEV development site** managed by Zoer. A public `*.wp.*` URL identifies the site to inspect; it is not the Zoer API origin or authorization to edit the site. Use the API origin and access method actually supplied for the current session. Discover the site ID from WordPress Manager rather than deriving it from the public hostname.

## Access and target

1. Identify the requested site in `GET /api/wordpress-manager/sites?fresh=1` (response: `{ "sites": [...] }`). Confirm its ID, provider `ddev`, development URL, and status. `GET /api/wordpress-manager/lifecycle/sites` is another local-site inventory.
2. Use a supported authenticated Zoer tool or interface when the deployment is protected. Direct HTTP to the endpoints below is available only when that deployment intentionally exposes its open-access development APIs. Do not extract browser cookies, copy Zoer/provider credentials into an agent computer, or use shell HTTP to bypass unavailable host tools.
3. Scope writes to the named development site. A production or external WordPress site needs its own supported, reviewed workflow; these DDEV file endpoints do not make it editable.

If access, site identity, or write authority cannot be established, continue with local source work and report what is needed to apply it. Do not guess a hostname, site ID, password, or token.

## Find the authoritative content

For a DDEV site, Zoer's computer file API exposes the WordPress tree under `/workspace`. Theme and plugin files normally appear at `/workspace/wp-content/themes/<theme>/` and `/workspace/wp-content/plugins/<plugin>/`; the DDEV container sees the corresponding files under `/var/www/html/wp-content/`. List `/workspace` before assuming a particular layout. A separate source checkout or generated ZIP is not automatically the live site.

| Operation | Zoer endpoint |
| --- | --- |
| List directory | `GET /api/computers/:siteId/files?path=/workspace/...` → `{ "output": ... }` |
| Read text | `GET /api/computers/:siteId/files/read?path=/workspace/...` → `{ "content": "..." }` |
| Write text | `POST /api/computers/:siteId/files/write` with JSON `{ "path": "/workspace/...", "content": "..." }` → `{ "ok": true }` |
| Upload binary | `POST /api/computers/:siteId/files/upload` (multipart; inspect the current route before use) |

URL-encode the `path` query value and send writes as structured JSON. The text write endpoint is for text, not images or ZIP bytes. Check HTTP status and response body. The file API has no compare-and-swap precondition, so a hash check reduces overwrite risk but is not an atomic lock.

Theme, plugin, CSS, JS, templates, and patterns can be file edits. **Saved Gutenberg page content lives in the WordPress database.** Editing a local `content/*.html` or pattern file does not update an already saved page. Use the authenticated WordPress editor or a supported WP-CLI path for saved posts. Read the current post content, keep a recoverable copy, and use a narrow, exact replacement that refuses to run when its expected block is absent or changed. Preserve native block markup and confirm the post still parses in Gutenberg. Do not run an old bulk importer against an edited site without checking its baselines.

## Make and verify the change

1. Inspect the live target and any local source/package. Check the relevant repository status before editing shared files. Record the live file or post content and its hash or exact block baseline; keep a recoverable copy for an existing site.
2. Make the smallest change in the maintained local source. Immediately before a live text write, reread the target and compare it with the baseline. If it changed, reconcile the new version first. Write only the intended file or post.
3. Read back the live target and compare it with the intended bytes or block content. For PHP or JS, run the applicable syntax check. Refresh the actual development URL and check the affected page, interaction, and relevant light/dark or mobile state. A successful API response alone is not visual verification.
4. If the project distributes a theme/plugin ZIP, update it from the same source. Report local changes, live DDEV changes, package changes, and browser verification separately. A direct DDEV edit is neither a Git push nor a WordPress Admin upload, and may be replaced by a later package installation if the sources diverge.

For DDEV commands, Zoer exposes terminal sessions at `POST /api/computers/:siteId/terminal/sessions` (JSON `{}`), `POST /api/computers/:siteId/terminal/:sessionId/input` (`{ "input": "...\n" }`), and `GET /api/computers/:siteId/terminal/:sessionId/output`. Use WP-CLI only after locating the site's WordPress root. Treat database changes and extension management according to the deployment's current permission and backup workflow; do not use terminal commands to evade a guarded WordPress Manager action.

The current Zoer implementation defines these routes in `backend/src/routes/computers-files.ts`, `backend/src/routes/computers-terminal.ts`, and `backend/src/routes/wordpress-manager.ts`. Inspect them when a response or deployment version differs from this skill.
