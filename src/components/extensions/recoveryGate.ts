import { apiErrorFields } from "../../lib/api/_http";

/** A live Hostinger change refused until someone records a recent hPanel backup. */
export interface RecoveryGate { connectionId: string | null; domain: string | null; hpanelUrl: string; validHours: number }

export const RECOVERY_POINT_REQUIRED = "RECOVERY_POINT_REQUIRED";
const RECOVERY_VALID_HOURS = 24;
// Hosts from before the error code send only this sentence.
const LEGACY_MESSAGE = /hPanel recovery point from the last 24 hours/i;

export function hpanelBackupsUrl(domain: string | null | undefined): string {
  // The website's hPanel page; Backups is in its Files menu.
  return domain ? `https://hpanel.hostinger.com/websites/${encodeURIComponent(domain)}` : "https://hpanel.hostinger.com/websites";
}

/** The recovery gate behind an error, filled in from the site when an older host sent only text. */
export function recoveryGateFrom(error: unknown, site: { connectionId?: string | null; domain?: string | null } | null): RecoveryGate | null {
  const { code, details } = apiErrorFields(error);
  const message = error instanceof Error ? error.message : typeof error === "string" ? error : "";
  if (code !== RECOVERY_POINT_REQUIRED && !LEGACY_MESSAGE.test(message)) return null;
  const text = (value: unknown) => typeof value === "string" && value.trim() ? value.trim() : null;
  const domain = text(details?.domain) ?? text(site?.domain);
  const hours = Number(details?.validHours);
  return {
    connectionId: text(details?.connectionId) ?? text(site?.connectionId),
    domain,
    hpanelUrl: text(details?.hpanelUrl)?.startsWith("https://") ? text(details?.hpanelUrl)! : hpanelBackupsUrl(domain),
    validHours: Number.isFinite(hours) && hours > 0 ? hours : RECOVERY_VALID_HOURS,
  };
}

/** When the newest recorded recovery point stops counting, or null when none counts now. */
export function recoveryPointValidUntil(points: readonly { verifiedAt: string }[], now = Date.now(), validHours = RECOVERY_VALID_HOURS): Date | null {
  const newest = Math.max(...points.map(point => Date.parse(point.verifiedAt)).filter(Number.isFinite), Number.NEGATIVE_INFINITY);
  if (!Number.isFinite(newest)) return null;
  const until = newest + validHours * 3_600_000;
  return until > now ? new Date(until) : null;
}

/**
 * The Hostinger record that can hold a recovery point for `site`. A site shown as
 * "Hostinger + Zoer Connect" may be the Connect record, which has no account or domain.
 */
export function hostingerRecordFor<T extends { provider: string; connectionId?: string | null; domain?: string | null }>(site: T | null, aliases: readonly T[]): T | null {
  const candidates = site ? [site, ...aliases] : [...aliases];
  return candidates.find(entry => entry.provider === "hostinger" && !!entry.connectionId && !!entry.domain) ?? null;
}
