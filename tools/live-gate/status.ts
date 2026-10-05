#!/usr/bin/env bun
/**
 * One line per run: status, resumable state, slices and the checkpoint fields transfers use.
 * Read-only. `--watch [seconds]` repeats until every run has stopped.
 *
 *   bun tools/live-gate/status.ts <runId> [<runId> ...] [--watch 5]
 */
import { getRun, isStopped, step } from "./zoer";

export async function statusLine(id: string) {
  const [run, s] = await Promise.all([getRun(id), step(id).catch(() => null)]);
  const c = s?.checkpoint ?? {};
  return {
    run,
    line: JSON.stringify({
      id, action: run?.actionId, status: run?.status, state: run?.resumable?.state, slices: run?.resumable?.slices, progress: run?.resumable?.progress,
      phase: c.phase, remotePhase: c.remotePhase, prep: c.preparation, cursor: c.cursor, downloaded: c.downloaded, uploadedRaw: c.uploadedRaw,
      total: c.total ?? c.totalBytes, importId: c.importId, pullId: c.pullId, updated: s?.updatedAt, reason: run?.statusReason ?? undefined, error: run?.error ?? undefined,
    }),
  };
}

if (import.meta.main) {
  const argv = process.argv.slice(2);
  const watchAt = argv.indexOf("--watch");
  const every = watchAt >= 0 ? Number(argv.splice(watchAt, 2)[1] ?? 5) || 5 : 0;
  if (!argv.length) { console.log("Usage: status.ts <runId> [...] [--watch seconds]"); process.exit(2); }
  for (;;) {
    const rows = await Promise.all(argv.map(statusLine));
    for (const row of rows) console.log(`${new Date().toISOString().slice(11, 19)} ${row.line}`);
    if (!every || rows.every(row => isStopped(row.run))) break;
    await Bun.sleep(every * 1000);
  }
}
