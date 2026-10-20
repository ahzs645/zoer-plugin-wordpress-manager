import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { CheckCircle2, Loader2, PlugZap } from "lucide-react";
import { Btn } from "@zoer/plugin-ui/controls";
import { api } from "../../lib/api";
import { wordpressKeys, wordpressQueries } from "../../lib/queries/wordpress";

/**
 * A Hostinger website without a Zoer connection: whether Zoer Connect is installed there (checked every few minutes),
 * and Connect automatically, which signs in through Hostinger, creates the connection key and turns on Pull.
 */
export default function HostingerZoerConnect({ siteId, onConnected }: { siteId: string; onConnected: () => void }) {
  const client = useQueryClient();
  const check = useQuery(wordpressQueries.zoerConnectCheck([siteId]));
  const [busy, setBusy] = useState<"connect" | "check" | null>(null);
  const [error, setError] = useState<string | null>(null);
  const found = check.data?.find(item => item.siteId === siteId);
  const recheck = async () => {
    setBusy("check"); setError(null);
    try { client.setQueryData(wordpressQueries.zoerConnectCheck([siteId]).queryKey, (await api.checkHostingerZoerConnect([siteId], true)).checks); }
    catch (caught) { setError(caught instanceof Error ? caught.message : "Zoer could not check this site."); }
    finally { setBusy(null); }
  };
  const connect = async () => {
    setBusy("connect"); setError(null);
    try {
      await api.connectHostingerZoerConnect(siteId, true);
      await Promise.all([client.invalidateQueries({ queryKey: wordpressQueries.endpoints().queryKey }), client.invalidateQueries({ queryKey: wordpressKeys.all() })]);
      onConnected();
    } catch (caught) { setError(caught instanceof Error ? caught.message : "Zoer could not connect this site."); }
    finally { setBusy(null); }
  };
  if (check.isLoading) return <p className="flex items-center gap-2 text-sm text-text-secondary"><Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />Checking whether Zoer Connect is installed…</p>;
  return <div className="space-y-2 rounded-lg border border-border-default p-3" aria-live="polite">
    {found?.installed ? <>
      <p className="flex items-center gap-2 font-medium text-text-primary"><CheckCircle2 className="h-4 w-4 shrink-0 text-status-success" aria-hidden="true" />Zoer Connect is installed on {found.domain}</p>
      <p className="text-sm text-text-secondary">Zoer can connect it for you: it signs in through your Hostinger account, creates a new connection key and turns on Pull. A key made earlier for this site stops working.</p>
      <Btn variant="primary" icon={<PlugZap className="h-4 w-4" />} loading={busy === "connect"} disabled={busy !== null} onClick={() => void connect()}>Connect automatically</Btn>
    </> : <>
      <p className="font-medium text-text-primary">Zoer Connect isn't active on {found?.domain ?? "this site"} yet</p>
      <p className="text-sm text-text-secondary">Install and activate it in WordPress (steps below). Zoer checks again every few minutes and offers to connect it once it answers.</p>
      <Btn size="sm" loading={busy === "check"} disabled={busy !== null} onClick={() => void recheck()}>Check again</Btn>
    </>}
    {(error || check.error) && <p role="alert" className="text-sm text-status-error">{error ?? (check.error instanceof Error ? check.error.message : "Zoer could not check this site.")}</p>}
  </div>;
}
