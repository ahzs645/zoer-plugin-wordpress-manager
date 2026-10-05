#!/usr/bin/env bun
/**
 * Read-only Playwright smoke check of the WordPress Manager UI on the live Zoer, at 1440×900 and
 * 390×844. Opens pages and dialogs and closes them; never confirms anything. Records page errors,
 * console errors, `/api` answers ≥ 400, calls to Zoer's removed legacy transfer routes and every
 * non-GET `/api` request (there should be none apart from catalog reads and run polling).
 *
 *   bun tools/live-gate/ui-smoke.ts [--site ddev-zoer-connect-040-destination] [--tag name] [--hash '#/...' ...]
 *
 * Screenshots go to $LIVE_GATE_SHOTS (default tools/live-gate/.shots/, gitignored). Exits 1 when
 * anything was recorded. Needs `bunx playwright install chromium` once (see the README);
 * LIVE_GATE_BROWSER_CHANNEL=chrome or LIVE_GATE_CHROMIUM_PATH=<binary> uses an installed browser instead.
 */
import { mkdir } from "node:fs/promises";
import { resolve } from "node:path";
import { parseArgs } from "node:util";
import { chromium, type Page } from "playwright";
import { assertNotForbidden, zoerOrigin } from "./guard";

/** Zoer's removed legacy WordPress transfer routes (tests/host-routes.test.ts, as request paths). */
export const LEGACY = /\/wordpress-pulls\b|\/wordpress-transfers\b|\/wordpress-manager\/(?:transfers|local-exports|backup-restores|local-copies|copy-workflows|transfer-profiles)\b|\/connect\/[^/?]+\/(?:pulls|pushes|replacements|diagnostics|local-copies|copy-workflows)\b|download-ticket|wordpress-updraft-imports/;
/** Non-GET requests the UI makes while only reading. */
const READ_POSTS = /\/workspace\/catalog\/(?:list|read)|\/workspace\/runs(?:\?|$)|\/actions\/(?:site\.test|wpcli\.read|[a-z]+\.refresh|sites\.trash|snapshot\.list|backup\.list)\/(?:plan|run)/;

const { values } = parseArgs({
  args: process.argv.slice(2),
  options: { site: { type: "string", default: "ddev-zoer-connect-040-destination" }, tag: { type: "string", default: "smoke" }, hash: { type: "string", multiple: true } },
});
const site = values.site!;
assertNotForbidden(site);
const ORIGIN = zoerOrigin();
const SHOTS = resolve(process.env.LIVE_GATE_SHOTS || resolve(import.meta.dir, ".shots"));
await mkdir(SHOTS, { recursive: true });
const token = process.env.ZOER_TOKEN?.trim();
const wait = Number(process.env.LIVE_GATE_WAIT_MS ?? 8000);

async function go(page: Page, hash: string) {
  await page.goto(`${ORIGIN}/${hash}`, { waitUntil: "domcontentloaded" });
  await page.waitForTimeout(500);
  const cont = page.getByRole("button", { name: /continue to zoer/i });
  if (await cont.count()) await cont.first().click().catch(() => {});
  await page.waitForTimeout(wait);
}

/** Elements that scroll sideways (tab strips are expected and listed separately). */
async function sideways(page: Page) {
  return page.evaluate(() => {
    const vw = document.documentElement.clientWidth;
    const out: string[] = [];
    if (document.documentElement.scrollWidth > vw + 1) out.push(`document ${document.documentElement.scrollWidth} > ${vw}`);
    for (const el of Array.from(document.querySelectorAll<HTMLElement>("body *"))) {
      const cs = getComputedStyle(el);
      if ((cs.overflowX === "auto" || cs.overflowX === "scroll") && el.scrollWidth > el.clientWidth + 1 && el.clientWidth > 0) {
        const cls = typeof el.className === "string" ? el.className.slice(0, 80) : "";
        if (el.getAttribute("role") === "tablist" || /whitespace-nowrap border-b-2/.test(cls)) continue;
        out.push(`${el.tagName}.${cls} ${el.scrollWidth}>${el.clientWidth}`);
      }
    }
    return out.slice(0, 10);
  });
}

