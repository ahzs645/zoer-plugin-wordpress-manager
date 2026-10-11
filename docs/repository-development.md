# Repository plugin development

WordPress Manager owns the plugin development interface. Repos owns clone/import, editing and Git. **Link site** can select a local copy of a live website; the development updater targets that local DDEV site. Production publication is a separate reviewed action.

## First cycle, including CampusManager

1. Clone/import a repository through **Repos**. For CampusManager, use `https://github.com/Over-the-Edge-Newspaper-Society/campusmanager`.
2. Open **WordPress → Plugin development** and select the repository. **Start development computer** reuses/starts an attached native computer or creates one for the shared files, then prepares PHP/Composer and build-on-save. Existing attached computers can use **Enable PHP/Composer**.
3. Use **Inspect repository and prepare build** for an unfamiliar plugin. Review the proposed command and folder, then **Save settings and build now**. Wait for the tools and current build to succeed. CampusManager builds five nested npm packages and stages `dist/campus-manager`; its install slug is `campus-manager`.
4. **Create local WordPress site** creates a new DDEV site. **Link site** uses an existing local site/copy. Set the source folder and installed slug. Choose **Replace installed plugin** for an existing installation; saving the link alone does not replace files. Site Overview also offers **Develop a repository plugin on this site**, with that site preselected.
5. Use **Review local update → Update local site**. Check added/changed/deleted files. The complete selected plugin folder is replaced after site-side PHP syntax checks. An identical package requires no update. A newly installed plugin remains inactive until **Review plugin activation → Activate plugin**, using the existing backup and Site Health workflow.
6. After installation/replacement, open **local site → Plugins → the plugin’s Development action** to reopen its linked repository and build/update/rollback controls. Its entry displays the repository. An unlinked ordinary local plugin offers **Develop from repository**; choose a source, then **Link site**, with its existing site and plugin folder fixed. Repositories already linked elsewhere are excluded. Unlink the previous development source before choosing another.
7. Open the actual site preview/admin and exercise the plugin. For CampusManager, publish a Shortcode block containing `[unbc_calendar view="list"]` on a page.
8. Edit and save through Repos Files, Chat or Terminal. In Files, choose the running computer under **Repository file source**. For CampusManager, edit `assets/react/src/components/list-views.tsx`. Build-on-save rebuilds the package; it does not deploy it. Wait for success, make a fresh review, update, then reload the preview.
9. **Roll back code** in Development history restores the before-image while the site's current code still matches that update. Database content and saved page edits remain; activation-hook side effects are not reversed. The repository edits remain available for a subsequent update. Deactivate a newly installed plugin before rolling back to its absence.
10. Commit/push source through Repos when ready. Publish the local copy's tested plugin through the existing reviewed **Publish local changes** workflow separately.

## Tools and saved builds

The host prepares checksum-pinned PHP/Composer in the native computer's private runtime storage. Tools are available in Terminal, Chat exec and Scripts. The worker debounces saved edits, builds serially, logs progress with a 15-minute budget, and blocks review/apply when its current build is failed, running or stale. It excludes generated output/dependencies and watches manifest/lock changes. Starting an enabled computer or restarting the host reconciles saved settings; opening a view never starts a stopped computer automatically.

The nested npm recipe can install compatible packages into private runtime storage to avoid slow NFS dependency writes, exposing checked node_modules links in the source tree. Packages with workspace/local dependency or root lifecycle requirements retain their normal install layout. Packaging honors .distignore and preserves nested built assets. Scoped generated paths go into local .git/info/exclude, preserving maintained .gitignore and tracked distribution assets. Other layouts need an explicit command and plugin folder.

## Troubleshooting

| Situation | Next step |
| --- | --- |
| Read-only Files | Start/choose the attached computer under Repository file source. |
| Failed setup | Read its error, resolve network/download access, explicitly retry Enable PHP/Composer. |
| Failed/stale build | Read the output, fix saved source or command, save/rebuild and wait for success. |
| Missing assets | Build nested packages; link the staged plugin folder rather than an unbuilt checkout. |
| Existing plugin is not listed | Start the selected site or enter its exact installed folder name. |
| Source/site changed since review | Inspect the drift and review again. |
| Host rollout changed the workspace session | Reload/reopen before the next action. Links/settings/history remain saved. |
| Interrupted update needs attention | Inspect the site and saved recovery receipt before retrying. |
| Stopped site | Start it. Its managed database remains visible as Offline while stopped. |

Unlinking preserves code, site, repository and history. Remote production/provider sites are not development-update targets. This workflow does not automatically test the browser, push Git changes, or run repository build scripts in Git storage or the WordPress runtime.

## Host contract and maintenance

The plugin declares `workspace:native`, `workspace:wordpress` and `workspace:repositories`. Host changes must be installed before enabling a package that needs the new repository scope. The SDK's `repositoryDevelopmentClient` exposes `inventory`, `prepareComputer`, `tooling` and `configure`; the `/repository-development` version-1 contract supplies metadata-only inventory and repository-bound native computer/build services. It grants no Git credentials, publishing or arbitrary-computer access. Other plugins may select `toolchain: "existing"` and provide their own command.

WordPress link/review/apply/rollback lives under `/wordpress-manager/repositories/:id/development`. Legacy Repos development bookmarks and tooling routes remain compatibility aliases. Existing JSON configuration and worker paths retain their historical names. Review tickets expire after 15 minutes; code recoveries/history persist and belong in host backups.

Maintained implementation: `src/components/extensions/WordPressRepositoryDevelopment.tsx`, `WordPressDevelopmentPanel.tsx`, `WordPressDevelopmentTools.tsx`. The Zoer host's [full operator guide](https://github.com/ahzs645/zoer/blob/main/docs/wordpress-repository-development.md), [runtime lessons](https://github.com/ahzs645/zoer/blob/main/docs/agent-development.md) and [qualification summaries](https://github.com/ahzs645/zoer/blob/main/docs/qualification/wordpress-repository-development/README.md) are maintained in its repository. Raw runtime receipts/screenshots remain in local output. Dated image tags and fixture state are evidence, not permanent deployment configuration.

Use this repository's normal checks: `bun run typecheck`, `bun run test` (with its configured preload), `bun run build`, package validation and `bun run release`. Test host domain suites separately to avoid shared Bun mock leakage. Live verification should cover clone, tools/build, metadata-only linking, replacing an active installed plugin, failed-build refusal, saved edit/automatic rebuild, actual preview, code rollback and stopped/restarted database inventory. Use dedicated authorized fixtures; preserve unrelated sites and repository work.
