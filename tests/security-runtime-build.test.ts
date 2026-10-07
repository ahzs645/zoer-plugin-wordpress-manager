import { expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { verifySecurityRuntime, REVIEWED_RUNTIME_SHA256 } from "../scripts/security-runtime";

const bytes = readFileSync(new URL("../security/runtime/security-runtime.zip", import.meta.url));
const descriptor = JSON.parse(readFileSync(new URL("../security/runtime/security-runtime.json", import.meta.url), "utf8"));

test("committed scanner artifact matches its reviewed bytes, descriptor and pinned source", () => {
  const pin = Bun.spawnSync(["git", "ls-files", "--stage", "--", "security/zoer-wordpress-security"]).stdout.toString().split(" ")[1];
  expect(() => verifySecurityRuntime(bytes, descriptor, pin)).not.toThrow();
  expect(descriptor.runtimeSha256).toBe(REVIEWED_RUNTIME_SHA256);
});

test("scanner packaging refuses changed bytes, size, descriptor digest or source pin", () => {
  const corrupt = Buffer.from(bytes); corrupt[corrupt.length - 1] ^= 1;
  expect(() => verifySecurityRuntime(corrupt, descriptor, descriptor.sourceCommit)).toThrow("SHA-256");
  expect(() => verifySecurityRuntime(bytes.subarray(1), descriptor, descriptor.sourceCommit)).toThrow("size");
  expect(() => verifySecurityRuntime(bytes, { ...descriptor, runtimeSha256: "0".repeat(64) }, descriptor.sourceCommit)).toThrow("SHA-256");
  expect(() => verifySecurityRuntime(bytes, descriptor, "0".repeat(40))).toThrow("sourceCommit");
  expect(() => verifySecurityRuntime(bytes, descriptor, "")).toThrow("sourceCommit");
});
