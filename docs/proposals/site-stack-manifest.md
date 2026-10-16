# Proposal: portable site stack manifest (`zoer-wordpress.json`)

**Status:** proposal (2026-10-16). Nothing here is implemented.

## Goal

Describe a site's plugins and themes once, by where they come from rather than by local IDs, so
the same stack can be applied to a new local site, shared as a link, or kept in a repository.

## What exists today

- Repository plugin development links **one** Repos repository to **one** local site by its
  local repo ID (`/wordpress-manager/repositories/:id/development`, state in Zoer's
  `repository-wordpress-development/state.json`). Inspection already reads a repo-root
  `plugin-manifest.json` for the slug, plus `package.json`, `composer.json` and `.nvmrc`.
- `GET /repository-development` lists repos as `{ id, name, href, attachedComputers }` with **no
  Git URL, branch or commit**, so the plugin cannot match a manifest entry to a repo portably.
- The plugin cannot reach `/api/repos` (clone, read file) and its worker `network.fetch` is
  limited to `developers.hostinger.com`. Extension installs take wordpress.org slugs only
  (1–20 per plan, a theme install exactly one, no version pin); there is no ZIP-URL install.

## Format

Resource names follow WordPress Playground blueprints so an "export as blueprint" stays
mechanical.

```json
{
  "schemaVersion": 1,
  "name": "UNBC Intramurals stack",
  "wordpress": { "version": "6.6", "php": "8.2" },
  "plugins": [
    { "source": { "resource": "git:directory", "url": "https://github.com/Over-the-Edge-Newspaper-Society/campusmanager", "ref": "v1.4.0", "refType": "tag" },
      "slug": "campus-manager", "build": { "recipe": "inspect", "folder": "dist/campus-manager" }, "activate": true },
    { "source": { "resource": "wordpress.org/plugins", "slug": "query-monitor", "version": "3.16.4" }, "activate": false },
    { "source": { "resource": "url", "url": "https://github.com/owner/plugin/releases/download/v2.0.0/plugin.zip", "sha256": "<64 hex>" }, "slug": "plugin" }
  ],
  "themes": [
    { "source": { "resource": "git:directory", "url": "https://github.com/ahzs645/apex", "ref": "main", "refType": "branch", "path": "apex-wordpress/theme/apex-gutenberg" },
      "slug": "apex-gutenberg", "requires": ["apex-interactions"], "activate": true }
  ]
}
```

Rules: HTTPS sources without credentials, query or fragment (the same check as Repos'
`PATCH /:id/remote`); no local repo IDs, paths, tokens or site URLs; `url` sources need
`sha256`; `build.recipe` is `inspect`, `none` or a command that is shown for review and never run
automatically; activation always goes through the existing activation review.

## Resolution

- **git:** match an existing Repos repo by normalized remote URL; otherwise offer **Clone into
  Repos** (the existing clone/GitHub-provider flow), then link, inspect, build, review and apply
  as today.
- **wordpress.org:** existing extension plan/apply.
- **url:** download into a file set, verify the hash, review, install.
- **Sharing:** commit `zoer-wordpress.json` at a repo root ("stack repo") or next to a plugin, or
  paste a raw GitHub URL; Zoer fetches it. The resolved result (commits, versions, digests) is
  saved as a `stack:<id>` catalog record so it can be audited and re-applied.
- **Export:** "Save this site's stack" writes the manifest from a site's plugin/theme inventory
  plus its repository links.

## Phases

1. **Plugin only:** schema and validator, export from a site, wordpress.org entries through
   plan/apply, `stack:` records, a Stack tab that previews entries against the current inventory.
2. **Host metadata (Zoer, reviewed):** add `gitUrl`, `defaultBranch`, head commit to
   `GET /repository-development`; `GET /repository-development/:id/stack-manifest` (reads only
   `zoer-wordpress.json`); optional `version` for extension installs.
3. **Host import and ZIPs:** `POST /repository-development/import { url, ref }` (HTTPS, no
   credentials; a new reviewed scope or confirmation), verified ZIP install from a file set
   (reusing the GitHub-release fetcher's host and size limits).
4. One repo linked to several sites, theme development links, "Export as Playground blueprint".

Any manifest permission or network host change needs the normal host review first; a UI-only
release cannot add those capabilities.
