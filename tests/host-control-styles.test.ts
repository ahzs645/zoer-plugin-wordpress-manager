import { expect, test } from "bun:test";
import { readFileSync } from "node:fs";

// The plugin stylesheet is @scope'd, so its own utilities beat Zoer's unscoped ones. Host shared
// controls need their single-side and responsive overrides generated here too (search icon
// padding, select chevron padding, compact desktop heights).
test("host control overrides are generated inside the plugin scope", () => {
  const css = readFileSync(new URL("../src/styles.css", import.meta.url), "utf8");
  const inline = css.match(/@source inline\("([^"]+)"\)/)?.[1].split(/\s+/) ?? [];
  for (const cls of ["pl-7", "pl-9", "sm:pl-8", "left-3", "sm:left-2.5", "pr-9", "pr-6", "sm:h-8", "sm:h-9", "sm:min-w-8", "sm:min-w-9", "sm:px-3", "min-h-0"]) expect(inline).toContain(cls);
});
