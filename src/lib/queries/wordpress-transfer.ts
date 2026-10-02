import { useMutation, useMutationState, useQuery, useQueryClient } from "@tanstack/react-query";
import { getApiBase, json } from "../api/_http";
import { wordpressKeys } from "./wordpress";
import type {
  ExportOptions, ImportOptions, PushCommand, PushJobStatus, PushSource, TransferAction, TransferHistoryItem, TransferProfile, TransferRecentRun,
  WordPressDiagnostics, WordPressPushJob, ZoerConnectConnection,
} from "../api/types/wordpress-transfer";
import { normalizeProfile, normalizeRecentRun, unwrapList } from "../wordpress-transfer/options";

const base = "/wordpress-manager";
const connectPath = (siteId: string) => `${base}/connect/${encodeURIComponent(siteId)}`;
export const transferKeys = {
  all: () => [...wordpressKeys.all(), "transfer"] as const,
  connection: (siteId: string) => [...transferKeys.all(), "connection", siteId] as const,
  diagnostics: (siteId: string, local: boolean) => [...transferKeys.all(), "diagnostics", local ? "local" : "remote", siteId] as const,
  pushes: (siteId: string) => [...transferKeys.all(), "pushes", siteId] as const,
  profiles: () => [...transferKeys.all(), "profiles"] as const,
  recent: () => [...transferKeys.all(), "recent"] as const,
  history: (siteId: string | null) => [...transferKeys.all(), "history", siteId ?? "all"] as const,
  localCopies: (siteId: string) => [...transferKeys.all(), "local-copies", siteId] as const,
};

// ---------------------------------------------------------------------------
// Connection and diagnostics

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

function unwrapDiagnostics(value: unknown): WordPressDiagnostics {
  if (value && typeof value === "object") {
    const record = value as Record<string, unknown>;
    for (const key of ["diagnostics", "inventory"]) if (record[key] && typeof record[key] === "object") return record[key] as WordPressDiagnostics;
    return record as WordPressDiagnostics;
  }
  return {};
}

/** Plugin `/diagnostics` for a connected site, or the DDEV inventory for a local export source. */
export function useWordPressDiagnostics(siteId: string | null | undefined, { local = false, enabled = true }: { local?: boolean; enabled?: boolean } = {}) {
  return useQuery({
    queryKey: transferKeys.diagnostics(siteId ?? "", local),
    enabled: enabled && !!siteId,
    staleTime: 60_000,
    retry: 1,
    queryFn: async ({ signal }) => unwrapDiagnostics(await json<unknown>(local
      ? `${base}/local-exports/${encodeURIComponent(siteId!)}/inventory`
      : `${connectPath(siteId!)}/diagnostics`, { signal })),
  });
}

// ---------------------------------------------------------------------------
// Push / replace jobs (server-owned runner)

/** Derives the 0.4 status from a 0.3 job view that only has a phase. */
export function normalizePushJob(raw: Partial<WordPressPushJob> & { id: string; phase?: string; createdAt: string }): WordPressPushJob {
  const phase = raw.phase ?? "queued";
  const status: PushJobStatus = raw.status ?? (phase === "complete" ? "complete" : phase === "rolled_back" ? "rolled_back" : phase === "verification_required" ? "verification" : phase === "review_required" ? "review" : "paused");
  const legacyProgress = raw.progress ?? (typeof raw.fileCount === "number" ? { filesUploaded: raw.index ?? 0, fileCount: raw.fileCount } : undefined);
  return { ...raw, kind: raw.kind ?? "push", siteId: raw.siteId ?? "", phase, status, progress: legacyProgress, cleanedUp: raw.cleanedUp === true } as WordPressPushJob;
}


export type PushStart = {
  action: "start";
  kind: "push" | "replace";
  requestId: string;
  body: {
    source?: PushSource;
    selection?: { previewId: string; selectedPaths: string[] };
    confirmTarget: string;
    replacementAccepted?: boolean;
    wordpressOnlyWriters?: boolean;
    options: ImportOptions;
    tables?: string[];
    profileId?: string;
    /** 0.3 flat fields (`sourceSiteId`, `exportId`, `previewId`, `selectedPaths`) kept for older servers. */
    [legacy: string]: unknown;
  };
};
export type PushControl = { action: PushCommand; id: string };
type PushList = { jobs: WordPressPushJob[] };

