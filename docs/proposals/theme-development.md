# Proposal: theme development pathway

**Status:** steps 1–3 partly implemented (2026-10-16); steps 4–5 are proposals. Example:
`apex/apex-wordpress`.

Implemented: repository development links take `kind: "theme"` (Zoer host
`repo-wordpress-theme.ts`): inspection finds exactly one theme (`style.css` header plus
`templates/index.html` or `index.php`), a block theme starter, install/update into
`wp-content/themes/<slug>` with the same review, PHP syntax check and rollback, and reviewed
activation. 0.12.0 adds Site Editor capture into the repository, removal of matching Site Editor
copies, and database-override warnings before Push to live ([release notes](../releases/0.12.0.md)).
Not yet: build hints beyond the plugin ones, portability warnings and required-plugin detection.

## The example: Apex

- Monorepo (`/Users/ahmadjalil/github/apex`): the block theme lives at
  `apex-wordpress/theme/apex-gutenberg/` (`theme.json` v3, `templates/` front-page/page/index/404,
  `parts/` header/footer, six `patterns/`, local fonts/SVGs/images in `assets/`), its companion
  plugin at `apex-wordpress/plugin/apex-interactions/`.
- No npm build for the theme. `tools/build.py` regenerates parts/templates/patterns from
  `content/source-data.json`; `tools/package-fidelity.py` zips theme + plugin; a jsdom +
  `@wordpress/blocks` test validates blocks. No CI, `.wp-env.json` or DDEV config.
- `functions.php` loads handles registered by the companion plugin; nothing declares that
  dependency. Saved pages reference page IDs, a navigation ID and media IDs; patterns use
  root-relative `/wp-content/themes/apex-gutenberg/...` URLs. Its README already treats
  "WordPress-saved content" as authoritative.
- Deployment today: custom tar-chunk upload through a Zoer computer and an importer that checks
  host names and refuses to run if `wp_template`/`wp_template_part` posts exist; later full
  local → destination publications through WordPress Manager.
- Theme 1.5.12–1.5.22 is uncommitted (37 modified files at the time of writing): a pathway that
  reads commits would see 1.5.11.

## Why themes differ from plugins

A plugin is code. A block theme is code **plus database records that override it**: Site Editor
saves create `wp_template`, `wp_template_part`, `wp_global_styles` and `wp_navigation` posts
(linked through the `wp_theme` taxonomy) that win over the files. Choosing a style variation
copies it into the database. So:

1. A theme code update can look like it did nothing wherever a database override exists.
2. A designer's Site Editor work never reaches Git unless it is captured back into files.
3. Templates/patterns reference media and navigation IDs that differ between local and live.

The existing code publication already declines to copy these records ("Saved content and
current live data" in `docs/code-publication.md`).

## Common practice (2026)

- **Create Block Theme** (WordPress.org, ~20k installs) — "Save Changes to Theme" writes
  templates to files and styles to `theme.json`, copies fonts/images, and with "overwrite theme
  files" removes the database copies.
- Builds: Sage (Vite + Acorn), `_tw` (Tailwind, `npm run bundle`), wp-scripts; many block themes
  (Frost, Ollie — like Apex) have no build.
- Local: wp-env maps a theme folder; Playground blueprints `installTheme`/`activateTheme`.
- Deploy: Studio's selective theme sync, rsync GitHub Actions, Git Updater (`GitHub Theme URI`).

## Pathway in five steps (reusing the plugin primitives)

1. **Inspect and build** — choose the repo and theme folder (subfolders like Apex's supported).
   Inspection reads the `style.css` header (Name, Version, Requires at least/PHP, Text Domain,
   `Template:` parent), block vs classic (`templates/index.html` vs `index.php`), `theme.json`
   version, `parts/`, `patterns/`, `styles/`, build hints (`package.json` scripts, Composer,
   `.nvmrc`, custom generators such as `build.py`), output (`dist/<slug>`, zip), required plugins
   (handles enqueued but not registered, sibling plugin folders), portability warnings
   (hard-coded `/wp-content/themes/...` or upload URLs, numeric `"id"`/`"ref"` in parts/patterns,
   uncommitted changes, large committed zips).
2. **Install locally** — into `wp-content/themes/<slug>` on a linked or new DDEV site with the
   same review, PHP syntax check and code rollback as plugins; install required plugins first.
3. **Activate and preview** — review-gated activation (extension plan `kind: "theme"`); warn
   when database overrides will hide file changes and list them.
4. **Capture Site Editor changes** — list the theme's `wp_template`, `wp_template_part` and
   `wp_global_styles` records next to their files (three-way: repo, site files, database), write
   the chosen ones back into the repo (templates, `theme.json`), turn media/navigation IDs into
   theme-relative assets, then clear only those database copies. Commit through Repos.
5. **Publish code, keep live data** — the existing *Code only* push with this theme selected,
   then the public check (`publication.verify`): it reports old page content (page revision) and
   stale CSS/JS (asset digests) even when the theme version changed. Warn first when the live site
   has database overrides that would hide the update.

## Host vs plugin work

- Plugin only: inspection heuristics displayed to the user, warnings, activation review, code-only
  theme push, public check.
- Zoer host (reviewed): a theme target for `/wordpress-manager/repositories/:id/development`
  (`kind: "theme"`, `wp-content/themes/<slug>`, theme rollback); site-side bounded steps to read,
  write back and clear Site Editor records; repo writes through `workspace:repositories` likely
  need a new reviewed capability.

## Risks

Database overrides hiding updates (local and live); capture overwriting repo edits without a
three-way compare; clearing overrides on live is a destructive content change (needs its own
review and backup); activation changes widgets/menus/front page; missing companion plugins break
rendering; pattern media pointing at local IDs.
