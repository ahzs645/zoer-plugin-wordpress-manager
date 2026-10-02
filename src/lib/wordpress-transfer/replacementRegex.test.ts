import { expect, test } from "bun:test";
import { parseRegexPattern, validateReplacementRow } from "./replacementRegex";

const row = (find: string, regex = true, replace = "x") => ({ find, replace, regex, caseSensitive: true });

test("accepts delimited PCRE patterns with flags", () => {
  expect(parseRegexPattern("/old-(\\d+)/i")).toEqual({ ok: true, delimiter: "/", body: "old-(\\d+)", flags: "i" });
  expect(parseRegexPattern("#https?://old\\.test#")).toMatchObject({ ok: true, delimiter: "#", body: "https?://old\\.test", flags: "" });
  expect(parseRegexPattern("{a/b}u")).toMatchObject({ ok: true, delimiter: "{", body: "a/b", flags: "u" });
  expect(parseRegexPattern("/wp-content\\/uploads/")).toMatchObject({ ok: true });
});

test("rejects missing delimiters, bad flags and unescaped delimiters", () => {
  expect(parseRegexPattern("old-(\\d+)")).toMatchObject({ ok: false });
  expect(parseRegexPattern("/unterminated")).toMatchObject({ ok: false, error: "Close the pattern with / and optional flags." });
  expect(parseRegexPattern("//i")).toMatchObject({ ok: false, error: "The pattern between the delimiters is empty." });
  expect(parseRegexPattern("/a/q")).toMatchObject({ ok: false, error: "Unknown flag: q. Use i, m, s, x or u." });
  expect(parseRegexPattern("/a/e")).toMatchObject({ ok: false, error: "The e flag is not supported." });
  expect(parseRegexPattern("/a/ii")).toMatchObject({ ok: false, error: "Each flag may appear once." });
  expect(parseRegexPattern("/a/b/")).toMatchObject({ ok: false });
  expect(parseRegexPattern("/(unclosed/")).toMatchObject({ ok: false });
});

test("PCRE-only syntax is accepted with a warning instead of a false error", () => {
  const atomic = parseRegexPattern("/(?>foo|bar)\\z/");
  expect(atomic.ok).toBe(true);
  expect(atomic.ok && atomic.warning).toBeTruthy();
  const extended = parseRegexPattern("/ a b # comment\n/x");
  expect(extended.ok && extended.warning).toBeTruthy();
});

test("rows validate literal and regex modes", () => {
  expect(validateReplacementRow(row("", false))).toEqual({ ok: false, error: "Enter text to find." });
  expect(validateReplacementRow(row("same", false, "same"))).toMatchObject({ ok: true, warning: expect.any(String) });
  expect(validateReplacementRow(row("https://old.test", false))).toEqual({ ok: true });
  expect(validateReplacementRow(row("no-delimiters"))).toMatchObject({ ok: false });
  expect(validateReplacementRow(row("/ok/"))).toEqual({ ok: true });
});

test("regex rows are capped at 500 bytes like the plugin", () => {
  expect(validateReplacementRow(row("/" + "a".repeat(497) + "/i"))).toEqual({ ok: true });
  expect(validateReplacementRow(row("/" + "a".repeat(498) + "/i"))).toMatchObject({ ok: false, error: expect.stringContaining("500") });
  expect(validateReplacementRow(row("/" + "é".repeat(250) + "/"))).toMatchObject({ ok: false });
  expect(validateReplacementRow(row("a".repeat(1000), false))).toMatchObject({ ok: true });
});
