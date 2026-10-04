> Moved from the Zoer repository (`docs/`) with the Zoer Connect submodule (Zoer `docs/plugin-shared-services.md` section 16.3). `wordpress-plugins/zoer-connect/` now refers to this repository's submodule; other repository paths (`backend/...`, `frontend/...`, `docs/...`, `output/...`) still refer to the Zoer checkout.

> Historical handoff: superseded by the September 8, 2026 qualification and successful SparkLab publication in Zoer's local, untracked `output/ui-audit/2026-09-08-zoer-connect-032/`. Current capabilities and compatibility limits are in the [plugin README](../wordpress-plugins/zoer-connect/README.md). The historical status below is not the current deployment state.

# Zoer Connect implementation and testing handoff

Recorded September 8, 2026. This is a status and acceptance-criteria document, not evidence that migration is ready or permission to circumvent a tool restriction.

## User objective and approvals

The user wants a native WordPress connector for Zoer: edit and test a local DDEV site, then transfer selected resources or a complete site through WordPress without enabling Hostinger SSH. Remote Pull is the immediate unfinished feature; eventual local-to-live Push is also desired.

Explicit approvals in the conversation:

- Implement the connector as an independent nested repository that builds a WordPress plugin ZIP.
- Use subagents for implementation and testing.
- Use the existing disposable `zoer-connect-transfer-peer` as the local import destination. The user selected this instead of creating another site.
- The user requested a future live SparkLab plugin update/test and previously authorized publishing local SparkLab to `https://sparklab.unbc.ca/`, including accepting an unverified current-live backup. Those requests are recorded, but no publication occurred in this work and they do not establish technical readiness.
- The user does not want Hostinger SSH enabled.
- The user requested this handoff and emphasized that implementation/testing had already been approved.

Avoid asking the user to repeat these approvals. However, approval is not a substitute for resolving tool restrictions or passing release checks. The local test must not replace original local SparkLab or live SparkLab.

## Unresolved execution block

Automatic safety review rejected plugin-export and local-copy subagent tasks with the exact reason: **“Potentially unintended activity.”** A narrowed code-only plugin task was also rejected. No more specific cause was provided.

The current agent stopped that implementation and did not run remote export or destination import. Later work was limited to presentation changes and read-only review. Do not treat this document as a cleared approval review, conceal the rejection, or route the same blocked operation through another agent/tool to evade it. Any continuation must respect the active system/tool restrictions and resolve the block through an authorized mechanism. The criteria below describe outstanding work, not a workaround.

## Repository and environment

- Root: `/Users/ahmadjalil/github/zoer`.
- Plugin: `wordpress-plugins/zoer-connect`, with its own Git repository. Preserve both repositories' unrelated dirty changes; inspect status before edits. Do not blanket-reset, clean, or stage.
- Reference requested by the user: `/Users/ahmadjalil/Downloads/wp-migrate-db-pro 2`. Use as a behavior/workflow reference; do not copy proprietary implementation or credentials.
- Read root `AGENTS.md`, `docs/agent-development.md`, README, and for frontend work `frontend/AGENTS.md` plus `frontend/src/components/ui/README.md`.
- Read the homelab memory file identified in AGENTS before deployment-specific changes.
- Real Zoer development backend: `https://zoer.k8s.ahmad.sh`. Follow the existing server-dev runbook; do not start a fake backend or fresh Convex stack.
- Disposable source/security fixture: `zoer-connect-security-test`; disposable import destination: `zoer-connect-transfer-peer`.
- Public managed DDEV domains follow `https://<site>.wp.k8s.ahmad.sh`. Earlier checks found an admin redirect loop and stripped authorization headers on that bridge. Reverify current behavior; do not weaken HTTPS/authentication checks to bypass it.
- Live site: `https://sparklab.unbc.ca/`. User reported a successful saved connection with plugin 0.2.0. Do not expose the saved key or copy it into this document/logs.

## Actual implementation status

The last verified plugin artifact is `wordpress-plugins/zoer-connect/dist/zoer-connect-0.2.0.zip` with a SHA-256 sidecar. Version 0.2 provides connection keys and private staging; it is not a complete publisher. The user reported installing 0.2.0 on live SparkLab.

Unpublished partial source changes advertise 0.3.0 and add exports. Do not assume the source version means a release was built, installed, or validated. No 0.3 artifact was built/installed in this work. The README contains some stale integration statements; reconcile documentation against actual routes and verified behavior before release.

Relevant files:

