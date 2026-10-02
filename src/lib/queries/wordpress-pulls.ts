import { useMutation, useMutationState, useQuery, useQueryClient } from "@tanstack/react-query";
import { json } from "../api/_http";
import { wordpressKeys } from "./wordpress";
import { transferKeys } from "./wordpress-transfer";

export type WordPressPullJob = {
  id: string; createdAt: string;
  status: "preparing" | "downloading" | "ready" | "paused" | "cancelled";
  pausedFrom?: "preparing" | "downloading";
  running?: boolean; pendingAction?: "pause" | "cancel"; lastError?: string;
  preparation?: { phase: string; files: number };
  fileCount?: number; totalBytes?: number; downloadedBytes?: number;
  index: number; offset: number; files: { path: string; bytes: number }[];
  remoteCleanupPending?: boolean;
  /** 0.3 `{database, profile}` or 0.4 `ExportOptions`; see `pullContents`. */
  options?: unknown;
  source?: { url?: string; prefix?: string; abspath?: string; tables?: string[]; originalUrls?: string[] } | null;
};
type PullList = { jobs: WordPressPullJob[]; serverRunner?: boolean };
/** Which transfer a started pull is for; recorded by the server as the recent run's action. */
export type PullTransferAction = "pull" | "backup" | "export";
type Command = { id: string; action: "run" | "pause" | "cancel" } | { action: "start"; options: string; requestId: string; transferAction?: PullTransferAction };

export function useWordPressPulls(siteId: string, local = false, enabled = true) {
  const endpoint = local ? `/wordpress-manager/local-exports/${encodeURIComponent(siteId)}` : `/wordpress-manager/connect/${encodeURIComponent(siteId)}/pulls`;
  const queryKey = [...wordpressKeys.all(), "pulls", endpoint];
  const mutationKey = [...queryKey, "control"];
  const client = useQueryClient();
  const query = useQuery({ queryKey, enabled, queryFn: ({ signal }) => json<PullList>(endpoint, { signal }), staleTime: 1000,
    refetchInterval: q => q.state.data?.jobs.some(j => j.running || j.pendingAction) ? 2000 : 10000,
    refetchIntervalInBackground: true,
  });
  const pending = useMutationState({ filters: { mutationKey, status: "pending" }, select: m => m.state.variables as Command });
  const mutation = useMutation({ mutationKey,
    mutationFn: async (command: Command) => {
      if (command.action === "start") {
        const { job } = await json<{ job: WordPressPullJob }>(endpoint, { method: "POST", body: JSON.stringify({ ...JSON.parse(command.options), requestId: command.requestId, ...(command.transferAction ? { action: command.transferAction } : {}) }) });
        return json<{ job: WordPressPullJob }>(`${endpoint}/${job.id}/run`, { method: "POST" });
      }
      return json<{ job: WordPressPullJob }>(`${endpoint}/${command.id}${command.action === "cancel" ? "" : `/${command.action}`}`, { method: command.action === "cancel" ? "DELETE" : "POST" });
    },
    onSuccess: async ({ job }) => {
      await client.cancelQueries({ queryKey });
      client.setQueryData<PullList>(queryKey, old => ({ ...old, jobs: [job, ...(old?.jobs ?? []).filter(j => j.id !== job.id)] }));
    },
    onSettled: () => {
      void client.invalidateQueries({ queryKey });
      void client.invalidateQueries({ queryKey: [...transferKeys.all(), "history"] });
      void client.invalidateQueries({ queryKey: transferKeys.recent() });
      // Starting or resuming re-tests the connection on the server (storage, permissions).
      if (!local) void client.invalidateQueries({ queryKey: transferKeys.connection(siteId) });
    },
  });
  return { ...query, jobs: [...(query.data?.jobs ?? [])].sort((a, b) => b.createdAt.localeCompare(a.createdAt)), pending,
    serverRunner: query.data?.serverRunner === true, command: mutation.mutateAsync, commandError: mutation.error };
}
