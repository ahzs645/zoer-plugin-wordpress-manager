import type { WordPressSiteDeletePreview } from "../../lib/api/wordpress-manager-client";

/** Used when the Zoer host can't describe a deletion yet (older hosts). */
export const FALLBACK_DELETE_PREVIEW: WordPressSiteDeletePreview = {
  trash: {
    purgeAfterDays: 7,
    kept: [
      "The DDEV project folder and its database files",
      "DDEV snapshots and the site's backups in Files",
      "Links to repositories and the live site",
    ],
    removedAtPurge: [
      "The site's address and its place in DDEV's project list",
      "Zoer's records for the site: chats, automations, grants and secrets",
    ],
  },
  erase: { available: false, reason: "This Zoer version can't delete everything at once yet. Move the site to the trash, then remove it from the Trash.", removes: [] },
};

/** The name the person must type to delete everything: exact, apart from surrounding spaces. */
export function eraseConfirmed(siteName: string, typed: string): boolean {
  return typed.trim() === siteName.trim() && siteName.trim().length > 0;
}

/** "in 7 days (Oct 25)" for the trash purge. */
export function purgeWhen(preview: WordPressSiteDeletePreview["trash"], now = Date.now()): string {
  const at = preview.purgeAt ? Date.parse(preview.purgeAt) : now + preview.purgeAfterDays * 86_400_000;
  const days = Math.max(1, Math.round((at - now) / 86_400_000));
  return `in ${days} day${days === 1 ? "" : "s"} (${new Date(at).toLocaleDateString(undefined, { month: "short", day: "numeric" })})`;
}

/**
 * How the dialog continues when the delete preview can't be read. A bare 404/405 (no error code)
 * is a host without the route; anything else (a missing site, a 500, a timeout) is shown as a
 * warning. Either way the trash stays available with the generic description.
 */
export function previewFailure(error: unknown): { olderHost: boolean; warning: string | null } {
  const status = typeof (error as { status?: unknown })?.status === "number" ? (error as { status: number }).status : null;
  const code = (error as { code?: unknown })?.code;
  if ((status === 404 || status === 405) && !(typeof code === "string" && code)) return { olderHost: true, warning: null };
  const message = error instanceof Error && error.message ? error.message : "Unable to check what this deletes.";
  return { olderHost: false, warning: `${message} The list below is the general description.` };
}
