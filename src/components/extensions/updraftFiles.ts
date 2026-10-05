import type { WordPressUpdraftComponent } from "../../lib/api/computers-client";

/** The five UpdraftPlus components, in restore order. */
export const COMPONENTS: WordPressUpdraftComponent[] = ["database", "plugins", "themes", "uploads", "others"];

export async function sha256(file: File): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", await file.arrayBuffer());
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, "0")).join("");
}
