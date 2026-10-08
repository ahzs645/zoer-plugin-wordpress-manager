/**
 * A site's Zoer Connect connection and its transfer-panel inventory. Since 0.8.0 transfers run only
 * as this plugin's actions (`lib/queries/plugin-engine.ts`); nothing here calls Zoer's legacy
 * transfer routes. The connection itself stays on `/wordpress-manager/connect/:siteId` (Zoer keeps it).
 */
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { json } from "../api/_http";
import { ActionFailedError, runAction } from "../../host/actions";
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

const WORKER_CLEANUP_WAIT = "Waiting for prior plugin worker cleanup. Its run has ended but its worker is still present; retry resume after workflow recovery removes it.";
// Normal pod termination takes one second; the host's recovery sweep runs every 30 seconds.
// Share this 35-second budget across the entire inventory, rather than retrying each command independently.
const LOCAL_INVENTORY_RETRY_DELAYS = [2_000, 3_000, 30_000] as const;
const pause = (ms: number) => new Promise<void>(resolve => setTimeout(resolve, ms));
const localInventoryRead = (siteId: string, args: readonly string[]) =>
  runAction<{ summary: string }>("wpcli.read", { siteId, args: [...args] }, { timeoutMs: 3 * 60_000 }).then(r => r.summary ?? "");

function isWorkerCleanupWait(error: unknown): boolean {
  // Cancellation and an unknown action outcome must never start another action.
  if (error instanceof ActionFailedError && error.run.status !== "failed") return false;
  return error instanceof Error && (error.message === WORKER_CLEANUP_WAIT ||
    error.message === `Integration kubernetes worker failed to start: ${WORKER_CLEANUP_WAIT}`);
}

/** A running local DDEV site's tables, plugins and themes through bounded read-only WP-CLI. */
export async function readLocalInventory(siteId: string, dependencies: {
  read?: typeof localInventoryRead;
  pause?: typeof pause;
} = {}): Promise<WordPressDiagnostics> {
  const readCommand = dependencies.read ?? localInventoryRead;
  const wait = dependencies.pause ?? pause;
  let retries = 0;
  const read = async (args: readonly string[]) => {
    for (;;) {
      try { return await readCommand(siteId, args); }
      catch (error) {
        if (!isWorkerCleanupWait(error) || retries >= LOCAL_INVENTORY_RETRY_DELAYS.length) throw error;
        await wait(LOCAL_INVENTORY_RETRY_DELAYS[retries++]);
      }
    }
  };
  // Finished workers are removed asynchronously. Parallel actions can contend with that host guard.
  const tables = await read(LOCAL_INVENTORY_COMMANDS.tables);
  const plugins = await read(LOCAL_INVENTORY_COMMANDS.plugins);
  const themes = await read(LOCAL_INVENTORY_COMMANDS.themes);
  return parseLocalInventory({ tables, plugins, themes });
}

/** Zoer Connect diagnostics of a connected site, or the inventory of a local DDEV export source. */
export function useWordPressDiagnostics(siteId: string | null | undefined, { local = false, enabled = true }: { local?: boolean; enabled?: boolean } = {}) {
  return useQuery({
    queryKey: transferKeys.diagnostics(siteId ?? "", local),
    enabled: enabled && !!siteId,
    staleTime: 60_000,
    retry: local ? false : 1,
    queryFn: () => local ? readLocalInventory(siteId!) : readSiteDiagnostics(siteId!),
  });
}