/** A server worker is advancing the job. Without a runner field (0.3 view), fall back to the status. */
export function isActivePush(job: Pick<WordPressPushJob, "runner" | "status">) {
  return job.runner ? job.runner === "running" : job.status === "running" || job.status === "queued";
}

export function useWordPressPushes(siteId: string, enabled = true) {
  const endpoint = `${connectPath(siteId)}/pushes`;
  const queryKey = transferKeys.pushes(siteId);
  const mutationKey = [...queryKey, "control"];
  const client = useQueryClient();
  const query = useQuery({ queryKey, enabled, staleTime: 1000,
    queryFn: async ({ signal }) => ({ jobs: unwrapList(await json<unknown>(endpoint, { signal }), "jobs").map(job => normalizePushJob(job as WordPressPushJob)) }),
    refetchInterval: q => q.state.data?.jobs.some(isActivePush) ? 2000 : 15000,
    refetchIntervalInBackground: true,
  });
  const pending = useMutationState({ filters: { mutationKey, status: "pending" }, select: m => m.state.variables as PushStart | PushControl });
  const mutation = useMutation({ mutationKey,
    mutationFn: async (command: PushStart | PushControl) => {
      if (command.action === "start") {
        const url = command.kind === "replace" ? `${connectPath(siteId)}/replacements` : endpoint;
        const { job } = await json<{ job: WordPressPushJob }>(url, { method: "POST", body: JSON.stringify({ ...command.body, requestId: command.requestId }) });
        return json<{ job: WordPressPushJob }>(`${endpoint}/${job.id}/run`, { method: "POST" });
      }
      if (command.action === "delete") { await json(`${endpoint}/${command.id}`, { method: "DELETE" }); return { job: null, deleted: command.id }; }
      return json<{ job: WordPressPushJob }>(`${endpoint}/${command.id}/${command.action}`, { method: "POST" });
    },
    onSuccess: async (result: { job: WordPressPushJob | null; deleted?: string }) => {
      await client.cancelQueries({ queryKey });
      client.setQueryData<PushList>(queryKey, old => {
        const jobs = (old?.jobs ?? []).filter(j => j.id !== result.deleted && j.id !== result.job?.id);
        return { jobs: result.job ? [normalizePushJob(result.job), ...jobs] : jobs };
      });
    },
    onSettled: () => {
      void client.invalidateQueries({ queryKey });
      void client.invalidateQueries({ queryKey: [...transferKeys.all(), "history"] });
      void client.invalidateQueries({ queryKey: transferKeys.recent() });
    },
  });
  const jobs = [...(query.data?.jobs ?? [])].sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  return { ...query, jobs, pending, command: mutation.mutateAsync, commandError: mutation.error, resetError: mutation.reset };
}

// ---------------------------------------------------------------------------
// Profiles and recent runs

export type ProfileInput = { name: string; action: TransferAction; siteId?: string; sourceSiteId?: string; exportOptions: ExportOptions; importOptions: ImportOptions };

export function useTransferProfiles() {
  const client = useQueryClient();
  const profiles = useQuery({ queryKey: transferKeys.profiles(), staleTime: 30_000,
    queryFn: async ({ signal }) => unwrapList(await json<unknown>(`${base}/transfer-profiles`, { signal }), "profiles").map(normalizeProfile).filter((p): p is TransferProfile => p !== null) });
  const recent = useQuery({ queryKey: transferKeys.recent(), staleTime: 30_000,
    queryFn: async ({ signal }) => {
      const raw = await json<unknown>(`${base}/transfer-profiles/recent`, { signal });
      const list = unwrapList(raw, "recent").length ? unwrapList(raw, "recent") : unwrapList(raw, "runs");
      return list.map(normalizeRecentRun).filter((r): r is TransferRecentRun => r !== null).slice(0, 10);
    } });
  const invalidate = () => client.invalidateQueries({ queryKey: transferKeys.profiles() });
  const create = useMutation({ mutationFn: (input: ProfileInput) => json<unknown>(`${base}/transfer-profiles`, { method: "POST", body: JSON.stringify(input) }), onSettled: invalidate });
  const update = useMutation({ mutationFn: ({ id, ...patch }: { id: string } & Partial<ProfileInput>) => json<unknown>(`${base}/transfer-profiles/${encodeURIComponent(id)}`, { method: "PATCH", body: JSON.stringify(patch) }), onSettled: invalidate });
  const remove = useMutation({ mutationFn: (id: string) => json<unknown>(`${base}/transfer-profiles/${encodeURIComponent(id)}`, { method: "DELETE" }), onSettled: invalidate });
  return {
    profiles: profiles.data ?? [], profilesQuery: profiles, recent: recent.data ?? [], recentQuery: recent,
    create: create.mutateAsync, update: update.mutateAsync, remove: remove.mutateAsync,
    busy: create.isPending || update.isPending || remove.isPending,
    error: create.error ?? update.error ?? remove.error,
  };
}

