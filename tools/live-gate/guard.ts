/**
 * Live-gate configuration and the test-site guard. No credentials live here: the Zoer address and
 * the optional bearer token come from the environment.
 *
 * Write actions (anything whose manifest effect is not `read`, and every approval) are refused
 * unless each site they name is one of the DDEV test sites below, or is named exactly in
 * `LIVE_GATE_ALLOW_SITE` (comma-separated site IDs). Hilltop Childcare is refused always, also
 * for reads and also when named in the override.
 */

/** The DDEV test sites that transfers may write to. */
export const ALLOWED = new Set([
  "ddev-zoer-connect-040-source",
  "ddev-zoer-connect-040-destination",
  "ddev-zoer-connect-0314-compatibility",
]);

/** Never touched, not even with the override. */
export const FORBIDDEN = [/lightpink-vulture-195751/i, /^ddev-hilltop-childcare-/i, /hilltop/i];

/** Input fields that name a site. */
export const SITE_FIELDS = ["siteId", "sourceSiteId", "replaceSiteId", "endpointId"] as const;

export const OVERRIDE_ENV = "LIVE_GATE_ALLOW_SITE";

type Env = Record<string, string | undefined>;

export class GuardError extends Error {
  constructor(message: string) { super(message); this.name = "GuardError"; }
}

/** The Zoer origin from `ZOER_URL` (a trailing `/api` or slash is dropped). */
export function zoerOrigin(env: Env = process.env): string {
  const raw = env.ZOER_URL?.trim();
  if (!raw) throw new GuardError("Set ZOER_URL to the Zoer address, e.g. ZOER_URL=https://zoer.example (no default on purpose).");
  let url: URL;
  try { url = new URL(raw); } catch { throw new GuardError(`ZOER_URL is not a URL: ${raw}`); }
  if (url.protocol !== "https:" && url.protocol !== "http:") throw new GuardError(`ZOER_URL must be http(s): ${raw}`);
  return `${url.origin}${url.pathname.replace(/\/+$/, "").replace(/\/api$/, "")}`;
}

/** Site IDs named exactly in `LIVE_GATE_ALLOW_SITE`. */
export function overrideSites(env: Env = process.env): Set<string> {
  return new Set((env[OVERRIDE_ENV] ?? "").split(",").map(s => s.trim()).filter(Boolean));
}

export function isForbidden(siteId: string): boolean {
  return FORBIDDEN.some(pattern => pattern.test(siteId));
}

/** Refuses any Hilltop site (reads included). */
export function assertNotForbidden(siteId: string): void {
  if (isForbidden(siteId)) throw new GuardError(`Refused: ${siteId} is Hilltop Childcare and is never touched.`);
}

/** Refuses a write to a site that is not a test site and not named in the override. */
export function assertWritableSite(siteId: string, env: Env = process.env): void {
  assertNotForbidden(siteId);
  if (ALLOWED.has(siteId)) return;
  if (overrideSites(env).has(siteId)) {
    console.error(`[live-gate] ${OVERRIDE_ENV} allows a write to ${siteId}.`);
    return;
  }
  throw new GuardError(`Refused: ${siteId} is not a test site (${[...ALLOWED].join(", ")}). `
    + `Only the user can allow it; then set ${OVERRIDE_ENV}=${siteId}.`);
}

/** The site IDs an action input names. */
export function sitesOf(input: Record<string, unknown> | null | undefined): string[] {
  if (!input) return [];
  return SITE_FIELDS.map(field => input[field]).filter((value): value is string => typeof value === "string" && value.length > 0);
}

/**
 * Checks an action before it starts. Reads only refuse Hilltop; writes need every named site to
 * pass `assertWritableSite`. Writes that name no site (create a new DDEV site, restore a backup
 * into a new site, refresh the inventory) pass.
 */
export function assertActionAllowed(effect: string, input: Record<string, unknown>, env: Env = process.env): void {
  const sites = sitesOf(input);
  for (const site of sites) assertNotForbidden(site);
  if (effect === "read") return;
  for (const site of sites) assertWritableSite(site, env);
}

/** Checks an open approval's reviewed input (and its whole text for Hilltop) before resolving it. */
export function assertApprovalAllowed(approval: unknown, env: Env = process.env): void {
  const text = JSON.stringify(approval ?? {});
  if (FORBIDDEN.some(pattern => pattern.test(text))) throw new GuardError("Refused: the approval mentions Hilltop Childcare.");
  const reviewed = (approval as { payload?: { structuredReview?: { input?: Record<string, unknown> } } })?.payload?.structuredReview?.input;
  const sites = sitesOf(reviewed);
  if (!sites.length) throw new GuardError("Refused: the approval names no site in its reviewed input; resolve it in the Zoer UI after reading it.");
  for (const site of sites) assertWritableSite(site, env);
}
