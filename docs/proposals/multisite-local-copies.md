# Proposal: local copies of multisite networks

Status: proposal, not implemented. Zoer Connect refuses multisite (`includes/Plugin.php`, `is_multisite()` → 409 `zoer_unsupported`), so no pull, copy or refresh reaches a network today.

## What WP Migrate offers

- `--subsite` (export or pull one subsite of a network) and `--subsite-source` / `--subsite-destination` (move one subsite into another network).
- "Subsite to single site": a subsite's tables (`wp_N_*`) become the single site's tables, its uploads (`uploads/sites/N/`) become `uploads/`, and only the subsite's users come along, with their capabilities rewritten to the single site's prefix.

## Recommended first step: one subsite → one local single site

This fits Zoer's model, where a local copy is one DDEV site with one managed address. A whole-network copy would need several addresses (subdomain installs) or `wp-config.php` and `.htaccess` changes (subdirectory installs) that the local copy scripts deliberately never make.

### Zoer Connect (source, a new minor version with a capability `subsiteExport`)

1. Allow `is_multisite()` for export only, when the request names `subsite: <blog_id>`. Pushes and imports into networks stay refused.
2. Database snapshot of that blog: its own tables (`{base_prefix}{N}_*`, or `{base_prefix}*` minus the network tables for blog 1), plus `users` and `usermeta` filtered to members of the blog (the `{base_prefix}{N}_capabilities` meta key). Network tables (`blogs`, `site`, `sitemeta`, `signups`, `registration_log`, `blogmeta`) are left out. The source identity reports `prefix` as the blog's prefix and `url` as its `siteurl`.
3. Files: themes and plugins as now (network-activated plugins count as active for `active` mode), media from `uploads/sites/N/` (or `uploads/` for blog 1) exported as `wp-content/uploads/…`.
4. Diagnostics list the network's blogs (ID, domain, path, name) so the dialog can offer a subsite picker.

### WordPress Manager

1. `copy.local` input `subsite` (blog ID), offered only when the source advertises `subsiteExport` and reports blogs.
2. The importer already rewrites the source prefix to the local one for tables and user meta (`LocalCopyRules::userMetaKey`). It needs:
   - the blog's `{base_prefix}{N}_capabilities` / `_user_level` keys mapped to the local `wp_capabilities` / `wp_user_level` (the base-prefix keys of other blogs dropped);
   - `active_sitewide_plugins` (from `sitemeta`, sent alongside) merged into `active_plugins` when `activePlugins: "source"` is chosen;
   - `upload_path` / `upload_url_path` and `uploads/sites/N` URLs rewritten to the single-site layout (an extra URL pair in `urlPairs`).
3. Tests: a fixture network snapshot (two blogs, a network-activated plugin, a user on both blogs) through `import-copy.php`, as `tests/local-import.test.ts` does for single sites.

### Testing

Needs a multisite DDEV test site (subdirectory network with two blogs) added to the live-gate allowlist (`tools/live-gate/guard.ts`) by the user. None of the current test sites is a network.

## Not proposed now

- Whole-network copies and network → network moves (several hostnames, `wp-config.php` constants, `.htaccess` rules).
- Pushing a local single site into a network subsite.