| Area | Location | Status |
| --- | --- | --- |
| Connection field and saved state | `frontend/src/components/extensions/WordPressConnect.tsx` | Deployed: four-dot mask, in-field eye button, Replace key action |
| Manager integration | `frontend/src/components/extensions/WordPressManager.tsx` | Connection entry exists when plugin is active |
| Connection transport/storage | `backend/src/wordpress-connect.ts` | Existing connection flow; partial generalized export transport needs review |
| Download controller | `backend/src/wordpress-pull.ts` | Partial, not end-to-end verified |
| Pending Pull routes | `backend/src/routes/wordpress-pull-pending.ts` | Deliberately unmounted |
| Pull selection/progress UI | `frontend/src/components/extensions/WordPressPull.tsx` | Deliberately unmounted |
| Plugin REST registration | `wordpress-plugins/zoer-connect/includes/Plugin.php` | Unpublished export routes in working tree |
| Export snapshot/download | `wordpress-plugins/zoer-connect/includes/RemoteExport.php` | Partial source, unverified |
| Database snapshot | `wordpress-plugins/zoer-connect/includes/DatabaseExporter.php` | Partial source, unverified |
| Pairing administration | Plugin `includes/ConnectionAdmin.php`, `ConnectionKey.php` | Existing 0.2 pairing plus working-tree changes to review |

Internal helpers for file activation, table staging, settings preservation and coordinated recovery already exist. Their isolated tests are not proof that the authenticated end-to-end migration workflow works.

## Outstanding acceptance criteria

These checks are prerequisites for release if the execution block is resolved; do not mark them passed from code inspection alone.

### Remote export correctness and lifecycle

- Dedicated coverage for the new exporter and download controller; the existing Makefile test list does not explicitly include new remote-export/database-export suites.
- Explicit Pull permission, HTTPS, administrator ownership/capability checks, revocation/rotation and credential-generation isolation.
- Validate selected resources and exclusions, destination/source binding, traversal/symlink rejection, private storage and limits.
- Check repeated create requests, mismatched retry selections, interrupted preparation, missing/changed source files, partial chunks, checksums, expiration and cancellation.
- Review cleanup of expired jobs, temporary files after failures and concurrent requests.

### Database export

- Current partial implementation uses an InnoDB consistent snapshot, a 256 MiB bound and a 40-second application limit. It is synchronous; hosting/PHP timeouts can interrupt it before that limit.
- Validate stable batched row enumeration, complete snapshots, schema changes, mixed/unsupported engines and error cleanup.
- Verify data types, binary/Unicode content and SQL round trips on disposable fixtures.
- Review credential/session exclusions and destination administrator/connector preservation. Do not log or unnecessarily expose database contents.
- Test the selected URL/path replacement and related-record policy before describing filtered database transfer as supported.

### Zoer integration and destination import

- Selection, progress, cancellation, retry/resume and clear capability/version messaging must work through the actual UI and mounted authenticated API.
- Treat verified downloads as downloaded artifacts, not imported/published sites.
- Implement and verify the destination path against the approved disposable peer only, including preflight checks, destination binding and recovery.
- Preserve the peer's intended URL, login/administrator access and connector identity according to an explicit policy.
- Verify resource-by-resource selection; excluded resources must remain unchanged. Cover files and database, not only manifest hashes.
- Exercise lost responses, interrupted writes, repeated requests, failed activation, rollback and edits made after planning. Confirm failures leave an understandable recoverable state.
- Verify home page, representative records/assets, permalinks and administrator login after import and rollback.
- Mobile connection/transfer UI checks remain required; desktop field verification does not establish mobile transfer usability.

### Release evidence

- Run applicable isolated tests, frontend build/typecheck and backend typecheck following the runbook. Do not accidentally invoke packaging as evidence that unverified code is ready.
- Build a versioned deterministic ZIP and checksum only when the candidate is ready; inspect contents for credentials, unwanted files and version consistency.
- Record exact source revision/dirty state, plugin ZIP hash, test fixtures, test results and unresolved limitations.
- Separate local checks, deployment rollout, browser verification and actual migration receipts. Never report staging as publication.
- Before any live plugin update, establish that the candidate is backward-compatible with the saved 0.2 connection and that plugin replacement has a recovery path. Do not silently turn a plugin update into a site/database publication.

## Evidence already available

See `output/ui-audit/2026-09-08-zoer-connect-client/README.md` and `field-followup.md` for dated evidence and limitations.

The connection UI rollout was `dev-1788894220-f42822a-dirty`; both deployments reported success and health returned OK. This is historical evidence, not the current cluster state. Frontend build/typecheck and backend typecheck passed; connection tests passed (3 tests, 20 assertions). Desktop Chrome confirmed short and long dummy values mask to exactly four dots, the eye reveals the dummy value, and the dialog dismisses. No dummy key was submitted.

Earlier disposable engine tests covered selected resources and recovery, but remote Pull/import did not run during the blocked attempt. Neither SparkLab site was modified. Hostinger SSH remained disabled.

## Handoff discipline

Keep secrets out of prompts, logs, screenshots and Git. Earlier pasted third-party plugin HTML contained a real key; it is not an approved test credential. Use existing secure credential handling and never reproduce it.

No new agent has been started by this handoff. Report any remaining restriction candidly rather than treating user approval or this document as permission to bypass it.
