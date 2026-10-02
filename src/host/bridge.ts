/**
 * The Zoer host transport. Zoer renders this module in its own page and passes
 * `host`; every backend call goes through `host.request` so the host can apply
 * the reviewed `workspace:wordpress` scope (see zoer frontend/src/plugins/host-api.ts).
 */
export type NativeHost = {
  request(method: string, input?: unknown): Promise<any>;
  subscribe(listener: (event: string, result: any) => void): () => void;
};

// Zoer rejects more than 8 concurrent requests per workspace; stay under it.
const MAX_IN_FLIGHT = 6;
let bound: NativeHost | undefined;
let inFlight = 0;
const waiting: Array<() => void> = [];

export function bindHost(host: NativeHost) {
  bound = host;
  return () => { if (bound === host) bound = undefined; };
}

async function slot<T>(run: () => Promise<T>): Promise<T> {
  if (inFlight >= MAX_IN_FLIGHT) await new Promise<void>(resolve => waiting.push(resolve));
  inFlight++;
  try { return await run(); }
  finally { inFlight--; waiting.shift()?.(); }
}

export function hostRequest<T = unknown>(method: string, input?: unknown): Promise<T> {
  const host = bound;
  if (!host) return Promise.reject(new Error("Open WordPress inside Zoer."));
  return slot(async () => {
    const result = await host.request(method, input);
    if (bound !== host) throw new Error("The WordPress workspace closed.");
    return result as T;
  });
}

export function subscribeHost(listener: (event: string, result: any) => void) {
  return bound ? bound.subscribe(listener) : () => undefined;
}

export type ApiInit = { method?: string; body?: unknown };

/** JSON request against a Zoer WordPress API path such as `/job-applications`. */
export function api<T>(path: string, init: ApiInit = {}): Promise<T> {
  return hostRequest<T>("api.request", { path, method: init.method ?? "GET", body: init.body });
}

export function apiBlob(path: string): Promise<Blob> {
  return hostRequest<Blob>("api.request", { path, response: "blob" });
}
