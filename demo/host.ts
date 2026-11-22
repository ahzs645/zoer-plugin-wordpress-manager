import type { WordPressManagedSite, WordPressSiteDetails } from "@zoer/api-types";
import type { NativeHost } from "../src/host/bridge";

const siteId = "playground-demo-wordpress";
const origin = "http://127.0.0.1:9417";
const displayNameKey = "zoer.demo.playground.displayName";
const unavailableMessage = "The local WordPress sample is unavailable.";

export async function fetchPlaygroundMetadata() {
  // Read public metadata without triggering Playground's first-visit admin redirect.
  const options = {
    headers: { Cookie: "playground_auto_login_already_happened=1" },
    signal: AbortSignal.timeout(6000),
    redirect: "error" as const,
  };
  const [index, feed] = await Promise.all([
    fetch(`${origin}/?rest_route=/&_fields=name`, options),
    fetch(`${origin}/?feed=rss2`, options),
  ]);
  if (!index.ok) throw new Error(unavailableMessage);
  const { name } = await index.json() as { name?: unknown };
  if (typeof name !== "string") throw new Error(unavailableMessage);
  const xml = feed.ok ? await feed.text() : "";
  const wordpressVersion = /<generator>https?:\/\/wordpress\.org\/\?v=([\w.-]+)<\/generator>/.exec(xml)?.[1] ?? null;
  const phpVersion = index.headers.get("x-powered-by")?.match(/^PHP\/([\w.-]+)$/)?.[1] ?? null;
  return { name, wordpressVersion, phpVersion };
}

export function createPlaygroundDemo({ metadataUrl, storage, canAccessWorkspace }: {
  metadataUrl: string;
  storage: Pick<Storage, "getItem" | "setItem">;
  canAccessWorkspace: () => boolean;
}) {
  async function loadSite(): Promise<WordPressManagedSite> {
    const response = await fetch(metadataUrl, { credentials: "omit", cache: "no-store", signal: AbortSignal.timeout(8000) });
    if (!response.ok) throw new Error(unavailableMessage);
    const metadata = await response.json() as Awaited<ReturnType<typeof fetchPlaygroundMetadata>>;
    if (typeof metadata.name !== "string") throw new Error(unavailableMessage);
    return {
      id: siteId, name: storage.getItem(displayNameKey) || metadata.name,
      provider: "playground", environment: "playground", status: "running",
      url: origin, managedUrl: origin, domain: null, subdomain: null, connectionId: null,
      username: null, softwareId: null, wordpressVersion: metadata.wordpressVersion, phpVersion: metadata.phpVersion,
      vulnerabilities: null, updates: null,
      capabilities: { admin: true, preview: true, extensions: false, backups: false, deploySource: false, deployTarget: false, siteHealth: false, rollback: false },
      limitation: "Open WordPress admin to edit the sample’s pages, posts and settings.",
    };
  }

  const host: NativeHost = {
    subscribe: () => () => {},
    async request(method, request) {
      if (!canAccessWorkspace()) throw new Error("Open the local sample as the demo admin.");
      switch (method) {
        case "catalog.list": return { revision: 0, records: [], next: null };
        case "endpoints.list": return { endpoints: [] };
        case "runs.recent": return { runs: [] };
        case "connections.list": return { connections: [] };
      }
      if (method === "api.request" && request && typeof request === "object" && "path" in request && typeof request.path === "string") {
        const input = request as { path: string; method?: string; body?: { name?: unknown } };
        const path = input.path.split("?")[0];
        if ((input.method ?? "GET") === "GET") {
          switch (path) {
            case "/wordpress-manager/workspace/contract": return { version: 1 };
            case "/wordpress-manager/workspace/connectors": return { connectors: [] };
            case "/wordpress-manager/sites": return { sites: [await loadSite()] };
            case "/wordpress-manager/security-sites": return { sites: [] };
            case "/wordpress-manager/connections": return { connections: [] };
            case "/wordpress-manager/deployments": return { deployments: [] };
            case `/wordpress-manager/sites/${siteId}`: {
              const details: WordPressSiteDetails = { site: await loadSite(), plugins: [], themes: [], health: [], backups: [], deployments: [], recoveryPoints: [] };
              return details;
            }
          }
        }
        if (input.method === "POST" && path === `/wordpress-manager/workspace/computers/${siteId}/wordpress-login-handoffs`) {
          return { path: `${origin}/wp-admin/` };
        }
        if (input.method === "PATCH" && path === `/wordpress-manager/sites/${siteId}/display-name`) {
          const name = typeof input.body?.name === "string" ? input.body.name.trim() : "";
          if (!name || name.length > 100) throw new Error("Enter a site name of 1 to 100 characters.");
          storage.setItem(displayNameKey, name);
          return { name, managedUrl: origin };
        }
      }
      throw new Error("This operation requires a full Zoer server. Open WordPress admin to edit the local sample.");
    },
  };
  return { host, loadSite };
}
