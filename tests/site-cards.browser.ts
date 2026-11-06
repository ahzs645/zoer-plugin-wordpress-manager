// Run after `bun run build`: bun tests/site-cards.browser.ts
import { chromium } from "playwright";
import { resolve } from "node:path";
import { strict as assert } from "node:assert";

const bundle = await Bun.build({ entrypoints: [resolve("tests/browser/site-cards.tsx")], target: "browser", define: { "process.env.NODE_ENV": '"production"' } });
if (!bundle.success) throw new Error(bundle.logs.join("\n"));
const script = await bundle.outputs[0]!.text();
const css = await Bun.file("dist/package/native/style.css").text();
const server = Bun.serve({ port: 0, hostname: "127.0.0.1", fetch(request) {
  const path = new URL(request.url).pathname;
  if (path === "/fixture.js") return new Response(script, { headers: { "Content-Type": "text/javascript" } });
  if (path === "/style.css") return new Response(css, { headers: { "Content-Type": "text/css" } });
  return new Response('<!doctype html><html><head><link rel="stylesheet" href="/style.css"><style>:root{--surface-primary:#fff;--border-default:#ccc;--text-primary:#222;--text-muted:#555;--accent:#1473ce;--input-focus:#1473ce}</style></head><body><div id="root"></div><script src="/fixture.js"></script></body></html>', { headers: { "Content-Type": "text/html" } });
} });
const browser = await chromium.launch({ headless: true, executablePath: process.env.CHROMIUM_PATH || "/usr/bin/chromium", args: ["--no-sandbox"] });
try {
  const context = await browser.newContext();
  const page = await context.newPage();
  const errors: string[] = [];
  page.on("pageerror", error => errors.push(error.message));
  const ids = () => page.locator("[data-site-card-id]").evaluateAll(cards => cards.map(card => card.getAttribute("data-site-card-id")));
  await page.goto(server.url.href);
  await page.getByRole("button", { name: "Collapse Alpha", exact: true }).click();
  assert.equal(await page.getByLabel("Alpha draft").isVisible(), false);
  await page.reload();
  await page.getByRole("button", { name: "Expand Alpha", exact: true }).click();
  await page.getByLabel("Alpha draft").fill("Unsaved draft survives collapse");
  await page.getByRole("button", { name: "Collapse Alpha", exact: true }).click();
  await page.getByRole("button", { name: "Expand Alpha", exact: true }).click();
  assert.equal(await page.getByLabel("Alpha draft").inputValue(), "Unsaved draft survives collapse");

  const handle = page.getByRole("button", { name: "Reorder Gamma", exact: true });
  await handle.focus(); await page.keyboard.press("ArrowUp");
  assert.deepEqual(await ids(), ["Alpha", "Gamma", "Beta"]);
  assert.equal(await handle.evaluate(element => element === document.activeElement), true);
  await page.reload();
  await page.getByRole("button", { name: "Reorder Gamma", exact: true }).waitFor();
  assert.deepEqual(await ids(), ["Alpha", "Gamma", "Beta"]);

  const drag = async (cancel = false) => {
    const grip = await page.getByRole("button", { name: "Reorder Beta", exact: true }).boundingBox();
    const first = await page.locator('[data-site-card-id="Alpha"]').boundingBox();
    assert.ok(grip && first);
    await page.mouse.move(grip.x + grip.width / 2, grip.y + grip.height / 2);
    await page.mouse.down();
    await page.mouse.move(first.x + 12, first.y + 4, { steps: 12 });
    if (cancel) await page.keyboard.press("Escape");
    await page.mouse.up();
  };
  await drag(true); assert.deepEqual(await ids(), ["Alpha", "Gamma", "Beta"]);
  await drag(); assert.deepEqual(await ids(), ["Beta", "Alpha", "Gamma"]);
  await page.reload();
  await page.getByRole("button", { name: "Reorder Beta", exact: true }).waitFor();
  assert.deepEqual(await ids(), ["Beta", "Alpha", "Gamma"]);
  // Reordering a filtered subset must retain the omitted card after clearing the filter.
  await page.getByLabel("Filter cards").fill("Alpha,Gamma");
  assert.deepEqual(await ids(), ["Alpha", "Gamma"]);
  await page.getByRole("button", { name: "Reorder Gamma", exact: true }).focus();
  await page.keyboard.press("ArrowUp");
  await page.getByLabel("Filter cards").fill("");
  assert.deepEqual(await ids(), ["Beta", "Gamma", "Alpha"]);

  const touchPage = await context.newPage();
  await touchPage.goto(server.url.href);
  // Pointer events exercise the same handler for touch and pen without native HTML drag support.
  await touchPage.evaluate(() => {
    const grip = document.querySelector<HTMLButtonElement>('[aria-label="Reorder Alpha"]')!;
    const target = document.querySelector<HTMLElement>('[data-site-card-id="Beta"]')!.getBoundingClientRect();
    const start = grip.getBoundingClientRect();
    // Real pointer capture requires an active hardware pointer; leave capture to the mouse test above.
    grip.setPointerCapture = () => {};
    const init = { bubbles: true, pointerId: 7, pointerType: "touch", isPrimary: true, button: 0 };
    grip.dispatchEvent(new PointerEvent("pointerdown", { ...init, clientX: start.x, clientY: start.y }));
    grip.dispatchEvent(new PointerEvent("pointermove", { ...init, clientX: target.x, clientY: target.y + 2 }));
    grip.dispatchEvent(new PointerEvent("pointerup", init));
  });
  assert.deepEqual(await touchPage.locator("[data-site-card-id]").evaluateAll(cards => cards.map(card => card.getAttribute("data-site-card-id"))), ["Alpha", "Beta", "Gamma"]);
  assert.deepEqual(errors, []);
  console.log("PASS component browser checks: collapse/reload, retained form state, keyboard/focus, mouse drag/reload, Escape, filtering, touch-pointer handling.");
} finally { await browser.close(); server.stop(true); }
