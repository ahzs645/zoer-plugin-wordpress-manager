# WordPress extension library (unreleased)

Open **WordPress → Extension library** in the manager's header actions. The library belongs to the WordPress Manager plugin and is available without selecting a site. It reuses the plugin's existing catalog; it does not create a project database or add a Zoer core feature.

- **Add repository** saves a plugin or theme's GitHub URL, name, WordPress slug, Git ref, extension folder and description. `owner/repository` and HTTPS GitHub URLs are accepted. `HEAD` follows the repository's default branch. Private repository references can be saved; registration grants no GitHub credentials.
- **Add manifest** reads a JSON file from a public GitHub repository, uploaded/pasted JSON, or a repository already imported into Zoer (including an authorized private repository). Choose its file path and, for public GitHub, branch/tag/commit. Review resolves its nested manifests, shows the number of unique extensions, and enables Save. A failed read saves nothing.
- **Manage sources** edits individual entries, reviews/refreshes manifests, or removes a source. The library keeps the last saved snapshot until a replacement is reviewed and saved. Removing a manifest removes only that source's references. Extensions supplied by another source remain. These operations never delete Git repositories or change an installed WordPress site.
- **Export library** downloads `wordpress-library.json` with individual repositories, all saved manifest locations, and embedded manifest snapshots. **Import library** merges that export atomically, without flattening the sources or fetching manifests whose snapshots are already embedded. Re-importing the same export is idempotent. Use Add manifest to keep an external collection as one managed source; use Import library to restore the original individual sources.

Search filters plugins and themes by name, slug, description, repository and origin. Identical kind + repository + ref + folder + slug entries appear once with all their origins. Manually registered metadata wins over the same entry from a manifest. Different refs or folders remain separate entries, including multiple extensions in one repository.

## Manifest format

See [the example](examples/wordpress-library.json). Its URLs are placeholders; replace them before importing. `schemaVersion` is required and must be `1`. `repositories` and `manifests` default to empty arrays. Repository entries require `kind` (`plugin` or `theme`) and `repositoryUrl`; name and slug default to the repository name, ref to `HEAD`, and folder path to `.`. Set an explicit lowercase slug when the repository name is not a WordPress slug. Manifest entries have an optional name, a GitHub `repositoryUrl`, ref and JSON file path (default `wordpress-library.json`), or an embedded `snapshot` containing another complete manifest.

All remote JSON is fetched through the host's mediated HTTPS network service from `raw.githubusercontent.com`, with no credentials. Private manifests should be uploaded or read through the existing imported-repository file service. Nested private manifests need embedded snapshots or should be imported separately. Remote redirects and arbitrary URL hosts are not followed by the library. No manifest scripts are executed.

The combined export is limited to 1 MiB and 500 entries (repositories plus nested manifest references), with up to 30 manifest documents, five nesting levels, 20 remote reads per resolution and 100 saved sources. Import refuses cycles, invalid entries, unsafe paths and unsupported schema versions before any catalog mutation. Refresh failures preserve the previous snapshot. Revision conflicts are retried and successful changes are read back.

## Chat

Use **Copy chat reference** beside an extension and paste it into chat. It includes `@wordpress`, the extension name, repository URL, ref, folder and slug. For example:

> @wordpress Use the saved plugin "Our forms" from the extension library: https://github.com/example/our-forms, ref main, path ., slug our-forms.

Installed CLI chats with `@wordpress` can inspect the `extension-library` records through the existing `zoer_read_plugin_catalog` tool (`includeData: true`). Each record is an individual repository or a manifest with resolved nested snapshots. The plugin also declares `library.search` for bounded name/slug/description/repository/origin search with `query`, optional `kind`, and `offset`/`limit` pagination (20 entries maximum). Existing plugin action discovery, planning and execution tools expose it; starting an action follows the host's existing named-chat/Full-access policy. `library.resolve`, `library.save`, `library.import` and `library.remove` are also exposed as plugin actions for authorized management.

This adds no new composer token type or automatic source checkout. Other chat runtimes can use the complete copied reference; runtime support for catalog/action tools remains the host's existing capability. A reference supplies metadata, not Git credentials or permission to install/activate code. Use the existing Development workflow for source checkout, build and reviewed installation.

## Package review and checks

This change adds `raw.githubusercontent.com` to the plugin's network allowlist and five declared actions, including three local-write actions. Install/upgrade through the host's normal review; replacing only the UI does not grant those capabilities. Existing site, transfer and catalog records are preserved. The feature has no Zoer core route, schema or PHP connector change.

Run `bun run typecheck`, `bun run test`, `bun run build`, `bun tools/zoer-plugin.mjs validate dist/package`, and `bun run release`. The focused manifest and library tests cover mixed sources, snapshots, refresh, cycles, validation, import/export round trips, shared origins, concurrent commit retry and paged chat search. A local package is not a deployed upgrade or a live browser check.
