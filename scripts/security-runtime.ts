import { createHash } from "node:crypto";
import { cp, mkdir, readFile } from "node:fs/promises";
import { resolve } from "node:path";

export const REVIEWED_RUNTIME_SHA256 = "ab30f7c39fc04e6d5d84437a3c20b2171ece3432b9d348f632bf8cfde3aedc55";
export const REVIEWED_RUNTIME_BYTES = 1193333;
export const REVIEWED_SOURCE_COMMIT = "42b7f5a56be23089de15a7ef96d6df261af818a0";

export function verifySecurityRuntime(bytes: Buffer, descriptor: { sourceCommit?: string; runtimeSha256?: string; bytes?: number }, sourcePin: string): void {
  if (sourcePin !== REVIEWED_SOURCE_COMMIT || descriptor.sourceCommit !== sourcePin) throw new Error("Scanner runtime sourceCommit does not match the reviewed pinned submodule.");
  if (bytes.length !== REVIEWED_RUNTIME_BYTES || descriptor.bytes !== bytes.length) throw new Error("Scanner runtime size does not match the reviewed artifact.");
  const digest = createHash("sha256").update(bytes).digest("hex");
  if (digest !== REVIEWED_RUNTIME_SHA256 || descriptor.runtimeSha256 !== digest) throw new Error("Scanner runtime SHA-256 does not match the reviewed artifact.");
}

/** CI can package the reviewed artifact without private scanner source credentials. */
export async function copySecurityRuntime(root: string, output: string): Promise<void> {
  const component = resolve(root, "security/zoer-wordpress-security");
  const fallback = resolve(root, "security/runtime");
  const pinCommand = Bun.spawn(["git", "ls-files", "--stage", "--", "security/zoer-wordpress-security"], { cwd: root, stdout: "pipe", stderr: "pipe" });
  const pinOutput = await new Response(pinCommand.stdout).text();
  if (await pinCommand.exited !== 0) throw new Error("Could not read the scanner submodule pin.");
  const sourcePin = /^160000 ([a-f0-9]{40}) 0\tsecurity\/zoer-wordpress-security\s*$/.exec(pinOutput)?.[1] ?? "";
  const artifact = await readFile(resolve(fallback, "security-runtime.zip"));
  const descriptorText = await readFile(resolve(fallback, "security-runtime.json"), "utf8");
  const descriptor = JSON.parse(descriptorText);
  verifySecurityRuntime(artifact, descriptor, sourcePin);

  if (await Bun.file(resolve(component, "tools/build-runtime.py")).exists()) {
    const head = Bun.spawn(["git", "rev-parse", "HEAD"], { cwd: component, stdout: "pipe", stderr: "pipe" });
    const commit = (await new Response(head.stdout).text()).trim();
    if (await head.exited !== 0 || commit !== sourcePin) throw new Error("Initialized scanner source does not match the pinned commit.");
    const rebuild = Bun.spawn(["python3", resolve(component, "tools/build-runtime.py")], { cwd: component, stdout: "pipe", stderr: "pipe" });
    // Consume both streams while running so diagnostic output cannot block a rebuild.
    const [status, , stderr] = await Promise.all([rebuild.exited, new Response(rebuild.stdout).text(), new Response(rebuild.stderr).text()]);
    if (status !== 0) throw new Error(`Scanner bundle build failed: ${stderr}`);
    const rebuilt = await readFile(resolve(component, "dist/security-runtime.zip"));
    const rebuiltDescriptor = await readFile(resolve(component, "dist/security-runtime.json"), "utf8");
    verifySecurityRuntime(rebuilt, JSON.parse(rebuiltDescriptor), sourcePin);
    if (!rebuilt.equals(artifact) || rebuiltDescriptor !== descriptorText) throw new Error("Rebuilt scanner differs from the committed reviewed runtime.");
  }
  await mkdir(resolve(output, "computer/wordpress"), { recursive: true });
  await cp(resolve(fallback, "security-runtime.zip"), resolve(output, "computer/wordpress/security-runtime.zip"));
  await cp(resolve(fallback, "security-runtime.json"), resolve(output, "computer/wordpress/security-runtime.json"));
}
