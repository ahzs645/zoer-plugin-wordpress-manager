/**
 * Plugin-engine transfers (Zoer docs/plugin-shared-services.md 16.5 P3) through the native
 * bridge only: the catalog (`catalog.list`/`catalog.commit`), resumable runs (`action`,
 * `action.request`, `run`, `run.pause`, `run.resume`, `cancel`, `runs.recent`) and file sets
 * (`filesets.*`). Nothing here calls `/wordpress-manager/*`.
 */
import { useQuery, useQueryClient, type QueryClient } from "@tanstack/react-query";
import { hostRequest } from "../../host/bridge";
import { waitForRun } from "../../host/actions";
import { wordpressKeys } from "./wordpress";
import { effectiveEngine, parseSiteEngine, SITE_ENGINE_KIND, siteEngineRecord, type EngineCatalogRecord, type SiteEngineData, type TransferEngine } from "../../components/extensions/pluginEngine/engineRecord";
import { isTerminalStatus, type EngineActionId, type EngineRun, type RecentRun } from "../../components/extensions/pluginEngine/runState";
import type { FileSetStatus } from "../../components/extensions/pluginEngine/uploadPlan";

export type CatalogRecord = { id: string; kind: string; title: string; data: Record<string, unknown>; updated_at?: string };
type CatalogList = { revision: number; records: CatalogRecord[]; next: string | null };

export const engineKeys = {
  all: () => [...wordpressKeys.all(), "plugin-engine"] as const,
  catalog: (kind: string) => [...engineKeys.all(), "catalog", kind] as const,
  preview: (previewId: string) => [...engineKeys.all(), "preview", previewId] as const,
  recent: (actionId: string) => [...engineKeys.all(), "recent", actionId] as const,
  run: (id: string) => [...engineKeys.all(), "run", id] as const,
};

// ---------------------------------------------------------------------------
// Catalog

/** Every record of one kind (`catalog.list` pages of 200). `after`/`prefix` read one ID range. */
export async function listCatalog(kind: string, { after = "", prefix, max = 5000 }: { after?: string; prefix?: string; max?: number } = {}) {
  const records: CatalogRecord[] = [];
  let revision = 0;
  let cursor = after;
  for (;;) {
    const page = await hostRequest<CatalogList>("catalog.list", { kind, limit: 200, ...(cursor ? { after: cursor } : {}) });
    revision = page.revision;
    for (const record of page.records ?? []) {
      if (prefix && !record.id.startsWith(prefix)) return { revision, records };
      records.push(record);
    }
    if (!page.next || records.length >= max) return { revision, records };
    cursor = page.next;
  }
}

/** One commit with the current revision, re-reading and retrying when it changed meanwhile. */
export async function commitCatalog(change: { records?: EngineCatalogRecord<unknown>[]; deletes?: string[] }, kind = SITE_ENGINE_KIND) {
  for (let attempt = 0; attempt < 5; attempt++) {
    const { revision } = await hostRequest<CatalogList>("catalog.list", { kind, limit: 1 });
    const result = await hostRequest<{ revision: number; saved?: number; conflict?: boolean }>("catalog.commit", { revision, ...change });
    if (!result?.conflict) return result;
  }
  throw new Error("WordPress Manager's records kept changing. Try again.");
}

export function useCatalogKind(kind: string, { enabled = true, refetchInterval }: { enabled?: boolean; refetchInterval?: number | false } = {}) {
  return useQuery({ queryKey: engineKeys.catalog(kind), enabled, staleTime: 5_000, refetchInterval, retry: false,
    queryFn: async () => (await listCatalog(kind)).records });
}

// ---------------------------------------------------------------------------
// Engine setting

/** All engine records; one query shared by every site. Errors (e.g. an older host) mean legacy. */
export function useSiteEngines(enabled = true) {
  return useCatalogKind(SITE_ENGINE_KIND, { enabled });
}

export function useSiteEngine(siteId: string | null | undefined, enabled = true) {
  const client = useQueryClient();
  const query = useSiteEngines(enabled && !!siteId);
  const record = siteId ? query.data?.find(item => item.id === `site-engine:${siteId}`) : undefined;
  const data: SiteEngineData | null = siteId && record ? parseSiteEngine(record, siteId) : null;
  async function setEngine(input: { engine: TransferEngine; testTargetConfirmed?: boolean; label?: string; origin?: string | null }) {
    if (!siteId) throw new Error("Choose a site first.");
    await commitCatalog({ records: [siteEngineRecord({ siteId, ...input })] });
    await client.invalidateQueries({ queryKey: engineKeys.catalog(SITE_ENGINE_KIND) });
  }
  return { engine: effectiveEngine(data), data, isLoading: query.isLoading, settled: !query.isLoading, error: query.error, setEngine };
}

