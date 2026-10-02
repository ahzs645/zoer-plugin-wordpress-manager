import type { ReplacementRow } from "../api/types/wordpress-transfer";

export type RowCheck = { ok: true; warning?: string } | { ok: false; error: string };
export type ParsedPattern = { ok: true; delimiter: string; body: string; flags: string; warning?: string } | { ok: false; error: string };

const BRACKETS: Record<string, string> = { "(": ")", "[": "]", "{": "}", "<": ">" };
/** PHP preg modifiers. `e` was removed from PHP and is rejected explicitly. */
const PCRE_FLAGS = new Set("imsxuUXJADSn".split(""));
/** Constructs PCRE accepts that a browser RegExp cannot compile. */
const PCRE_ONLY = /\(\?>|[+*?}]\+|\\[AzZhHKGR]|\(\?[imsxUXJ-]+\)|\(\?R\)|\(\?P[<=>]|\(\*[A-Z]|\[\[:|\(\?\||\(\?&|\(\?\d|\\[pP]\{\^?\w+\}/;

function unescapedIndex(body: string, char: string) {
  for (let i = 0; i < body.length; i++) {
    if (body[i] === "\\") { i++; continue; }
    if (body[i] === char) return i;
  }
  return -1;
}

/** Parses a PCRE pattern written with delimiters, e.g. `/wp-content\/(\d+)/i` or `#https?://old#`. */
export function parseRegexPattern(pattern: string): ParsedPattern {
  if (!pattern) return { ok: false, error: "Enter a pattern such as /old-(\\d+)/i." };
  const delimiter = pattern[0];
  if (/[A-Za-z0-9\\\s]/.test(delimiter)) return { ok: false, error: "Start the pattern with a delimiter such as / or #, for example /old-(\\d+)/i." };
  const closing = BRACKETS[delimiter] ?? delimiter;
  const end = pattern.lastIndexOf(closing);
  if (end <= 0) return { ok: false, error: `Close the pattern with ${closing} and optional flags.` };
  const body = pattern.slice(1, end);
  const flags = pattern.slice(end + 1);
  if (!body) return { ok: false, error: "The pattern between the delimiters is empty." };
  const unknown = [...flags].filter(flag => !PCRE_FLAGS.has(flag));
  if (unknown.length) return { ok: false, error: unknown.includes("e") ? "The e flag is not supported." : `Unknown flag${unknown.length > 1 ? "s" : ""}: ${[...new Set(unknown)].join("")}. Use i, m, s, x or u.` };
  if (new Set(flags).size !== flags.length) return { ok: false, error: "Each flag may appear once." };
  if (!BRACKETS[delimiter] && unescapedIndex(body, delimiter) >= 0) return { ok: false, error: `Escape ${delimiter} inside the pattern as \\${delimiter}, or use a different delimiter.` };
  if (flags.includes("x")) return { ok: true, delimiter, body, flags, warning: "Extended (x) patterns are checked on the destination before anything changes." };
  try {
    new RegExp(body, [...flags].filter(flag => "imsu".includes(flag)).join(""));
    return { ok: true, delimiter, body, flags };
  } catch (error) {
    if (PCRE_ONLY.test(body)) return { ok: true, delimiter, body, flags, warning: "Uses PCRE syntax the browser cannot check; the destination validates it before anything changes." };
    const message = error instanceof Error ? error.message.replace(/^Invalid regular expression: /, "").replace(/^\/.*\/[a-z]*: /, "") : "invalid pattern";
    return { ok: false, error: `Invalid pattern: ${message}.` };
  }
}

export const MAX_REGEX_BYTES = 500;

export function validateReplacementRow(row: ReplacementRow): RowCheck {
  if (!row.find) return { ok: false, error: "Enter text to find." };
  if (row.find.length > 4096 || row.replace.length > 4096) return { ok: false, error: "Find and replace values are limited to 4,096 characters." };
  if (row.regex) {
    // Zoer Connect refuses regex patterns over 500 bytes.
    if (new TextEncoder().encode(row.find).length > MAX_REGEX_BYTES) return { ok: false, error: `Regular expressions are limited to ${MAX_REGEX_BYTES} characters.` };
    const parsed = parseRegexPattern(row.find);
    if (!parsed.ok) return parsed;
    return parsed.warning ? { ok: true, warning: parsed.warning } : { ok: true };
  }
  if (row.find === row.replace) return { ok: true, warning: "Find and replace are identical; this row changes nothing." };
  return { ok: true };
}