const report: any[] = [];
let problems = 0;
for (const size of [{ n: "desk", w: 1440, h: 900 }, { n: "phone", w: 390, h: 844 }]) {
  const mobile = size.w < 600;
  const browser = await chromium.launch({ headless: true, ...(process.env.LIVE_GATE_BROWSER_CHANNEL ? { channel: process.env.LIVE_GATE_BROWSER_CHANNEL } : {}), ...(process.env.LIVE_GATE_CHROMIUM_PATH ? { executablePath: process.env.LIVE_GATE_CHROMIUM_PATH } : {}) });
  const context = await browser.newContext({ viewport: { width: size.w, height: size.h }, deviceScaleFactor: mobile ? 2 : 1, isMobile: mobile, hasTouch: mobile });
  await context.addInitScript(() => { try { sessionStorage.setItem("zoer-open-access-notice-v1", "dismissed"); } catch { /* storage blocked */ } });
  if (token) await context.route(`${ORIGIN}/api/**`, route => route.continue({ headers: { ...route.request().headers(), authorization: `Bearer ${token}` } }));
  const page = await context.newPage();
  const issues = { pageErrors: [] as string[], console: [] as string[], apiErrors: [] as string[], legacy: [] as string[], writes: [] as string[] };
  page.on("pageerror", e => issues.pageErrors.push(String(e.message).slice(0, 300)));
  page.on("console", m => { if (m.type() === "error") issues.console.push(m.text().slice(0, 300)); });
  page.on("response", r => {
    const url = r.url(); if (!url.startsWith(`${ORIGIN}/api/`)) return;
    const path = url.slice(ORIGIN.length); const method = r.request().method();
    if (r.status() >= 400) issues.apiErrors.push(`${r.status()} ${method} ${path}`);
    if (LEGACY.test(path)) issues.legacy.push(`${method} ${path}`);
    if (method !== "GET" && !READ_POSTS.test(path)) issues.writes.push(`${method} ${path}`);
  });
  const shot = async (name: string, extra: Record<string, unknown> = {}) => {
    const path = `${SHOTS}/${values.tag}-${size.n}-${name}.png`;
    await page.waitForTimeout(400);
    await page.screenshot({ path });
    report.push({ size: size.n, name, shot: path, sideways: await sideways(page), ...extra });
  };
  const close = async () => { await page.keyboard.press("Escape"); await page.waitForTimeout(600); };
  const base = `#/plugins/wordpress-manager?site=${encodeURIComponent(site)}`;

  // Site list (on a phone the list is a sheet)
  await go(page, "#/plugins/wordpress-manager");
  if (mobile) {
    const pick = page.getByRole("button", { name: /Show WordPress sites|Select WordPress site/ }).first();
    if (await pick.count()) { await pick.click(); await page.waitForTimeout(1200); }
  }
  await shot("site-list");
  if (mobile) await close();

  // Overview, transfer area and the Transfers dialog
  await go(page, `${base}&tab=overview`); await shot("overview");
  await go(page, `${base}&tab=deployments`); await shot("deployments");
  const transfers = page.getByRole("button", { name: /^(Connect Zoer|Transfers)$/ }).first();
  if (await transfers.count()) {
    await transfers.click(); await page.waitForTimeout(6000);
    const dialog = page.locator("dialog[open], [role=dialog]").first();
    const text = (await dialog.innerText().catch(() => "")).replace(/\n+/g, " | ");
    await shot("transfers-dialog", { opened: !!text, text: text.slice(0, 600) });
    for (let i = 1; i <= 3; i++) { await page.mouse.wheel(0, size.h * 0.8); await page.waitForTimeout(400); await shot(`transfers-dialog-${i}`); }
    await close();
  } else report.push({ size: size.n, name: "transfers-dialog", note: "no Connect Zoer/Transfers button (site stopped or fenced?)" });

  // Transfer history, backups
  await go(page, `${base}&tab=history`);
  const history = await page.evaluate(() => document.body.innerText);
  await shot("history", { earlierEngine: (history.match(/Earlier engine/g) ?? []).length });
  await go(page, `${base}&tab=backups`); await shot("backups");

  // Trash dialog (header button, or the More actions menu on narrow screens)
  let trash = page.getByRole("button", { name: "Trash", exact: true }).first();
  if (!(await trash.isVisible().catch(() => false))) {
    const more = page.getByRole("button", { name: "More actions", exact: true }).first();
    if (await more.count()) { await more.click(); await page.waitForTimeout(600); trash = page.getByRole("menuitem", { name: "Trash" }).or(page.getByRole("button", { name: "Trash", exact: true })).first(); }
  }
  if (await trash.count()) { await trash.click(); await page.waitForTimeout(4000); await shot("trash"); await close(); }
  else report.push({ size: size.n, name: "trash", note: "no Trash button" });

  for (const [i, hash] of (values.hash ?? []).entries()) { await go(page, hash); await shot(`extra-${i + 1}`, { hash }); }

  const writes = [...new Set(issues.writes)];
  report.push({ size: size.n, issues: { ...issues, writes } });
  problems += issues.pageErrors.length + issues.console.length + issues.apiErrors.length + issues.legacy.length + writes.length;
  await browser.close();
}
console.log(JSON.stringify(report, null, 1));
process.exit(problems ? 1 : 0);
