import { useEffect, useState } from "react";
import { Cloud } from "lucide-react";
import { Btn } from "@zoer/plugin-ui/controls";
import { controlClass } from "@zoer/plugin-ui/controls";
import { api, type HostingerConnectionPublic } from "../../lib/api";
import { hostConnections, type HostConnectionAccount } from "../../host/actions";

/** Bound Hostinger accounts whose websites WordPress Manager does not load yet. */
export function unloadedHostingerAccounts(accounts: readonly HostConnectionAccount[], connections: readonly Pick<HostingerConnectionPublic, "oauthConnectionId">[]) {
  const loaded = new Set(connections.map(connection => connection.oauthConnectionId).filter(Boolean));
  return accounts.filter(account => account.status === "connected" && !loaded.has(account.id));
}

/**
 * Hostinger sign-in through Zoer (S7a, `connections.connect { alias: "hostinger" }`): Zoer asks
 * for confirmation, runs the sign-in in its own browser and keeps the tokens. The account is then
 * loaded into WordPress Manager (`POST /wordpress-manager/connections/oauth`), which reads its
 * websites with the host-held token. Accounts already connected to WordPress Manager elsewhere
 * (for example in Zoer Settings) can be loaded the same way.
 */
export default function HostingerBrowserLogin({ name, setName, onConnected, connections = [] }: {
  name: string; setName: (name: string) => void; onConnected: () => void; connections?: readonly HostingerConnectionPublic[];
}) {
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [status, setStatus] = useState<string | null>(null);
  const [accounts, setAccounts] = useState<HostConnectionAccount[]>([]);

  const refreshAccounts = async () => {
    try {
      const { connections: aliases } = await hostConnections.list();
      setAccounts(aliases.find(entry => entry.alias === "hostinger")?.accounts ?? []);
    } catch { setAccounts([]); }
  };
  useEffect(() => { void refreshAccounts(); }, []);

  const load = async (connectionId: string, label?: string) => {
    setBusy(`load:${connectionId}`); setError(null);
    try {
      await api.adoptHostingerOAuthConnection(connectionId, label);
      setStatus("Hostinger connected. Your websites are ready to load.");
      onConnected();
    } catch (err) { setError(err instanceof Error ? err.message : "Unable to load this Hostinger account."); }
    finally { setBusy(null); void refreshAccounts(); }
  };

  const signIn = async () => {
    setBusy("sign-in"); setError(null); setStatus(null);
    try {
      const result = await hostConnections.connect("hostinger");
      if (!result.started) { setStatus("Sign-in cancelled."); return; }
      if (!result.connected || !result.connectionId) { setError("Hostinger sign-in could not finish. Try again, or use an API token under Advanced setup."); return; }
      await load(result.connectionId, name.trim() || undefined);
    } catch (err) { setError(err instanceof Error ? err.message : "Unable to start Hostinger sign-in."); }
    finally { setBusy(null); }
  };

  const pending = unloadedHostingerAccounts(accounts, connections);
  return <section className="mt-3 space-y-3 rounded-lg border border-border-default bg-surface-primary/40 p-3">
    <p className="text-[13px] text-text-secondary">Sign in through Zoer. Zoer opens its own browser for your usual login and MFA and keeps the connection; WordPress Manager never sees your password or tokens.</p>
    <div className="flex min-w-0 flex-col gap-2 sm:flex-row">
      <input aria-label="Hostinger connection name" className={`${controlClass("compact")} min-w-0 flex-1`} value={name} onChange={event => setName(event.target.value)} maxLength={80} placeholder="My Hostinger account" disabled={busy !== null} />
      <Btn size="sm" variant="primary" icon={<Cloud className="h-4 w-4" />} loading={busy === "sign-in"} disabled={busy !== null} onClick={() => void signIn()}>Sign in with Hostinger</Btn>
    </div>
    {pending.length > 0 && <div className="space-y-2">
      <p className="text-[13px] text-text-secondary">Connected to WordPress Manager in Zoer, not loaded here yet:</p>
      {pending.map(account => <div key={account.id} className="flex flex-wrap items-center justify-between gap-2 rounded-md border border-border-muted p-2 text-[13px]"><span>{account.label}</span><Btn size="sm" loading={busy === `load:${account.id}`} disabled={busy !== null} onClick={() => void load(account.id)}>Load websites</Btn></div>)}
    </div>}
    {status && <p role="status" className="text-[13px] text-text-secondary">{status}</p>}
    {error && <p role="alert" className="text-[13px] text-rose-300">{error}</p>}
  </section>;
}
