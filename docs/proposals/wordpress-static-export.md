# WordPress static export and reuse

Status: **implemented, deployed and qualified for the DDEV scope below**, 22 October 2026. The feature remains partial relative to the broader remote-site, content-migration and automatic-publishing options described here.

**Export static website** saves a managed DDEV site's public pages and discovered assets as a downloadable ZIP. It preserves the rendered WordPress design, rewrites captured links, and reports features that still need WordPress or another service. WordPress remains the editable source. Exports use a native Zoer crawler; they do not install Simply Static, Staatic or another plugin on the source.

## Use the exporter

1. Start the managed DDEV site and open **WordPress → select site → Push & pull → Export static website**.
2. Choose **Configure export**, then **Whole website** or **Selected pages**. Enter selected source-relative page paths one per line, including supported pagination parameters when needed.
3. Choose **Portable relative links** for an export that can move between website folders or content-package locations. Choose **Links under a destination path** when the final path is known, such as `/` or `/resources/`.
4. Set page, asset and size limits under **Options**, then select **Check site**. Review the sampled pages, candidate links and compatibility findings.
5. Select **Build export**. Saved progress survives closing the dialog. The saved-export list provides cancellation, retry, preview and **Download ZIP**. Failed or cancelled jobs can be configured and checked again.
6. Use the export's menu to **Delete saved export** when its retained files are no longer needed. This keeps the source WordPress site and copies already downloaded.

The source must be running to inspect or build an export. Completed artifacts remain available after it stops. A live WordPress site can first use the existing **Make a local copy** workflow; direct static export from remote Zoer Connect sites, Kubernetes pilots and Playground is not currently provided.

## Export options and actual output

| Choice | Current behavior |
| --- | --- |
| Whole website | Starts at the homepage and follows supported public links and discovered WordPress sitemap entries |
| Selected pages | Includes the chosen page paths, their supported query-pagination states and discovered assets; ordinary links outside the selection remain links to the source |
| Portable relative links | Rewrites captured HTML, CSS and module references relative to each output file, so the ZIP can be extracted under different website paths |
| Links under a destination path | Uses the explicit destination path for captured links; the receiving host must serve the folder at that path |
| Page limit | Up to 500 pages, including separately rendered query states |
| Asset limit | Up to 5,000 discovered assets |
| Size limit | Up to 256 MiB of collected and rewritten output, with a separate 32 MiB response ceiling |
| Preview | Opens the saved artifact through a temporary, isolated preview rather than running the source website |
| Download | A ZIP of public static files; detailed job metadata and compatibility reports stay outside the deployable files |

The ZIP has a root `index.html`. A single selected page becomes that entry, including its explicitly selected query state. Multiple selected pages without the homepage get an index linking to them. Other captured pages keep their path structure; query states get separate paths. Shared assets are deduplicated by normalized URL. Assets with cache-version parameters can share one local file; content-changing asset queries retain distinct output names.

This is a bounded anonymous crawl. Pages without discoverable links or sitemap entries, JavaScript-only navigation, runtime-generated resource URLs and unbounded filters are not a complete content inventory. The **Check site** result explicitly identifies its sample size; the build discovers further resources. A page or asset failure and a reached limit produce a failed export rather than a successful partial website.

## Query loops and pagination

A WordPress Query Loop executes when WordPress renders the page. The export captures its current cards, images, links and layout. Publishing, deleting or changing posts requires another export to refresh the static results.

