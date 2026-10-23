#!/usr/bin/env bun
/** Remote-only fixture management through Zoer's supported file and terminal APIs. */
import { mkdir } from "node:fs/promises";
import { resolve } from "node:path";
import { apiOk } from "./zoer";
import { assertWritableSite } from "./guard";

const SITE = "ddev-zoer-connect-040-source";
const STAGED = "/workspace/.zoer-static-export-qualification.php";
const PRIVATE = "/var/www/.zoer-static-export-qualification/fixture.php";
const [mode = "inspect", label = ""] = process.argv.slice(2);
if (label && !/^[a-zA-Z0-9_-]{1,60}$/.test(label)) throw new Error("Use a short alphanumeric evidence label.");
if (!["stage", "baseline", "setup", "inspect", "cleanup", "remove-script"].includes(mode)) throw new Error("Choose stage, baseline, setup, inspect, cleanup or remove-script.");
assertWritableSite(SITE);
const q = (value: string) => `'${value.replaceAll("'", `'\\''`)}'`;

async function terminal(command: string) {
  const created = await apiOk(`/computers/${SITE}/terminal/sessions`, { body: {} });
  const session = created.session?.id ?? created.id ?? created.sessionId;
  if (typeof session !== "string" || !session) throw new Error("The terminal did not return a session ID.");
  const end = `ZOER_STATIC_COMMAND_END_${crypto.randomUUID().replaceAll("-", "")}`;
  try {
    await apiOk(`/computers/${SITE}/terminal/${encodeURIComponent(session)}/input`, { body: { input: `${command}; printf '\\n${end}:%s\\n' "$?"\n` } });
    const deadline = Date.now() + 120_000;
    while (Date.now() < deadline) {
      const { output, closed } = await apiOk(`/computers/${SITE}/terminal/${encodeURIComponent(session)}/output`);
      const found = String(output).match(new RegExp(`${end}:(\\d+)`));
      if (found) {
        if (Number(found[1]) !== 0) throw new Error(`Fixture command failed: ${String(output).slice(-12000)}`);
        return String(output);
      }
      if (closed) throw new Error("The fixture terminal closed before confirming completion.");
      await Bun.sleep(700);
    }
    throw new Error("The fixture command exceeded two minutes; inspect its terminal before retrying.");
  } finally {
    await apiOk(`/computers/${SITE}/terminal/${encodeURIComponent(session)}`, { method: "DELETE" }).catch(() => undefined);
  }
}

if (mode === "stage") {
  const listed = await apiOk(`/computers/${SITE}/files?path=${encodeURIComponent("/workspace")}`);
  if (!String(listed.output).includes("wp-content")) throw new Error("The selected site's /workspace is not a WordPress root.");
  const content = await Bun.file(resolve(import.meta.dir, "static-export-fixture.php")).text();
  await apiOk(`/computers/${SITE}/files/write`, { body: { path: STAGED, content } });
  const read = await apiOk(`/computers/${SITE}/files/read?path=${encodeURIComponent(STAGED)}`);
  if (read.content.trimEnd() !== content.trimEnd()) throw new Error("The staged fixture source does not match its read-back.");
  console.log(await terminal(`mkdir -p /var/www/.zoer-static-export-qualification && mv -- ${q(STAGED)} ${q(PRIVATE)} && php -l ${q(PRIVATE)}`));
} else if (mode === "remove-script") {
  console.log(await terminal(`rm -f -- ${q(PRIVATE)} && rmdir /var/www/.zoer-static-export-qualification`));
} else {
  const sites = (await apiOk("/wordpress-manager/sites?fresh=1")).sites;
  const site = sites.find((entry: any) => entry.id === SITE);
  if (!site || site.provider !== "ddev" || site.status !== "running") throw new Error("The allowed DDEV source must be running.");
  const home = site.url ?? site.home ?? site.managedUrl;
  if (typeof home !== "string" || !/^https?:\/\//.test(home)) throw new Error("No source URL was found in the selected site's inventory.");
  const output = await terminal(`ZOER_STATIC_FIXTURE_SITE_ID=${q(SITE)} ZOER_STATIC_FIXTURE_HOME=${q(home.replace(/\/$/, ""))} wp eval-file ${q(PRIVATE)} ${q(mode)}`);
  const begin = output.indexOf("ZOER_STATIC_FIXTURE_JSON_BEGIN");
  const end = output.indexOf("ZOER_STATIC_FIXTURE_JSON_END", begin);
  if (begin < 0 || end < 0) throw new Error(`The fixture did not return JSON: ${output.slice(-4000)}`);
  const result = JSON.parse(output.slice(begin + "ZOER_STATIC_FIXTURE_JSON_BEGIN".length, end).trim());
  const directory = resolve(process.env.LIVE_GATE_STATIC_EVIDENCE || resolve(import.meta.dir, ".baseline", "static-export"));
  await mkdir(directory, { recursive: true });
  const file = resolve(directory, `${mode}${label ? "-" + label : ""}.json`);
  if (mode === "baseline" && await Bun.file(file).exists()) throw new Error("That baseline already exists. Use a new evidence label to preserve it.");
  await Bun.write(file, JSON.stringify(result, null, 2) + "\n");
  console.log(JSON.stringify(result, null, 2));
}
