/**
 * Per-site transfer engine setting (Zoer docs/plugin-shared-services.md 16.5 P3).
 *
 * Catalog record `site-engine:<siteId>` (kind `site-engine`), written only by this UI:
 * `{ v: 1, siteId, engine: "legacy" | "plugin", testTarget, label?, origin?, confirmedAt?, updatedAt }`.
 * No record means legacy. The workers refuse a site unless `engine === "plugin" && testTarget === true`,
 * so this module treats anything else (including a malformed record) as legacy.
 */

export type TransferEngine = "legacy" | "plugin";

export const SITE_ENGINE_KIND = "site-engine";

export interface SiteEngineData {
  v: 1;
  siteId: string;
  engine: TransferEngine;
  testTarget: boolean;
  label?: string;
  origin?: string;
  confirmedAt?: string;
  updatedAt: string;
}

export interface EngineCatalogRecord<T = Record<string, unknown>> { id: string; kind: string; title: string; data: T }

export const ENGINE_LABELS: Record<TransferEngine, string> = { legacy: "Legacy (Zoer host)", plugin: "Plugin (test target)" };

export const engineRecordId = (siteId: string) => `site-engine:${siteId}`;

/** Same pattern as the transfer actions' `siteId` input schema. */
export const ENGINE_SITE_ID = /^[A-Za-z0-9][A-Za-z0-9:._@-]{0,255}$/;

const ISO = (value: unknown): value is string => typeof value === "string" && value.length <= 40 && Number.isFinite(Date.parse(value));

/** Validated record data for `siteId`, or null when the record is missing, malformed or for another site. */
export function parseSiteEngine(record: { id?: unknown; kind?: unknown; data?: unknown } | null | undefined, siteId: string): SiteEngineData | null {
  if (!record || record.kind !== SITE_ENGINE_KIND || record.id !== engineRecordId(siteId)) return null;
  const data = record.data as Record<string, unknown> | null;
  if (!data || typeof data !== "object") return null;
  if (data.siteId !== siteId || (data.engine !== "legacy" && data.engine !== "plugin") || typeof data.testTarget !== "boolean" || !ISO(data.updatedAt)) return null;
  return {
    v: 1, siteId, engine: data.engine, testTarget: data.testTarget, updatedAt: data.updatedAt,
    ...(typeof data.label === "string" ? { label: data.label } : {}),
    ...(typeof data.origin === "string" ? { origin: data.origin } : {}),
    ...(ISO(data.confirmedAt) ? { confirmedAt: data.confirmedAt } : {}),
  };
}

/** The engine the workers will accept for this site: plugin only for a confirmed test target. */
export function effectiveEngine(data: SiteEngineData | null | undefined): TransferEngine {
  return data?.engine === "plugin" && data.testTarget === true ? "plugin" : "legacy";
}

/** Host name the user types to confirm a switch (`example.com`, `localhost:8443`); "" when unknown. */
export function confirmationHost(origin: string | null | undefined): string {
  if (!origin) return "";
  try {
    const url = new URL(/^[a-z][a-z0-9+.-]*:\/\//i.test(origin) ? origin : `https://${origin}`);
    return url.host.toLowerCase();
  } catch { return ""; }
}

/** Switching to the plugin engine needs both the explicit acknowledgement and the exact host name. */
export function pluginSwitchConfirmed({ host, typed, acknowledged }: { host: string; typed: string; acknowledged: boolean }) {
  return acknowledged && host.length > 0 && typed.trim().toLowerCase() === host;
}

/**
 * The record to commit. Plugin requires the explicit test-target confirmation; switching back to
 * legacy also clears `testTarget`, so a later switch asks for the confirmation again.
 */
export function siteEngineRecord(input: { siteId: string; engine: TransferEngine; testTargetConfirmed?: boolean; label?: string; origin?: string | null; now?: Date }): EngineCatalogRecord<SiteEngineData> {
  if (!ENGINE_SITE_ID.test(input.siteId)) throw new Error("This site cannot use the plugin engine.");
  if (input.engine === "plugin" && input.testTargetConfirmed !== true) throw new Error("Confirm that this is a non-production test site first.");
  const now = (input.now ?? new Date()).toISOString();
  const label = input.label?.trim().slice(0, 200);
  const plugin = input.engine === "plugin";
  return {
    id: engineRecordId(input.siteId), kind: SITE_ENGINE_KIND,
    title: (label || input.siteId).slice(0, 200),
    data: {
      v: 1, siteId: input.siteId, engine: input.engine, testTarget: plugin,
      ...(label ? { label } : {}), ...(input.origin ? { origin: input.origin.slice(0, 2048) } : {}),
      ...(plugin ? { confirmedAt: now } : {}), updatedAt: now,
    },
  };
}
