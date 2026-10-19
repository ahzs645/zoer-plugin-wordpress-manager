import { describe, expect, test } from "bun:test";
import { ApiError } from "../../lib/api/_http";
import { hostingerRecordFor, hpanelBackupsUrl, recoveryGateFrom, recoveryPointValidUntil } from "./recoveryGate";

describe("recovery gate", () => {
  test("reads the code and details the host sends", () => {
    const error = new ApiError("Record a recovery point first.", 409, undefined, { code: "RECOVERY_POINT_REQUIRED", details: { connectionId: "c1", domain: "example.com", hpanelUrl: "https://hpanel.hostinger.com/websites/example.com", validHours: 24 } });
    expect(recoveryGateFrom(error, null)).toEqual({ connectionId: "c1", domain: "example.com", hpanelUrl: "https://hpanel.hostinger.com/websites/example.com", validHours: 24 });
  });

  test("reads a flat error body kept on the error", () => {
    const error = Object.assign(new Error("Blocked"), { status: 409, envelope: { error: "Blocked", code: "RECOVERY_POINT_REQUIRED", details: { domain: "a.org" } } });
    expect(recoveryGateFrom(error, { connectionId: "site-conn" })).toMatchObject({ connectionId: "site-conn", domain: "a.org", hpanelUrl: hpanelBackupsUrl("a.org") });
  });

  test("recognises the older host's sentence and fills in from the site", () => {
    const error = new Error("Confirm a completed Hostinger hPanel recovery point from the last 24 hours before updating or uninstalling production extensions.");
    expect(recoveryGateFrom(error, { connectionId: "c2", domain: "b.org" })).toMatchObject({ connectionId: "c2", domain: "b.org", validHours: 24 });
  });

  test("ignores other errors and unsafe links", () => {
    expect(recoveryGateFrom(new Error("Network down"), null)).toBeNull();
    const error = new ApiError("x", 409, undefined, { code: "RECOVERY_POINT_REQUIRED", details: { hpanelUrl: "javascript:alert(1)", domain: "c.org" } });
    expect(recoveryGateFrom(error, null)?.hpanelUrl).toBe(hpanelBackupsUrl("c.org"));
  });

  test("a recovery point counts for 24 hours after it was verified", () => {
    const now = Date.parse("2026-10-18T12:00:00Z");
    expect(recoveryPointValidUntil([{ verifiedAt: "2026-10-18T02:00:00Z" }, { verifiedAt: "2026-10-17T01:00:00Z" }], now)?.toISOString()).toBe("2026-10-19T02:00:00.000Z");
    expect(recoveryPointValidUntil([{ verifiedAt: "2026-10-17T11:00:00Z" }], now)).toBeNull();
    expect(recoveryPointValidUntil([], now)).toBeNull();
  });

  test("finds the Hostinger record behind a combined site", () => {
    const connect = { id: "zc", provider: "zoer-connect", connectionId: null, domain: null };
    const hostinger = { id: "h", provider: "hostinger", connectionId: "c", domain: "d.org" };
    expect(hostingerRecordFor(connect, [connect, hostinger])).toBe(hostinger);
    expect(hostingerRecordFor(connect, [connect])).toBeNull();
  });
});
