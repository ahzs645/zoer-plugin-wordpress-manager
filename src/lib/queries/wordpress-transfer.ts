/**
 * A site's Zoer Connect connection and its transfer-panel inventory. Since 0.8.0 transfers run only
 * as this plugin's actions (`lib/queries/plugin-engine.ts`); nothing here calls Zoer's legacy
 * transfer routes. The connection itself stays on `/wordpress-manager/connect/:siteId` (Zoer keeps it).
 */
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { json } from "../api/_http";
import { runAction } from "../../host/actions";
import { wordpressKeys } from "./wordpress";
import type { WordPressDiagnostics, ZoerConnectConnection } from "../api/types/wordpress-transfer";
import { LOCAL_INVENTORY_COMMANDS, parseLocalInventory } from "../wordpress-transfer/inventory";

const connectPath = (siteId: string) => `/wordpress-manager/connect/${encodeURIComponent(siteId)}`;
export const transferKeys = {
  all: () => [...wordpressKeys.all(), "transfer"] as const,
  connection: (siteId: string) => [...transferKeys.all(), "connection", siteId] as const,
  diagnostics: (siteId: string, local: boolean) => [...transferKeys.all(), "diagnostics", local ? "local" : "remote", siteId] as const,
};

// ---------------------------------------------------------------------------
// Connection

export function useZoerConnection(siteId: string, enabled = true) {
  const client = useQueryClient();
  const queryKey = transferKeys.connection(siteId);
  const query = useQuery({ queryKey, enabled, staleTime: 30_000,
    queryFn: ({ signal }) => json<{ connection: ZoerConnectConnection | null }>(connectPath(siteId), { signal }).then(r => r.connection ?? null) });
  const mutation = useMutation({
    mutationFn: async (command: { action: "save"; connectionInfo: string } | { action: "test" } | { action: "disconnect" }) => {
      if (command.action === "disconnect") { await json(connectPath(siteId), { method: "DELETE" }); return null; }
      const result = await json<{ connection: ZoerConnectConnection | null }>(connectPath(siteId) + (command.action === "test" ? "/test" : ""),
        { method: "POST", ...(command.action === "save" ? { body: JSON.stringify({ connectionInfo: command.connectionInfo }) } : {}) });
      return result.connection ?? null;
    },
    onSuccess: connection => {
      client.setQueryData(queryKey, connection);
      void client.invalidateQueries({ queryKey: [...transferKeys.all(), "diagnostics", "remote", siteId] });
    },
  });
  return { ...query, connection: query.data ?? null, command: mutation.mutateAsync, commandPending: mutation.isPending, commandError: mutation.error };
}

// ---------------------------------------------------------------------------
// Inventory (tables, post types, themes, plugins) for the transfer panels

/** A Zoer Connect site's `/diagnostics`, read by `site.test` through the site's endpoint (endpoint ID = site ID). */
export async function readSiteDiagnostics(siteId: string): Promise<WordPressDiagnostics> {
  const result = await runAction<{ ok: boolean; summary: string; diagnostics?: WordPressDiagnostics }>("site.test", { endpointId: siteId, diagnostics: true }, { timeoutMs: 2 * 60_000 });
  if (!result.ok || !result.diagnostics) throw new Error(result.summary || "WordPress returned invalid diagnostics.");
  return result.diagnostics;
}

/** A running local DDEV site's tables, plugins and themes through bounded read-only WP-CLI. */
export async function readLocalInventory(siteId: string): Promise<WordPressDiagnostics> {
  const read = (args: readonly string[]) => runAction<{ summary: string }>("wpcli.read", { siteId, args: [...args] }, { timeoutMs: 3 * 60_000 }).then(r => r.summary ?? "");
  const [tables, plugins, themes] = await Promise.all([read(LOCAL_INVENTORY_COMMANDS.tables), read(LOCAL_INVENTORY_COMMANDS.plugins), read(LOCAL_INVENTORY_COMMANDS.themes)]);
  return parseLocalInventory({ tables, plugins, themes });
}

/** Zoer Connect diagnostics of a connected site, or the inventory of a local DDEV export source. */
export function useWordPressDiagnostics(siteId: string | null | undefined, { local = false, enabled = true }: { local?: boolean; enabled?: boolean } = {}) {
  return useQuery({
    queryKey: transferKeys.diagnostics(siteId ?? "", local),
    enabled: enabled && !!siteId,
    staleTime: 60_000,
    retry: 1,
    queryFn: () => local ? readLocalInventory(siteId!) : readSiteDiagnostics(siteId!),
  });
}