WordPress distinguishes archive pagination from independent query-loop pagination. Its [pagination source](https://github.com/WordPress/wordpress-develop/blob/trunk/src/wp-includes/blocks/query-pagination-next.php) can generate `query-<queryId>-page` or `query-page` parameters for independent loops. The [Query Loop documentation](https://wordpress.org/documentation/article/query-loop-block/) also describes enhanced navigation and full-page reload behavior.

| Query behavior | Current export handling |
| --- | --- |
| Latest posts without pagination | Saves the rendered results |
| Blog, category, author or other archives | Follows their discovered public pagination links within the selected scope |
| `?query-7-page=2` and similar core pagination | Renders the source URL into a separate static path and rewrites captured pagination links |
| Multiple loops on one page | Preserves the complete supported query state; discovered combinations get distinct output paths |
| Core enhanced query navigation | Removes the core query-navigation handlers from output so captured normal links can perform full-page navigation |
| Plugin AJAX filters, infinite scroll or load-more controls | Reports source/runtime dependencies; arbitrary plugin behavior is not converted |
| Free-text search or visitor-specific queries | Needs a separately implemented search or live service |

Supported page-query keys are core `query-page` and `query-<id>-page`, `page`, `paged`, `p`, `page_id` and a bounded `lang` value. Other query parameters are reported for review. Tracking parameters are removed from normalized page identities.

For example, `/news/?query-7-page=2` maps to `/news/__query/<normalized-query-hash>/index.html`. `/news/?query-7-page=2&query-9-page=3` has a different identity from either loop state alone. Sorting parameter keys keeps equivalent states deterministic. Two loops with ten pages each can expose 100 combinations; the configured page limit applies to the resulting crawl.

The exporter follows real pagination links, rather than treating an engine's page-one render as proof that the rest works. Qualification must compare the expected post IDs on first, intermediate and last pages, as well as reload, direct navigation and browser back/forward behavior.

## Compatibility and remaining choices

| Feature | Current behavior or required alternative |
| --- | --- |
| Public theme layout, images, styles and fonts | Captures discovered same-source dependencies; destination browser checks establish whether the result is usable |
| CSS backgrounds, responsive images and lazy-image attributes | Discovers supported HTML attributes, CSS URLs and import references; unusual plugin attributes still need review |
| JavaScript modules and import maps | Copies supported static dependencies and rewrites captured references; dynamically constructed URLs and unusual module loaders need destination testing |
| Menus, accordions, sliders, tabs and lightboxes | Can work when their scripts are self-contained; compatibility findings do not establish interaction success |
| Forms and comments | Forms are disabled in output and reported. Add a submission/comment service or omit the feature before publishing |
| Search | WordPress server search is not converted. A static search tool such as [Pagefind](https://pagefind.app/) is a possible separate integration |
| WordPress REST/AJAX, nonces and script fetches | Detects common references and reports runtime dependence; it does not emulate those endpoints |
| Accounts, memberships, private content, checkout and bookings | An authenticated or transactional backend is still required; this exporter serves public snapshots |
| External videos, maps, fonts, analytics and other services | Retains external references and reports them. The ZIP is not necessarily an offline package |
| Source redirects | Follows permitted redirects within the selected source and maps captured navigation to the final resource; it does not generate every host's redirect configuration |
| SEO and social metadata | Some mapped link URLs are rewritten. The destination domain, full metadata relocation, feeds and host response rules still require review |
| `<base href>` documents | Refused explicitly because their reference-resolution rules are not supported |
| Multilingual content | Can follow supported discovered URLs and `lang` states; no universal multilingual-plugin guarantee |
| Scheduled or time-sensitive content | Requires a new export when its public result should change; automated publication scheduling is not included |

The static preview deliberately blocks external services, nested frames and generated workers, and its script context cannot access Zoer's origin credentials or storage. WordPress's emoji checks fall back without a worker in this preview, producing expected CSP console messages. It is useful for checking saved pages and local dependencies. An iframe module or approved external integration must also be tested on the actual receiving website. Preview isolation does not add a restrictive policy to the downloaded ZIP.

The UI reports actual sampled pages, discovered candidates, captured pages/assets, bytes, ZIP size, status and findings. Sampled results describe only checked pages; interaction compatibility requires browser acceptance. A familiar theme or plugin name is not a compatibility verdict.

## Reusing the output elsewhere

### Another static website host

Download and extract the ZIP into the destination's public directory. Portable links support a different folder without choosing that folder during export. Fixed destination links require the configured path. Confirm that the receiving server serves directory indexes, handles deep links, uses the desired domain and provides any required 404 and redirect rules.

Zoer's existing [repository deployment workflow](https://github.com/ahzs645/zoer/blob/main/docs/repository-deployments.md) uses committed Git source and currently limits static releases to **20 MiB and 2,000 files**. A WordPress export does not automatically become one of those releases. Larger exports produce a compatibility finding and remain downloadable for another host.

### A selected page inside another WordPress site

The existing [Zoer Content Modules](../../wordpress-plugins/zoer-content-modules/README.md) plugin imports a trusted self-contained HTML ZIP and inserts it with its Content Module block. A selected-page export using portable links is the relevant format, but the package must pass that importer's policy and real player checks before it is described as qualified for reuse.

The importer allows a 256 MiB ZIP, 1 GiB expanded content and 5,000 entries. The exporter can collect more than 5,000 total files when pages and assets are combined, so its own limits do not establish importer acceptance. Imported scripts run on the receiving WordPress origin under the current Content Modules model; trusted-content requirements still apply. Frames also need usable sizing, keyboard navigation and working internal links. This does not add LMS accounts, scores or completion tracking.

### Content for another design or framework

The current ZIP preserves rendered website output. It does not produce native editable Gutenberg blocks, React components, Astro templates, Markdown collections or a structured JSON content bundle.

A future content mode should allowlist public fields, preserve stable source IDs, slugs, dates, taxonomies, media references and alt text, and implement a known set of destination components. WordPress REST readers must retrieve every page of data: [the API caps `per_page` at 100 and supplies total-page headers](https://developer.wordpress.org/rest-api/using-the-rest-api/pagination/). The existing WordPress transfer and site-stack workflows remain the route for native WordPress content and code reuse.

## Existing projects and reference approaches

These projects informed the option comparison. None is installed or required by the native Zoer exporter.

| Project | Implemented approach | Where it is useful |
| --- | --- | --- |
| [Simply Static](https://github.com/Simply-Static/simply-static) | Crawls WordPress into a ZIP or directory, with URL replacement modes | Preserving a rendered site through an established WordPress plugin; its [documented CLI automation requires Pro](https://docs.simplystatic.com/article/51-working-with-wp-cli) |
| [Staatic](https://wordpress.org/plugins/staatic/) and [official source](https://plugins.svn.wordpress.org/staatic/) | Publication workflow, static crawling, output/deployment methods and a community CLI | A separate exporter option; its [CLI](https://staatic.com/documentation/administrator-guide/wp-cli/publish-command/) includes build-without-deployment behavior |
| [WP2Static](https://github.com/elementor/wp2static) | Separate discovery, crawling and deployment components | Reference for explicit route enumeration, including its [archive-pagination detector](https://github.com/elementor/wp2static/blob/f06790a5e65c73a7f3cc293f5652004dd21d3796/src/DetectPostsPaginationURLs.php) |
| [Static Site Exporter](https://github.com/benbalter/wordpress-static-site-exporter) | WordPress-side Markdown/YAML output with rendering filters | Content migration into Jekyll, Hugo or similar generators; broad settings/meta export needs filtering before public reuse |
| [wordpress-export-to-markdown](https://github.com/lonekorean/wordpress-export-to-markdown) | WXR conversion, front matter, image download and reference updates | A one-time content migration using a WordPress content export; drafts need explicit handling |
| [WordPress to Hugo Exporter](https://github.com/SchumacherFM/wordpress-to-hugo-exporter) | Markdown/YAML export and a CLI pathway | Another content-migration example, with the same need to filter public fields |
| [Astro's WordPress example](https://docs.astro.build/en/guides/cms/wordpress/) | REST content fetches and generated routes | A separately implemented headless/static frontend |
| [Next.js static export](https://nextjs.org/docs/app/guides/static-exports) | Static files generated by `output: 'export'` | An existing React frontend designed for static output; runtime server features need alternatives |

Simply Static's inspected [URL filter](https://github.com/Simply-Static/simply-static/blob/e82da81c7571948bd1031130a4dfaec977db01ce/src/class-ss-util.php#L878) can exclude non-asset query URLs when search/results output is disabled. Its [query-file handling](https://github.com/Simply-Static/simply-static/blob/e82da81c7571948bd1031130a4dfaec977db01ce/src/class-ss-url-fetcher.php#L502) also gates output and uses hashed directories. That is a concrete reason to test custom loop states instead of assuming an exporter preserves them.

A generic HTTP mirror is an alternative for reachable public pages when WordPress access is unavailable. A browser-rendered crawl can discover more JavaScript activity, but neither approach reproduces a missing server. WordPress's [Tools Export](https://wordpress.org/documentation/article/tools-export-screen/) produces WXR XML for content migration rather than a deployable static website.

## Host integration and storage

The [plugin UI](../../src/components/extensions/StaticWebsiteExport.tsx) uses scoped WordPress host routes. The matching host implements `zoer-static-crawler-v1`, fixed-source DDEV HTTP transport, resumable per-resource checkpoints, catalog job records, sealed file sets, integrity-checked ZIP downloads and expiring preview capabilities. The plugin's existing `workspace:wordpress` permission covers these routes; a new generic network or operator capability is not added.

Source HTML and dependencies are read anonymously through the selected managed computer. Trusted WordPress `home` and `siteurl` values identify that computer's address aliases. Rendering uses WordPress's actual public output, including its theme and saved Site Editor state. The pipeline does not change saved loop settings, theme files or source URLs, and does not call the source-mutating portable-URLs command.

Exports keep job metadata in the existing catalog and artifact bytes in file sets. They do not create a separate application database. A future destination application that needs persistent records must still follow Zoer's explicit project-database setup. Detailed reports, raw working resources and configuration do not belong in the public ZIP. Completion and deletion read back the corresponding saved artifact/record state.

## Qualification and remaining checks

All builds, dependency installs and tests ran on the remote development server. The real platform has the matching backend and an enabled WordPress Manager development build. Remote verification passed 466 plugin tests, 25 backend tests and a final 33-check lifecycle regression. Earlier API acceptance covered 57 cases; live testing found and fixed an emoji-loader dependency and a race when deleting terminal jobs during cleanup.

Downloaded relative and `/resources/` packages passed all nine combinations of two independent three-page Query Loops at desktop and phone widths. Enhanced pagination passed all three result pages. These checks blocked every network origin except the extracted static files and verified modules, nested CSS, responsive images, menus, direct navigation, reload and history. A clean two-page selected export also passed independently.

The real UI passed configure/validation, preflight, build, cancel, retry, reload, download, preview navigation and deletion. Layout checks passed at 1440 pixels, 390 pixels, 320 pixels and a short 390×430 viewport. The actual browser-downloaded ZIP matched its saved digest. Temporary content was removed and the original post hashes and selected settings matched the baseline.

Two test-source constraints remain explicit. Its sitemap advertises `/category/uncategorized/`, which returns HTTP 404, so a whole-site export correctly stops instead of claiming success. A live stop-site check was refused by the platform's intentional protection of four historical `outcome_unknown` transfer workflows bound to the reused test-site ID. Those records were preserved and the site was left running; completed source-independent ZIP checks establish portability, while live stopped-site UI acceptance remains unverified. Source content/settings and workflow history were not changed to bypass either condition.

The following remains the acceptance checklist for other themes, sites and destinations; Content Modules import and automatic publishing are not qualified by the static-server tests:

- Exercise the WordPress Manager flow on an authorized DDEV test site: configure, inspect, build, refresh, cancel, retry, preview, download and delete.
- Verify query results on first, intermediate, last and combined loop states, including direct navigation and browser history. Compare post identifiers rather than only page titles.
- Serve the extracted portable ZIP at an unrelated root and nested path with source access blocked. Check images, backgrounds, responsive assets, CSS, fonts, script modules and import maps.
- Confirm source-relative and selected-page navigation, permitted redirects, fixed destination paths and cap failures. A failed or cancelled build must leave prior successful exports usable.
- Verify source Stop and idle behavior during export, recovery after interrupted backend work, download integrity, saved-export access while stopped and removal of retained export files.
- Inspect preview isolation, invalid paths, private endpoint exclusions and compatibility findings. Exercise external-service behavior separately on the receiving host.
- Import a portable selected-page package into Content Modules before calling that destination qualified. Check the public page, frame dimensions, keyboard access and interactions.

Dated qualification receipts belong in Zoer's `output/ui-audit/` with the runtime/build identifiers and unresolved checks. The README should describe only the supported user surface and its actual qualification status.
