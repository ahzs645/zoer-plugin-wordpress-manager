import { describe, expect, test } from "bun:test";
import { parseWordPressConnectionPaste } from "./wordpressConnectionPaste";

const key = `zc_${"a".repeat(64)}`;
describe("Zoer Connect clipboard details", () => {
  test("detects the site from WordPress plain text, including Windows line endings", () => {
    expect(parseWordPressConnectionPaste(`  https://example.com/blog/\r\n${key}\r\n`))
      .toEqual({ url: "https://example.com/blog", key });
  });
  test("accepts details copied as a Markdown link and escaped key", () => {
    expect(parseWordPressConnectionPaste(`[https://example.com](https://example.com)\nzc\\_${"a".repeat(64)}`))
      .toEqual({ url: "https://example.com", key });
  });
  test("cannot infer a website from a key alone or incomplete details", () => {
    for (const text of [key, "https://example.com", `https://example.com\nzc_abc`, `https://example.com\n${key}\nextra`, "x".repeat(4097)]) {
      expect(parseWordPressConnectionPaste(text)).toBeNull();
    }
  });
  test("rejects addresses the connector cannot securely verify", () => {
    for (const url of ["http://example.com", "https://user:pass@example.com", "https://example.com?secret=1", "https://example.com#fragment", "https://example.com:8443", "https://example.com\\other"]) {
      expect(parseWordPressConnectionPaste(`${url}\n${key}`)).toBeNull();
    }
  });
});