// ---------------------------------------------------------------------------
// Runs

/** Starts a `local_write` action (`action`) or asks the host to approve one (`action.request`). Returns the run ID. */
export async function startEngineAction(actionId: EngineActionId, input: Record<string, unknown>, { approval = false } = {}) {
  if (approval) return (await hostRequest<{ runId: string }>("action.request", { actionId, input })).runId;
  return (await hostRequest<{ run: { id: string } }>("action", { actionId, input })).run.id;
}

export const getRun = async <T = unknown>(id: string) => (await hostRequest<{ run: EngineRun<T> }>("run", { id })).run;
export const pauseRun = (id: string) => hostRequest<{ run: EngineRun }>("run.pause", { id });
export const resumeRun = (id: string, reapprove = false) => hostRequest<{ run: EngineRun }>("run.resume", { id, ...(reapprove ? { reapprove: true } : {}) });
export const cancelRun = (id: string) => hostRequest<{ run: EngineRun }>("cancel", { id });

/**
 * `transfer.push.control` (approval always, resumable): waits for the decision and the result.
 * A rollback or cleanup runs to its end on the server across many requests (a large import can
 * take a long time); its run shows under the site's transfers meanwhile.
 */
export async function controlImport(input: { siteId: string; importId: string; control: "approve" | "finish" | "rollback" | "cleanup" }) {
  const runId = await startEngineAction("transfer.push.control", input, { approval: true });
  const long = input.control === "rollback" || input.control === "cleanup";
  const run = await waitForRun<{ summary?: string; phase?: string; cleanedUp?: boolean; status?: string; error?: { message?: string } }>(runId, { timeoutMs: long ? 12 * 3_600_000 : 30 * 60_000 });
  // A refusal by the site ends the run with a failure result (see the worker's slices.js).
  if (run.status === "succeeded" && run.output?.status === "failed") throw new Error(run.output.error?.message || "The destination refused this request.");
  if (run.status === "succeeded") return run.output ?? {};
  throw new Error(run.status === "cancelled" ? run.error || "The request was declined or cancelled." : run.error || "The request failed.");
}

/**
 * Deletes a plugin-engine pull or local export through its own action (`remove: true`): the
 * file set, the `pull:` record and the export on the source. `remoteRemoved: false` carries the
 * reason the source's export stayed.
 */
export async function deletePull(pull: { pullId: string; siteId: string; kind: "pull" | "local-export" }) {
  const actionId = pull.kind === "local-export" ? "transfer.local-export" : "transfer.pull";
  const runId = await startEngineAction(actionId, { siteId: pull.siteId, pullId: pull.pullId, remove: true });
  const run = await waitForRun<{ remoteRemoved?: boolean; remoteError?: string }>(runId, { timeoutMs: 10 * 60_000 });
  if (run.status === "succeeded") return run.output ?? {};
  throw new Error(run.error || (run.status === "cancelled" ? "The delete was declined or cancelled." : "The download could not be deleted."));
}

/** One run, polled every two seconds until it is terminal. */
export function useEngineRun<T = unknown>(id: string | null | undefined) {
  return useQuery({ queryKey: engineKeys.run(id ?? ""), enabled: !!id, retry: false, queryFn: () => getRun<T>(id!),
    refetchInterval: query => { const run = query.state.data as EngineRun | undefined; return !run || !isTerminalStatus(run.status) ? 2_000 : false; } });
}

/** Runs one `runs.recent` call returns (the host's maximum). */
export const RECENT_RUNS_LIMIT = 50;
/** Finished runs seen earlier on this page stay listed this long after they no longer come back. */
const KEEP_FINISHED_MS = 7 * 24 * 3_600_000;
const MAX_KEPT_RUNS = 200;
export const recentRunsKey = () => [...engineKeys.all(), "recent"] as const;

