# Publish WordPress code updates

Use **Code updates — keep live data** to publish selected theme or plugin files
from an existing local DDEV build to a paired Zoer Connect website. This mode
keeps the destination database, uploaded media, must-use plugins, server
configuration and unselected extensions. It uses the running site's saved files;
a Git commit or repository push is not required.

## Interface workflow

1. Open the local site in WordPress Manager. Choose **Site actions → Publish
   local changes**, select the existing connected destination and continue to Push.
2. Keep **Publish mode → Code updates — keep live data** selected. In **Export a
   local DDEV site**, select only the themes/plugins to update. Disable an unused
   category. In particular, leave authentication and security integrations
   unselected when their existing live code should remain unchanged.
3. Choose **Prepare local export**. When ready, choose that verified export as
   the source. A previous export containing database or media cannot be used in
   code mode; prepare a new export instead. If the source export limit is reached,
   choose **Release source staging** beside a completed local export in the same
   panel. This removes only its temporary bridge copy, after checking the Zoer
   download is sealed. The verified download and its catalog record stay usable.
4. Choose **Compare with this site**. Review new/changed paths and clear anything
   that should remain live. Files missing from the source are not deleted.
   Hidden development files, dependencies under `node_modules`, database files,
   backup archives and environment resources cannot be selected in this mode.
   Compiled `dist` assets and PHP `vendor` dependencies remain eligible.
5. Confirm the destination and the existing writer policy. Run the dry run first.
   The worker checks the sealed selected code for the source hostname, absolute
   source path and known credential literal patterns. It stops with the path and
   problem category without exposing the matching credential. Fix portable code
   in the source, then export and compare again; it does not rewrite code silently.
6. Clear **Dry run**, request the same reviewed selection and approve the ordinary
   Zoer action. Staging stops for review before activation. Review the staged
   result, then choose **Approve and activate**. WordPress pauses visitors during
   activation and the verification checkpoint, so an ordinary public preview
   cannot load until you choose **Finish and reopen site**. Backups remain after
   Finish. Check important pages, sign-in, session refresh and logout on the
   reopened website. Use **Roll back** if verification fails, retaining the
   recovery record until the site is confirmed working.

The destination must support file comparison, staged review and late activation.
The mode refuses older capabilities rather than weakening its review. Comparison
expiry, changed destination hashes, changed endpoint generations, site locks and
the connector's private storage/recovery rules still apply. A full-site hosting
replacement is a different workflow and does not inherit these code-only limits.

Local files-only exports require a Zoer DDEV connector whose `export.create.v1`
schema accepts `database: false`. The bridge already supports this selection;
older host schemas accepted only database filter objects and must be updated.
Do not enable a database export to work around that limitation.

Inventory and connection checks run as bounded one-step jobs with a local-site
or endpoint lock. They retain the existing read permissions and do not reserve
the entire dispatcher behind unrelated browser work. Cancelled checks make no
new host call. An inventory failure appears beside the export choices with a
**Retry local inventory** action.

## Saved content and current live data

Saved pages, block templates, reusable blocks, navigation and global styles are
database records. Code publication does not copy them. Review any desired design
content separately; do not replace entire posts/options tables to move a design.

A database-only live-to-local refresh can retain local development code, local
settings and matching saved designs for testing. That refreshed database still
contains intentional local differences and does not become safe to upload back
wholesale. Publish code while leaving the current live database in place, so
registrations and other writes since the snapshot remain live.

Updating code can itself trigger plugin schema migrations or theme content
initializers. Review and test those behaviors before production publication.
Keeping authentication files/settings alone is not proof of compatible login;
theme links, portal hooks and role behavior also need verification.

## Coverage

Worker tests cover source restrictions, unsafe path rejection, a no-write dry run,
source hostname detection across read boundaries, bounded resumable content
checks, rejection of missing comparisons and disabled review, and staged code
publication with unrelated media/auth files preserved. Source text is not saved
in preflight checkpoints. The scan detects specific literal patterns; it is not
a general secret scanner or malware qualification.

Record deployment versions and real-browser transfer evidence in dated audit
notes. Unit fixtures and a package build do not establish a production transfer.