// ---------------------------------------------------------------------------
// History

export function useTransferHistory(siteId: string | null = null) {
  return useQuery<TransferHistoryItem[]>({
    queryKey: transferKeys.history(siteId),
    staleTime: 5000,
    refetchInterval: q => q.state.data?.some(item => ["running", "queued", "preparing", "downloading", "uploading", "importing"].includes(item.status)) ? 5000 : 30_000,
    queryFn: async ({ signal }) => unwrapList(await json<unknown>(`${base}/transfers?limit=100${siteId ? `&siteId=${encodeURIComponent(siteId)}` : ""}`, { signal }), "transfers") as TransferHistoryItem[],
  });
}

// ---------------------------------------------------------------------------
// Downloads

/** Streams a finished pull to this device. The server issues a single-use, 5-minute URL
 * (auth is checked when it is issued) and the browser downloads it directly, so large
 * archives are never buffered in memory. */
export async function downloadPullPart(siteId: string, pullId: string, part: "database" | "archive", fileBase: string) {
  const { url } = await json<{ url: string }>(`${connectPath(siteId)}/pulls/${encodeURIComponent(pullId)}/download-ticket`, { method: "POST", body: JSON.stringify({ part }) });
  if (typeof url !== "string" || !url.startsWith("/wordpress-manager/")) throw new Error("The server returned an invalid download link.");
  const anchor = document.createElement("a");
  anchor.href = `${getApiBase()}${url}`;
  anchor.rel = "noreferrer";
  anchor.download = `${fileBase.replace(/[^\w.-]+/g, "-").replace(/^-+|-+$/g, "") || "wordpress"}-${part === "database" ? "database.sql" : "site.tar.gz"}`;
  document.body.appendChild(anchor); anchor.click(); anchor.remove();
}

// ---------------------------------------------------------------------------
// Local copies (server-owned runner)

export type WordPressLocalCopyJob = {
  id: string; name: string; phase: string; index: number; totalFiles: number; busy?: boolean; running?: boolean; error?: string;
  targetId?: string; targetUrl?: string; replaceSiteId?: string | null; pullId?: string; createdAt?: string;
};

export function useWordPressLocalCopies(siteId: string) {
  const endpoint = `${connectPath(siteId)}/local-copies`;
  const queryKey = transferKeys.localCopies(siteId);
  const client = useQueryClient();
  const query = useQuery<WordPressLocalCopyJob[]>({ queryKey, staleTime: 1000,
    queryFn: async ({ signal }) => unwrapList(await json<unknown>(endpoint, { signal }), "copies") as WordPressLocalCopyJob[],
    refetchInterval: q => q.state.data?.some(copy => copy.phase !== "complete" && (copy.running || copy.busy) && !copy.error) ? 2000 : 15000,
    refetchIntervalInBackground: true,
  });
  const mutation = useMutation({
    mutationFn: async (command: { action: "start"; name: string; pullId: string; replaceSiteId?: string } | { action: "run"; id: string }) => {
      if (command.action === "start") {
        const { copy } = await json<{ copy: WordPressLocalCopyJob }>(endpoint, { method: "POST", body: JSON.stringify({ name: command.name, pullId: command.pullId, ...(command.replaceSiteId ? { replaceSiteId: command.replaceSiteId } : {}) }) });
        return json<{ copy: WordPressLocalCopyJob }>(`${endpoint}/${copy.id}/run`, { method: "POST" });
      }
      return json<{ copy: WordPressLocalCopyJob }>(`${endpoint}/${command.id}/run`, { method: "POST" });
    },
    onSuccess: ({ copy }) => client.setQueryData<WordPressLocalCopyJob[]>(queryKey, old => [copy, ...(old ?? []).filter(c => c.id !== copy.id)]),
    onSettled: () => { void client.invalidateQueries({ queryKey }); void client.invalidateQueries({ queryKey: [...transferKeys.all(), "history"] }); },
  });
  return { ...query, copies: query.data ?? [], command: mutation.mutateAsync, pending: mutation.isPending, commandError: mutation.error };
}
