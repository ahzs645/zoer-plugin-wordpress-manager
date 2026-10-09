import { radioClass } from "@zoer/plugin-ui/controls";
import { TransferPanel } from "../wordpressTransfer/TransferPanel";

/** `copy.local` / `backup.restore-local` input `users`. */
export type LocalUserMode = "local" | "source" | "exact";
export type LocalImportKind = "copy" | "hostinger" | "updraft";

const LOCAL = "https://<local site>";

/**
 * The URL rules the local importer applies (plugin/computer/wordpress/LocalCopyRules.php urlPairs),
 * for display: both schemes, protocol-relative, JSON-escaped and URL-encoded spellings.
 */
export function localUrlRules(sourceUrl: string | null | undefined): { find: string; replace: string; note: string }[] {
  const source = (sourceUrl ?? "").replace(/\/+$/, "");
  const known = /^https?:\/\/(\S+)$/.exec(source)?.[1];
  const rest = known ?? "<source address>";
  const local = LOCAL.slice("https://".length);
  return [
    { find: `https://${rest}`, replace: LOCAL, note: "Address" },
    { find: `http://${rest}`, replace: LOCAL, note: "Address over HTTP" },
    { find: `//${rest}`, replace: `//${local}`, note: "Protocol-relative" },
    { find: `https:\\/\\/${rest.replaceAll("/", "\\/")}`, replace: LOCAL.replaceAll("/", "\\/"), note: "JSON-escaped" },
    // The placeholders stay readable; the real addresses are encoded whole.
    { find: known ? encodeURIComponent(`https://${rest}`) : `${encodeURIComponent("https://")}${rest}`, replace: `${encodeURIComponent("https://")}${local}`, note: "URL-encoded" },
  ];
}

export function usersSummary(users: LocalUserMode) {
  return users === "source" ? "All tables · users and user meta copied with their IDs"
    : users === "exact" ? "All tables · exactly the source's users, no extra administrator"
      : "All tables except users · posts assigned to the local administrator";
}

const FILES: Record<LocalImportKind, { summary: string; included: string; omitted: string }> = {
  copy: { summary: "Themes, plugins and media", included: "Themes, plugins and media uploads from a complete pull, checked against their SHA-256 digests.", omitted: "WordPress core, wp-config.php, must-use plugins and drop-ins stay the local site's own. Executable files in uploads are refused." },
  hostinger: { summary: "wp-content from the website archive", included: "Themes, plugins, uploads and other wp-content folders from the single WordPress root in the archive.", omitted: "Core, wp-config.php, server configuration, hidden files, caches, drop-ins, must-use plugins, Zoer Connect and archived backup folders are omitted." },
  updraft: { summary: "Plugins, themes, uploads and others", included: "The four UpdraftPlus file archives, member by member.", omitted: "Caches, drop-ins, must-use plugins, UpdraftPlus folders and .htaccess files are omitted. The site uses its installed WordPress core." },
};

function Choice({ name, value, checked, onChange, disabled, title, description }: { name: string; value: LocalUserMode; checked: boolean; onChange: (value: LocalUserMode) => void; disabled?: boolean; title: string; description: string }) {
  return <label className={`flex min-h-11 items-start gap-2.5 rounded-md border px-3 py-2.5 text-[13px] ${checked ? "border-accent bg-surface-hover" : "border-border-default"}`}>
    <input type="radio" name={name} value={value} className={`${radioClass} mt-0.5`} checked={checked} disabled={disabled} onChange={() => onChange(value)} />
    <span className="min-w-0"><span className="block text-text-primary">{title}</span><span className="block text-[12px] text-text-muted">{description}</span></span>
  </label>;
}

/**
 * WP Migrate-style settings of a local copy or backup restore: one collapsible panel per concern,
 * each with a one-line summary. Only the user accounts are a choice; the other panels show the
 * rules the reviewed import scripts always apply.
 */