/**
 * The newest runs win; finished runs seen earlier on this page that no longer come back (more
 * than 50 newer runs of any action) stay with their last state for seven days, so a failure
 * stays pinned under Recent transfers and a rolled-back import keeps its card state. Runs that
 * were still active are not kept: their cards follow them through `run`. Newest first.
 */
export function mergeRecentRuns(fresh: RecentRun[], previous: RecentRun[] | undefined, now = Date.now()): RecentRun[] {
  const seen = new Set(fresh.map(run => run.runId));
  const kept = (previous ?? []).filter(run => !seen.has(run.runId) && isTerminalStatus(run.status) && now - Date.parse(run.finishedAt ?? run.createdAt) <= KEEP_FINISHED_MS);
  return [...fresh, ...kept].sort((a, b) => b.createdAt.localeCompare(a.createdAt)).slice(0, Math.max(MAX_KEPT_RUNS, fresh.length));
}

/** Poll interval of the shared run list: 3 s while a run is active, otherwise 30 s; none while the page is hidden. */
export function recentRunsInterval(runs: RecentRun[] | undefined) {
  return runs?.some(run => !isTerminalStatus(run.status)) ? 3_000 : 30_000;
}

/**
 * Recent runs of the given actions (newest first). Every component shares one query: one
 * `runs.recent` call for the whole plugin per poll (no action filter, 50 runs), filtered here.
 * Zoer parses its whole run store for each call and once more per returned run, so the plugin
 * must not fan out one call per action and component.
 */
export function useRecentRuns(actionIds: readonly EngineActionId[], { enabled = true }: { enabled?: boolean } = {}) {
  return useQuery(recentRunsQuery(useQueryClient(), actionIds, enabled));
}

/** The shared query's options; `actionIds` only filters what a component sees. */
export function recentRunsQuery(client: QueryClient, actionIds: readonly string[], enabled = true) {
  return { queryKey: recentRunsKey(), enabled, retry: false, staleTime: 2_000,
    queryFn: async () => mergeRecentRuns((await hostRequest<{ runs: RecentRun[] }>("runs.recent", { limit: RECENT_RUNS_LIMIT })).runs ?? [], client.getQueryData<RecentRun[]>(recentRunsKey())),
    select: (runs: RecentRun[]) => runs.filter(run => actionIds.includes(run.actionId)),
    // React Query does not poll while the page is hidden (refetchIntervalInBackground is off).
    refetchInterval: (query: { state: { data?: RecentRun[] } }) => recentRunsInterval(query.state.data) };
}

// ---------------------------------------------------------------------------
// File sets

export type FileSetSummary = { id: string; name: string; status: "open" | "sealed"; labels?: Record<string, string>; entryCount: number; totalBytes: number; createdAt: string; expiresAt?: string };
export type FileSetEntry = { path: string; bytes: number; sha256: string; state: string; received: number };

export const filesets = {
  list: (label?: { key: string; value: string }) => hostRequest<{ sets: FileSetSummary[] }>("filesets.list", label ? { label } : {}),
  describe: (setId: string) => hostRequest<{ set: FileSetSummary; entries: FileSetEntry[]; next: number | null }>("filesets.describe", { setId, limit: 2000 }),
  create: (input: { name: string; entries: Array<{ path: string; bytes: number; sha256: string }>; rules?: string; labels?: Record<string, string> }) => hostRequest<{ set: FileSetSummary }>("filesets.create", input),
  put: (input: { setId: string; path: string; index: number; chunk: Blob }) => hostRequest<{ entry: FileSetEntry }>("filesets.put", input),
  status: (setId: string) => hostRequest<FileSetStatus>("filesets.status", { setId }),
  seal: (setId: string) => hostRequest<{ set: FileSetSummary }>("filesets.seal", { setId }),
  remove: (setId: string) => hostRequest<{ deleted: boolean }>("filesets.delete", { setId }),
  download: (input: { setId: string; path?: string; format?: "tar.gz" | "tar" | "zip" }) => hostRequest<{ url: string; expiresAt: string }>("filesets.download", input),
};

/** Opens a one-use, cookie-free download URL as a plain link. */
export async function downloadFileSet(input: { setId: string; path?: string; format?: "tar.gz" }, fileName: string) {
  const { url } = await filesets.download(input);
  const link = document.createElement("a");
  link.href = url; link.download = fileName; link.rel = "noopener";
  document.body.appendChild(link); link.click(); link.remove();
}
