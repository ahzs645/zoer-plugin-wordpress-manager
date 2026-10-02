import { type BrowserProvider, BROWSER_PROVIDERS } from "@zoer/api-types";
import { useEffect, useRef, useState } from "react";
import { Cloud, Loader2, X } from "lucide-react";
import { api, type HostingerLoginStatus } from "../../lib/api";
import { ApiError } from "../../lib/api/_http";
import { Btn as Btn } from "@zoer/plugin-ui/controls";
import { Select as Select } from "@zoer/plugin-ui/controls";
import { ModalSurface as ModalSurface } from "@zoer/plugin-ui/controls";
import { ResourceBrowserView } from "@zoer/plugin-ui/workspace";
import { controlClass } from "@zoer/plugin-ui/controls";

const LOGIN_KEY = "zoer-hostinger-login";
const active = (status?: string) => ["starting", "pending", "connecting"].includes(status || "");

export default function HostingerBrowserLogin({ name, setName, onConnected }: {
  name: string; setName: (name: string) => void; onConnected: () => void;
}) {
  const [id, setId] = useState<string | null>(() => sessionStorage.getItem(LOGIN_KEY));
  const [login, setLogin] = useState<HostingerLoginStatus | null>(null);
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [browserProvider, setBrowserProvider] = useState<BrowserProvider>("steel");
  const [error, setError] = useState<string | null>(null);
  const heading = useRef<HTMLHeadingElement>(null);
  const connected = useRef(onConnected);
  connected.current = onConnected;

  useEffect(() => {
    if (!id) return;
    let disposed = false;
    let timer: ReturnType<typeof setTimeout>;
    const poll = async () => {
      try {
        const result = await api.getHostingerLogin(id);
        if (disposed) return;
        setLogin(result.login);
        setError(null);
        if (active(result.login.status)) timer = setTimeout(poll, 2000);
        else {
          sessionStorage.removeItem(LOGIN_KEY);
          setId(null);
          if (result.login.status === "connected") connected.current();
        }
      } catch (err) {
        if (disposed) return;
        setError(err instanceof Error ? err.message : "Unable to check Hostinger sign-in.");
        if (err instanceof ApiError && err.status === 410) {
          sessionStorage.removeItem(LOGIN_KEY); setId(null); setLogin(null); setOpen(false); return;
        }
        // Keep the saved attempt on transient network failure; reopening can resume.
        timer = setTimeout(poll, 5000);
      }
    };
    void poll();
    return () => { disposed = true; clearTimeout(timer); };
  }, [id]);

  const start = async () => {
    setBusy(true); setError(null);
    try {
      const viewport = window.innerWidth < 768 ? { width: window.innerWidth - 34, height: window.innerHeight * 0.9 - 260 } : undefined;
      const result = await api.startHostingerLogin(name || "My Hostinger account", viewport, browserProvider);
      sessionStorage.setItem(LOGIN_KEY, result.login.id);
      setLogin(result.login); setId(result.login.id); setOpen(true);
    } catch (err) { setError(err instanceof Error ? err.message : "Unable to start Hostinger sign-in."); }
    finally { setBusy(false); }
  };
  const cancel = async () => {
    if (!id) return;
    setBusy(true); setError(null);
    try {
      await api.cancelHostingerLogin(id);
      sessionStorage.removeItem(LOGIN_KEY); setId(null); setLogin(null); setOpen(false);
    } catch (err) { setError(err instanceof Error ? err.message : "Unable to cancel sign-in."); }
    finally { setBusy(false); }
  };
  return <section className="mt-3 space-y-3 rounded-lg border border-border-default bg-surface-primary/40 p-3">
    <p className="text-[13px] text-text-secondary">Sign in inside Zoer’s browser. Complete your usual login and MFA there; Zoer saves the connection securely.</p>
    <label className="block space-y-1 text-sm"><span>Sign-in browser</span><Select aria-label="Sign-in browser" value={login?.browserProvider && id ? login.browserProvider : browserProvider} onChange={event => setBrowserProvider(event.target.value as BrowserProvider)} disabled={Boolean(id) || busy}>{BROWSER_PROVIDERS.map(item => <option key={item.id} value={item.id}>{item.label}{item.experimental ? " · Experimental" : ""}</option>)}</Select></label>
    <div className="flex min-w-0 flex-col gap-2 sm:flex-row">
      <input aria-label="Browser login connection name" className={`${controlClass("compact")} min-w-0 flex-1`} value={name} onChange={event => setName(event.target.value)} maxLength={80} placeholder="My Hostinger account" disabled={Boolean(id)} />
      {id ? <><Btn size="sm" variant="primary" onClick={() => setOpen(true)}>Open sign-in browser</Btn><Btn size="sm" disabled={login?.status === "connecting"} loading={busy} onClick={() => void cancel()}>Cancel</Btn></>
        : <Btn size="sm" variant="primary" icon={<Cloud className="h-4 w-4" />} loading={busy} onClick={() => void start()}>Sign in with Hostinger</Btn>}
    </div>
    {login && <p role="status" className="text-[13px] text-text-secondary">{login.message}</p>}
    {error && <p role="alert" className="text-[13px] text-rose-300">{error}</p>}
    {open && <ModalSurface aria-labelledby="hostinger-login-heading" initialFocusRef={heading} onClose={() => setOpen(false)} className="m-auto flex h-[90dvh] max-h-[90dvh] w-[min(1200px,calc(100%_-_24px))] min-w-0 flex-col overflow-hidden rounded-xl border border-border-default bg-surface-primary shadow-2xl">
      <div className="flex shrink-0 items-center justify-between gap-2 border-b border-border-default p-3"><h2 id="hostinger-login-heading" ref={heading} tabIndex={-1} className="text-sm font-semibold text-text-heading outline-none">Sign in to Hostinger</h2><Btn variant="ghost" aria-label="Minimize Hostinger sign-in" onClick={() => setOpen(false)}><X className="h-4 w-4" /></Btn></div>
      {login?.status !== "pending" && <p role="status" className="shrink-0 px-3 py-2 text-[13px] text-text-secondary">{login?.message || "Loading sign-in status…"}</p>}
      {error && <p role="alert" className="px-3 text-[13px] text-rose-300">{error}</p>}
      <div className="min-h-0 flex-1 bg-surface-base">
        {login?.sessionId && login.browserProvider && (login.viewerUrl || login.webSocketUrl) && active(login.status)
          ? <ResourceBrowserView id={login.sessionId} provider={login.browserProvider} name="Hostinger sign-in in Zoer browser" presentation="focused" />
          : <div className="flex h-full flex-col items-center justify-center gap-3 p-4 text-center text-sm text-text-secondary">{active(login?.status) && <Loader2 className="h-5 w-5 shrink-0 animate-spin" />}{login?.status === "starting" ? "Preparing your sign-in page. You can minimize this window while it starts." : login?.status === "connected" ? "Account connected. Return to your WordPress sites." : login?.message || "Preparing your browser…"}</div>}
      </div>
      <div className="flex shrink-0 flex-wrap justify-end gap-2 border-t border-border-default p-3">{id && <Btn disabled={login?.status === "connecting"} loading={busy} onClick={() => void cancel()}>Cancel sign-in</Btn>}<Btn onClick={() => setOpen(false)}>{id ? "Minimize" : "Done"}</Btn></div>
    </ModalSurface>}
  </section>;
}