export default function LocalImportPanels({ id, kind, users, onUsers, sourceUrl, disabled = false }: {
  id: string; kind: LocalImportKind; users: LocalUserMode; onUsers: (value: LocalUserMode) => void; sourceUrl?: string | null; disabled?: boolean;
}) {
  const files = FILES[kind];
  const rules = localUrlRules(sourceUrl);
  const from = kind === "copy" ? "source site" : "backup";
  return <div className="min-w-0 space-y-2">
    <TransferPanel title="Database" summary={usersSummary(users)} defaultOpen>
      <fieldset className="min-w-0 space-y-2" disabled={disabled}>
        <legend className="mb-1 text-xs font-medium text-text-secondary">User accounts</legend>
        <Choice name={`local-users-${id}`} value="local" checked={users === "local"} onChange={onUsers} title="Keep only the local administrator"
          description={`The ${from}'s users are not copied. Posts and pages are assigned to the local administrator and comments are kept without accounts. Good for content-only copies.`} />
        <Choice name={`local-users-${id}`} value="source" checked={users === "source"} onChange={onUsers} title="Copy users and user metadata"
          description={`Keeps user IDs, roles, profiles and plugin user data, such as membership or sign-in links, so authors and accounts match the ${from}. Users keep their passwords; login sessions and application passwords are removed.`} />
        <Choice name={`local-users-${id}`} value="exact" checked={users === "exact"} onChange={onUsers} title={`Replace with the ${from}'s users exactly`}
          description={`Like WP Migrate: the copy has exactly the ${from}'s accounts and no extra local administrator, so you sign in with the ${from}'s logins.`} />
      </fieldset>
      {users === "source" && <p className="text-xs text-text-secondary">The local administrator is added beside the copied accounts (with a new ID or login if the {from} already uses its own). Capability keys and roles move to this site's table prefix. Zoer's Admin button keeps working.</p>}
      {users === "exact" && <p className="text-xs text-text-secondary">Zoer's Admin button then signs in as the {from}'s “admin” account, or as its only administrator. If neither exists, the import stops before anything is replaced and asks you to keep the local administrator. Capability keys and roles move to this site's table prefix; sessions and application passwords are removed.</p>}
      <p className="text-xs text-text-secondary">Always: every table with the {from}'s prefix is imported into staged tables and swapped in at once. Transients are dropped; this site's address, admin e-mail and scheduled tasks are kept.</p>
    </TransferPanel>
    <TransferPanel title="Find & Replace" summary={`${rules.length} automatic URL rules · ${kind === "copy" ? "source" : "backup"} address → local address`}>
      <div className="min-w-0 rounded-md border border-border-muted text-xs" role="table" aria-label="Automatic URL rules">
        <div role="row" className="hidden bg-surface-primary/50 text-text-secondary sm:grid sm:grid-cols-[1fr_1fr_8rem]"><span role="columnheader" className="px-3 py-2 font-medium">Find</span><span role="columnheader" className="px-3 py-2 font-medium">Replace</span><span role="columnheader" className="px-3 py-2 font-medium">Form</span></div>
        {rules.map((rule, index) => <div role="row" key={rule.note} className={`grid min-w-0 grid-cols-1 border-border-muted px-3 py-2 sm:grid-cols-[1fr_1fr_8rem] sm:border-t sm:px-0 sm:py-0 ${index ? "border-t" : ""}`}>
          <span role="cell" className="min-w-0 break-all font-mono sm:px-3 sm:py-1.5">{rule.find}</span>
          <span role="cell" className="min-w-0 break-all font-mono sm:px-3 sm:py-1.5"><span className="text-text-secondary sm:hidden" aria-hidden="true">→ </span>{rule.replace}</span>
          <span role="cell" className="text-text-secondary sm:px-3 sm:py-1.5">{rule.note}</span>
        </div>)}
      </div>
      <p className="text-xs text-text-secondary">Applied in one pass, longest match first, including inside serialized and JSON data, so a replaced address is never rewritten twice. {kind === "copy" ? "" : "The backup's address is read from its database. "}Post GUIDs are left unchanged.</p>
    </TransferPanel>
    <TransferPanel title="Files" summary={files.summary}>
      <p className="text-xs text-text-secondary"><span className="font-medium text-text-primary">Included:</span> {files.included}</p>
      <p className="text-xs text-text-secondary"><span className="font-medium text-text-primary">Left out:</span> {files.omitted}</p>
    </TransferPanel>
    <TransferPanel title="After the import" summary="Plugins inactive · mail and outgoing HTTP blocked · search engines discouraged">
      <ul className="list-disc space-y-1 pl-5 text-xs text-text-secondary">
        <li>Every plugin starts inactive, so payment, mail and integration jobs cannot run on their own. Activate what you need.</li>
        <li>Outgoing e-mail and HTTP requests stay blocked and WordPress cron is disabled on the local site.</li>
        <li>“Discourage search engines” is turned on, because the local site has its own reachable address.</li>
        <li>Permalinks are rebuilt with the {kind === "copy" ? "copied" : "restored"} theme loaded, then the site must answer over HTTPS before the {kind === "copy" ? "copy" : "restore"} is marked ready.</li>
      </ul>
    </TransferPanel>
  </div>;
}
