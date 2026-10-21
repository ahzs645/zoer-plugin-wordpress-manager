import { expect, test } from "bun:test";
import { checkedAgo, classifyConnectionError } from "./connectionHealth";

test("classifies failed connection tests", () => {
  expect(classifyConnectionError("WordPress rejected this key. Check its version, key and permissions.")).toBe("rejected");
  expect(classifyConnectionError("Could not verify the connection. Check HTTPS, the certificate and network access.")).toBe("unreachable");
  expect(classifyConnectionError("Zoer Connect was not found. Check the website address and activate the plugin in WordPress.")).toBe("unreachable");
  expect(classifyConnectionError("The destination is busy with another request. Retrying shortly.")).toBeNull();
  expect(classifyConnectionError("A Zoer Connect transfer is changing this site.")).toBeNull();
  expect(classifyConnectionError("")).toBeNull();
});

test("says how long ago a check ran", () => {
  const now = Date.parse("2026-10-20T12:00:00Z");
  expect(checkedAgo(now - 20_000, now)).toBe("just now");
  expect(checkedAgo(now - 4 * 60_000, now)).toBe("4 min ago");
  expect(checkedAgo(now - 3 * 3_600_000, now)).toBe("3 h ago");
});
