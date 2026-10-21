import { useState } from "react";
import { AlertTriangle, PlugZap, RefreshCw, Trash2 } from "lucide-react";
import { Btn } from "@zoer/plugin-ui/controls";
import type { WordPressManagedSite } from "../../lib/api";
import { api } from "../../lib/api";
import { json } from "../../lib/api/_http";
import { checkedAgo, type ConnectionProblem } from "./connectionHealth";

const host = (site: WordPressManagedSite) => (site.managedUrl || site.url || site.domain || "").replace(/^https?:\/\//, "").replace(/\/+$/, "");

/**
 * A saved Zoer Connect connection that stopped working: the website no longer answers (deleted or moved), or it
 * rejects the saved key (a new key was generated in WordPress). Offers the way out for each.
 */
export default function ConnectionProblemCard({ site, connectorId, hostingerId, problem, copies, checking, onRecheck, onMoveCopies, onReplaceKey, onRemoved }: {
  site: WordPressManagedSite; /** The Zoer Connect connection's site ID. */ connectorId: string; /** The Hostinger website it belongs to, when there is one. */ hostingerId: string | null;
  problem: ConnectionProblem; copies: WordPressManagedSite[]; checking: boolean; onRecheck: () => void; onMoveCopies: () => void; /** Opens the connection dialog to paste new connection info. */ onReplaceKey: () => void; onRemoved: () => void;
}) {
  const [busy, setBusy] = useState<"connect" | "remove" | null>(null);
  const [confirmRemove, setConfirmRemove] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const act = async (kind: "connect" | "remove", work: () => Promise<unknown>, done: () => void) => {
    setBusy(kind); setError(null);
    try { await work(); done(); } catch (caught) { setError(caught instanceof Error ? caught.message : "That did not work."); } finally { setBusy(null); }
  };
  const gone = problem.kind === "unreachable";
  return <section role="alert" className="space-y-3 rounded-lg border border-status-warning/30 bg-status-warning/5 p-4">
    <h4 className="flex items-center gap-2 text-sm font-semibold text-status-warning"><AlertTriangle className="h-4 w-4 shrink-0" aria-hidden="true" />{gone ? `${host(site)} isn't answering` : `${host(site)} rejected Zoer's key`}</h4>
    <p className="text-sm text-text-secondary">{gone
      ? `Zoer could not reach Zoer Connect on this website (checked ${checkedAgo(problem.checkedAt)}). If the website was deleted or moved to another address, move its local copies to the site that replaced it, then remove this connection.`
      : `A new connection key was probably generated in WordPress (checked ${checkedAgo(problem.checkedAt)}). Push and pull need the new key.`}</p>
    <div className="flex flex-wrap gap-2">
      {!gone && hostingerId && <Btn variant="primary" icon={<PlugZap className="h-4 w-4" />} loading={busy === "connect"} disabled={busy !== null} onClick={() => void act("connect", () => api.connectHostingerZoerConnect(hostingerId, true), onRecheck)}>Connect automatically</Btn>}
      {!gone && <Btn variant={hostingerId ? "secondary" : "primary"} disabled={busy !== null} onClick={onReplaceKey}>Paste new connection info</Btn>}
      {gone && copies.length > 0 && <Btn variant="primary" disabled={busy !== null} onClick={onMoveCopies}>{copies.length === 1 ? `Move ${copies[0]!.name} to another site` : `Move ${copies.length} local copies`}</Btn>}
      {gone && !confirmRemove && <Btn icon={<Trash2 className="h-4 w-4" />} disabled={busy !== null} onClick={() => setConfirmRemove(true)}>Remove this connection</Btn>}
      {gone && confirmRemove && <Btn variant="danger" loading={busy === "remove"} disabled={busy !== null} onClick={() => void act("remove", () => json(`/wordpress-manager/connect/${encodeURIComponent(connectorId)}`, { method: "DELETE" }), onRemoved)}>Remove {site.name} from Zoer</Btn>}
      <Btn variant="ghost" icon={<RefreshCw className="h-4 w-4" />} loading={checking} disabled={busy !== null} onClick={onRecheck}>Check again</Btn>
    </div>
    {gone && confirmRemove && <p className="text-xs text-text-secondary">This removes only Zoer's saved connection and key. Local copies stay; their transfer history stays in Activity.{copies.length > 0 ? " Move the local copies first so they keep a live site." : ""}</p>}
    {error && <p className="text-sm text-status-error">{error}</p>}
  </section>;
}
