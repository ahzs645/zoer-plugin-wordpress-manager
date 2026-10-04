# WordPress plugin

Read README.md. This package owns WordPress UI and isolated workers; reviewed backend services remain in Zoer. Preserve plugin ID, routes, public contract versions and existing data. Do not embed credentials, backup files, account tokens, local checkout paths or operator API access. Use host controls and the scoped request bridge. Keep native imports static and limited to the host allowlist. Scope CSS under `.zoer-native-wordpress-manager`, including modal content.

Run `bun install --frozen-lockfile`, `bun run typecheck`, `bun run test`, `bun run build`, `bun tools/zoer-plugin.mjs validate dist/package`, `bun run release`. Use real Zoer backend state for browser checks. Build/pack output is ignored. Release tags must match the manifest version. Upgrades adding permissions require the existing host review; a UI release cannot install a new host capability. API-types is a public contract snapshot, not a sibling-worktree dependency.

WordPress-side PHP plugins live in `wordpress-plugins/` (Zoer Connect is a submodule of its own public repository; Content Modules is a plain folder); they are not part of the Zoer package. See README "WordPress-side plugins". For editing an existing Zoer-managed DDEV site from outside Zoer, use `.agents/skills/zoer-wordpress-site-edit/SKILL.md`.
