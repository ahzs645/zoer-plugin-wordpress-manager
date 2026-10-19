# Refresh live data while developing locally

Code and WordPress content have separate release paths. Git `main` contains theme
and plugin source. Pages, saved blocks, navigation, users and league records live
in WordPress's database. A database refresh replaces selected data; it is not a
three-way merge of changes made independently on both sites.

## Refresh an existing linked copy

Open the linked local copy and choose **Pull from live**, or open the live source
and choose **Pull** beside the copy. Both open the same **Pull from …** dialog with
the copy selected under **Into** (the same dialog **Make a local copy** opens, with
**A new local copy** selected).
Choose **Database only — keep development code and settings**. If starting from
an existing download, it must contain only `database.sql`, all database tables
and all post types. Otherwise the action makes a new database-only Pull.

The refresh takes a recovery backup before replacing anything. It retains the
destination's theme/plugin/media files and its entire options table: local URL,
active extensions, timezone, registration settings, integration credentials and
rewrite rules. Updated live settings are therefore not imported. Review any
intended settings changes separately. Source plugin activation does not change
local activation, and the existing local mail/cron/outgoing HTTP guard stays on.

Choose the account policy deliberately. **Copy users and user metadata** keeps
live user IDs and plugin relationships, removes imported WordPress sessions and
application passwords, and retains the local administrator. Keeping only the
local accounts is unsuitable when the imported plugin tables refer to live user
IDs. No replacement production credentials should be entered on the local site.

**Keep local pages and block content** retains local `page`, `wp_template`,
`wp_template_part`, `wp_navigation`, `wp_global_styles` and `wp_block` rows and
their post metadata (excluding editor locks). Each must still match the source's
post ID, type, slug and parent. The source author and GUID remain authoritative.
An identity mismatch, local-only design post or missing/colliding local attachment
stops cutover for reconciliation;
it never guesses which new source record a local ID refers to. Newly created
source design posts remain in the imported database. Source taxonomy records
remain authoritative; this is not a general merge of custom design relationships.

All other selected tables and league posts come from the source. Local fixture
records in those tables are replaced. Revisions come from the source, while the
pre-refresh recovery backup retains the previous local history. Retaining local
design also retains its content instead of newer live edits to those same pages;
compare both snapshots first when both sites have been edited.

The action stages tables and uses the existing atomic cutover and replay journal.
It records the scope, retained-design policy, recovery backup and database summary
in the local-copy receipt. It never invokes the file placement command for a
database-only refresh. A failed import retains its private stage for inspection
and retry; the backup is the recovery point if restoring the previous copy is
necessary. Check Site Health, administrator access, retained content and league
records after completion.

New live media is separate: copy needed uploads through a reviewed media-only
transfer. Database-only refresh does not download images automatically.

## Publish a tested change

1. Preserve local content and take a current live database snapshot for comparison.
2. Refresh the local data, keeping the development code and reviewed design content.
3. Test desktop/mobile layouts, editor blocks, administrator workflows and permissions.
4. Commit and merge tested source into each repository's `main` branch.
5. Back up production and deploy the selected theme/plugin code only. Keep the
   production database, which may have received new registrations or results since
   the development snapshot.
6. Apply any separately reviewed content/settings/schema migration using current
   production baselines. A local database must not be pushed wholesale to publish
   a design or plugin code update.

Credential rotation and incident investigation are separate release prerequisites
when a source has been compromised. Refreshing content neither rotates secrets
nor certifies a site clean. Keep database snapshots and participant data outside
Git and shared reports.
