import { useEffect, useRef, useState } from "react";
import { Check, Pencil, Trash2, X, Zap } from "lucide-react";
import { ActionMenu, Btn, StatusBadge, controlClass } from "@zoer/plugin-ui/controls";
import type { HostingerConnectionPublic } from "../../lib/api";
import HostingerReconnect from "./HostingerReconnect";
import { connectionHealth } from "./pluginEngine/publicationCheck";
import { formatWhen } from "../../lib/formatWhen";

export const ACCOUNT_NAME_MAX = 80;

/** A trimmed account name, or an error when it can't be saved. */
export function accountNameError(name: string): string | null {
  const trimmed = name.trim();
  if (!trimmed) return "Enter a name.";
  if (trimmed.length > ACCOUNT_NAME_MAX) return `Use up to ${ACCOUNT_NAME_MAX} characters.`;
  return null;
}

/** One Hostinger account in Provider accounts: its health, rename, test and remove. */
export default function HostingerAccountRow({ connection, busy, renameUnavailable, onTest, onRemove, onRename, onReconnected }: {
  connection: HostingerConnectionPublic;
  busy: string | null;
  /** The Zoer host doesn't support renaming accounts yet. */
  renameUnavailable?: boolean;
  onTest: (connection: HostingerConnectionPublic) => void;
  onRemove: (connection: HostingerConnectionPublic) => void;
  /** Resolves when saved; rejects with the reason it wasn't. */
  onRename: (connection: HostingerConnectionPublic, name: string) => Promise<void>;
  onReconnected: () => void;
}) {
  const [editing, setEditing] = useState(false);
  const [name, setName] = useState(connection.name);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const input = useRef<HTMLInputElement>(null);
  useEffect(() => { if (editing) input.current?.select(); }, [editing]);
  useEffect(() => { if (!editing) setName(connection.name); }, [connection.name, editing]);

  const health = connectionHealth(connection);
  const cancel = () => { setEditing(false); setName(connection.name); setError(null); };
  const save = async () => {
    const problem = accountNameError(name);
    if (problem) { setError(problem); return; }
    if (name.trim() === connection.name) { cancel(); return; }
    setSaving(true); setError(null);
    try { await onRename(connection, name.trim()); setEditing(false); }
    catch (caught) { setError(caught instanceof Error ? caught.message : "The name wasn't saved."); }
    finally { setSaving(false); }
  };

  return <div className="flex flex-wrap items-start justify-between gap-x-3 gap-y-2 rounded-md border border-border-muted bg-surface-primary/50 p-3">
    <div className="min-w-0 flex-1">
      {editing
        ? <form className="flex min-w-0 items-center gap-1" onSubmit={event => { event.preventDefault(); void save(); }}>
            <input ref={input} aria-label="Account name" className={controlClass("compact", "min-w-0 flex-1")} value={name} maxLength={ACCOUNT_NAME_MAX + 20} disabled={saving} onChange={event => setName(event.target.value)} onKeyDown={event => { if (event.key === "Escape") { event.preventDefault(); cancel(); } }} />
            <Btn size="sm" variant="ghost" type="submit" iconOnly icon={<Check className="h-3.5 w-3.5" />} aria-label="Save name" loading={saving}>{null}</Btn>
            <Btn size="sm" variant="ghost" iconOnly icon={<X className="h-3.5 w-3.5" />} aria-label="Cancel renaming" disabled={saving} onClick={cancel}>{null}</Btn>
          </form>
        : <div className="flex min-w-0 flex-wrap items-center gap-2 text-[12px] font-medium text-text-primary">
            <span className="break-words">{connection.name}</span>
            <StatusBadge tone={!health.ok ? "error" : health.stale ? "neutral" : "success"}>{!health.ok ? "Needs reconnecting" : health.stale ? "Not checked recently" : "Working"}</StatusBadge>
          </div>}
      <div className="mt-1 text-[12px] text-text-secondary">{connection.oauthConnectionId ? "Browser sign-in · Zoer connection" : connection.authMethod === "browser-login" ? "Browser sign-in" : "API token"} · Last tested {connection.lastTestedAt ? formatWhen(connection.lastTestedAt) : "never"}</div>
      {connection.lastError && <div className="mt-1 text-[12px] text-status-error">{connection.lastError}</div>}
      {error && <div role="alert" className="mt-1 text-[12px] text-status-error">{error}</div>}
    </div>
    {/* Test, rename and remove are one menu, on phones as well (no permanently visible destructive button). */}
    {!editing && <ActionMenu label={`Actions for ${connection.name}`} size="sm" items={[
      { label: "Test connection", icon: <Zap className="h-4 w-4" />, loading: busy === `test:${connection.id}`, disabled: busy !== null && busy !== `test:${connection.id}`, onClick: () => onTest(connection) },
      ...(!renameUnavailable ? [{ label: "Rename account", icon: <Pencil className="h-4 w-4" />, onClick: () => setEditing(true) }] : []),
      { label: "Remove account", icon: <Trash2 className="h-4 w-4" />, tone: "danger" as const, loading: busy === `remove:${connection.id}`, disabled: busy !== null, onClick: () => onRemove(connection) },
    ]} />}
    {!health.ok && <div className="w-full border-t border-border-muted pt-3"><p className="mb-2 text-[12px] text-text-secondary">Reconnect keeps this account's sites, recovery points and cache links. Zoer opens a fresh browser for the sign-in.</p><HostingerReconnect connection={connection} onDone={onReconnected} /></div>}
  </div>;
}
