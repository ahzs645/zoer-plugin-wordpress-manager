# Zoer Content Modules

A standalone WordPress plugin for importing reusable HTML learning content and inserting it with the native **Content Module** Gutenberg block. No connection to the Zoer service is required.

## Use

1. Install the plugin ZIP in **Plugins → Add Plugin → Upload Plugin** and activate it.
2. Open **Content Modules**, enter a title and upload a ZIP containing an HTML entry page and its assets. An enclosing folder is supported. The importer detects `index.html`, `index.htm`, `story.html` or `story_html5.html`; specify another entry path if needed.
3. Edit a page, insert **Content Module**, and choose the imported module. Set player height, title visibility and the optional separate-tab link in the block settings.
4. Preview and save the page. Reuse the same module in other pages without uploading it again.

The library supports renaming and reversible archiving. Archiving stops blocks from rendering a module and removes it from the picker; it is **not access control** and does not delete its publicly hosted files. Importing another ZIP creates a separate module, preserving existing pages. For a new version, import it and change the block selection. Deactivation/uninstallation preserves modules and files.

## Supported content and limits

Self-contained HTML/JavaScript content such as Articulate Storyline web exports, interactive presentations and other static web modules. This is a content player, **not an LMS**: it does not implement SCORM, xAPI, learner accounts, scores or completion records. Package-specific scripts may retain their own browser state or call external services.

Only administrators (`manage_options`) can import or manage packages. Page editors can select available modules. Import only trusted packages: their JavaScript executes on the site origin, including when an administrator previews it. All course resources are public. The player preserves the site's desktop/mobile navigation; responsiveness and accessibility inside the frame also depend on the imported course.

### Fitting a course to the frame

Enable the content author's scale-to-fit setting before importing. A fixed-size player can overflow even though the block itself is responsive. For the legacy Storyline 360 3.48 export used by PGAIR, the runtime accepts `scale: 'show all'` in the entry HTML; `noscale` keeps its 980px desktop player width. Its separate phone renderer retains its own adaptive layout. Test the slide and playback controls inside the actual frame dimensions, and keep scrolling available within long lesson menus. The plugin does not rewrite arbitrary imported JavaScript or hide overflow to conceal cropped content.

Uploads use authenticated 512 KiB chunks, automatically shrinking to 64 KiB if the server returns HTTP 413. ZIP limit 256 MiB, expanded limit 1 GiB, individual expanded file limit 256 MiB, maximum 5,000 entries. No user-controlled paths reach storage. Archives are scanned before extraction; traversal, links, hidden configuration, executable server scripts, unsupported extensions, encryption and case-colliding paths are rejected. Extracted file sizes and CRCs are verified. Failed extraction removes only its newly created directory. Abandoned temporary uploads are cleaned after 24 hours on subsequent imports (up to 20 per import).

Files live in WordPress uploads under `zoer-content-modules/<random-id>/`; metadata lives in the existing WordPress database as private `zcm_module` posts. Store uploads and database together in backups/migrations. Block IDs are ordinary WordPress post IDs and require normal database ID preservation/remapping when moving pages separately. URLs are derived from the site's uploads URL at render time.

## Build and test

```sh
php -l zoer-content-modules.php
php -l includes/package.php
php tests/package.php
node --check block.js
node --check admin.js
node tests/upload.cjs
python3 build.py
```

PHP ZIP is required. `build.py` creates a deterministic plugin ZIP and SHA-256 sidecar in `dist/`; content packages are intentionally separate. Browser qualification must cover the real WordPress import screen, Gutenberg insertion/save/reload, a public page and the module's own interactions.
