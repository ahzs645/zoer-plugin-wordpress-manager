import { describe, expect, test } from "bun:test";
import { isLocalWordPress, wordpressLifecycleAction } from "./wordpressLifecycle";

describe("WordPress lifecycle controls", () => {
  test("local DDEV and Playground offer explicit start/stop only in known states", () => {
    for (const site of [{ provider: "ddev", environment: "local" }, { provider: "playground", environment: "playground" }] as const) {
      expect(isLocalWordPress(site)).toBe(true);
      expect(wordpressLifecycleAction({ ...site, status: "running" })).toBe("stop");
      for (const status of ["stopped", "exited", "created"]) expect(wordpressLifecycleAction({ ...site, status })).toBe("start");
      for (const status of ["starting", "error", "unknown"]) expect(wordpressLifecycleAction({ ...site, status })).toBeNull();
    }
  });
  test("production and external providers never inherit runtime mutations", () => {
    for (const provider of ["hostinger", "zoer-connect", "ddev", "playground"] as const) {
      expect(wordpressLifecycleAction({ provider, environment: "production", status: "running" })).toBeNull();
      expect(wordpressLifecycleAction({ provider, environment: "production", status: "stopped" })).toBeNull();
    }
    expect(wordpressLifecycleAction({ provider: "hostinger", environment: "local", status: "running" })).toBeNull();
  });
});
