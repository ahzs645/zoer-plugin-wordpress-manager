import { useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { KeyRound, RefreshCw } from "lucide-react";
import { Btn, controlClass } from "@zoer/plugin-ui/controls";
import { api, type HostingerConnectionPublic } from "../../lib/api";
import { hostConnections } from "../../host/actions";
import { wordpressKeys } from "../../lib/queries/wordpress";

/**
 * Re-authenticates one Hostinger connection without removing it: a new sign-in through Zoer's
 * isolated browser (a fresh browser every time), or a new API token for token connections.
 * Zoer checks that it is the same Hostinger account and keeps the connection's sites and
 * recovery points.
 */
export default function HostingerReconnect({ connection, size = "sm", onDone }: { connection: HostingerConnectionPublic; size?: "sm" | "md"; onDone?: (message: string) => void }) {
  const client = useQueryClient();
  const [busy, setBusy] = useState<"sign-in" | "token" | null>(null);
  const [tokenOpen, setTokenOpen] = useState(false);
  const [token, setToken] = useState("");
  const [error, setError] = useState("");
  const usesToken = connection.authMethod === "api-token";
  const finish = async (message: string) => {
    await client.invalidateQueries({ queryKey: wordpressKeys.all() });
    onDone?.(message);
  };
  async function signIn() {
    setBusy("sign-in"); setError("");
    try {
      const result = await hostConnections.connect("hostinger", connection.name);
      if (!result.started) return;
      if (!result.connected || !result.connectionId) throw new Error("The Hostinger sign-in did not finish. Try again.");
      await api.reconnectWordPressManagerConnection(connection.id, { oauthConnectionId: result.connectionId });
      await finish(`“${connection.name}” is reconnected.`);
    } catch (caught) { setError(caught instanceof Error ? caught.message : "Reconnect failed."); }
    finally { setBusy(null); }
  }
  async function saveToken(event: React.FormEvent) {
    event.preventDefault();
    setBusy("token"); setError("");
    try {
      await api.reconnectWordPressManagerConnection(connection.id, { token });
      setToken(""); setTokenOpen(false);
      await finish(`“${connection.name}” uses the new API token.`);
    } catch (caught) { setError(caught instanceof Error ? caught.message : "The token was not accepted."); }
    finally { setBusy(null); }
  }
  return <div className="min-w-0 space-y-2">
    <div className="flex flex-wrap gap-2">
      {!usesToken && <Btn size={size} variant="primary" icon={<RefreshCw className="h-3.5 w-3.5" />} loading={busy === "sign-in"} disabled={busy !== null} onClick={() => void signIn()}>Sign in again</Btn>}
      <Btn size={size} variant={usesToken ? "primary" : "ghost"} icon={<KeyRound className="h-3.5 w-3.5" />} disabled={busy !== null} onClick={() => setTokenOpen(open => !open)}>{usesToken ? "Enter a new API token" : "Use an API token instead"}</Btn>
    </div>
    {tokenOpen && <form onSubmit={saveToken} className="flex min-w-0 flex-col gap-2 sm:flex-row">
      <input aria-label={`New Hostinger API token for ${connection.name}`} type="password" autoComplete="new-password" className={controlClass("compact", "min-w-0 flex-1")} value={token} onChange={event => setToken(event.target.value)} placeholder="Hostinger API token" />
      <Btn size="sm" type="submit" variant="primary" loading={busy === "token"} disabled={busy !== null || token.trim().length < 20}>Save token</Btn>
    </form>}
    {error && <p role="alert" className="break-words text-xs text-status-error">{error}</p>}
  </div>;
}
