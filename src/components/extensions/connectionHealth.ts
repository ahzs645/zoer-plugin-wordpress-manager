import { useQueries, useQueryClient } from "@tanstack/react-query";
import { useMemo } from "react";
import { json } from "../../lib/api/_http";

/**
 * Saved Zoer Connect connections, tested again every 10 minutes while WordPress Manager is open and on
 * Refresh. A site Zoer listed as connected can since have been deleted, moved, or given a new key in
 * WordPress; the saved status alone would keep calling it connected.
 */
export interface ConnectionProblem { kind: "unreachable" | "rejected"; message: string; checkedAt: number }

const KEY = ["wordpress-manager", "connection-health"] as const;
const INTERVAL = 10 * 60_000;

/** What a failed connection test means; null for answers that are not a problem with the site (busy, paused, Zoer itself). */
export function classifyConnectionError(message: string): ConnectionProblem["kind"] | null {
  if (/rejected this key|revoked/i.test(message)) return "rejected";
  if (/Could not verify the connection|Zoer Connect was not found|does not match this site|invalid connector response/i.test(message)) return "unreachable";
  return null;
}

export function useConnectionHealth(siteIds: string[]) {
  const client = useQueryClient();
  const ids = useMemo(() => [...new Set(siteIds)].sort(), [siteIds.join(",")]); // eslint-disable-line react-hooks/exhaustive-deps
  const results = useQueries({ queries: ids.map(id => ({
    queryKey: [...KEY, id], staleTime: INTERVAL - 60_000, refetchInterval: INTERVAL, refetchIntervalInBackground: false, retry: 1, retryDelay: 15_000,
    queryFn: async (): Promise<ConnectionProblem | null> => {
      try { await json(`/wordpress-manager/connect/${encodeURIComponent(id)}/test`, { method: "POST" }); return null; }
      catch (error) {
        const message = error instanceof Error ? error.message : "";
        const kind = classifyConnectionError(message);
        if (!kind) return null;
        // One more try before calling a site gone: a single network hiccup is not a deleted website.
        if (kind === "unreachable") throw Object.assign(new Error(message), { problem: { kind, message, checkedAt: Date.now() } });
        return { kind, message, checkedAt: Date.now() };
      }
    },
  })) });
  const problems = new Map<string, ConnectionProblem>();
  results.forEach((result, index) => {
    const problem = result.data ?? (result.error as { problem?: ConnectionProblem } | null)?.problem ?? null;
    if (problem && !(result.data === null && !result.error)) problems.set(ids[index]!, problem);
  });
  return { problems, checking: results.some(result => result.isFetching), recheck: () => client.invalidateQueries({ queryKey: KEY }) };
}

/** "3 min ago" for a check time. */
export function checkedAgo(at: number, now = Date.now()) {
  const minutes = Math.round((now - at) / 60_000);
  return minutes < 1 ? "just now" : minutes < 60 ? `${minutes} min ago` : `${Math.round(minutes / 60)} h ago`;
}
