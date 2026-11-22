import { expect, test } from "bun:test";
import { createPlaygroundDemo } from "../demo/host";

test("the Playground fixture supports sample reads, rename and admin handoff only", async () => {
  const values = new Map<string, string>();
  let admin = true;
  const metadata = { name: "Sample WordPress", wordpressVersion: "6.9", phpVersion: "8.3" };
  const { host, loadSite } = createPlaygroundDemo({
    metadataUrl: `data:application/json,${encodeURIComponent(JSON.stringify(metadata))}`,
    storage: { getItem: key => values.get(key) ?? null, setItem: (key, value) => { values.set(key, value); } },
    canAccessWorkspace: () => admin,
  });
  const { sites: [site] } = await host.request("api.request", { path: "/wordpress-manager/sites?fresh=1" });
  expect(site).toMatchObject({ ...metadata, provider: "playground", capabilities: { admin: true, backups: false } });
  const sitePath = `/wordpress-manager/sites/${site.id}`;
  expect(await host.request("api.request", { path: `${sitePath}?section=overview` })).toMatchObject({ site, health: [] });
  expect(await host.request("api.request", {
    path: `/wordpress-manager/workspace/computers/${site.id}/wordpress-login-handoffs`, method: "POST",
  })).toEqual({ path: "http://127.0.0.1:9417/wp-admin/" });
  await host.request("api.request", { path: `${sitePath}/display-name`, method: "PATCH", body: { name: " My sample " } });
  expect((await loadSite()).name).toBe("My sample");
  await expect(host.request("api.request", { path: `${sitePath}/display-name`, method: "PATCH", body: { name: " " } })).rejects.toThrow("1 to 100 characters");
  await expect(host.request("api.request", { path: `${sitePath}/portable-backups`, method: "POST" })).rejects.toThrow("requires a full Zoer server");
  admin = false;
  await expect(host.request("api.request", { path: sitePath })).rejects.toThrow("demo admin");
});
