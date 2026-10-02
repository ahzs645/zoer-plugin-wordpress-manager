/** Parse clipboard text only; never persist or report the pasted credential. */
export function parseWordPressConnectionPaste(text: string): { url: string; key: string } | null {
  if (text.length > 4096) return null;
  const lines = text.trim().split(/\r?\n/).map(line => line.trim()).filter(Boolean);
  if (lines.length !== 2) return null;
  const url = lines[0]!.replace(/^\[https:\/\/[^\]]+\]\((https:\/\/[^\s)]+)\)$/, "$1");
  const key = lines[1]!.replace(/^zc\\_/, "zc_");
  if (!/^zc_[a-f0-9]{64}$/.test(key) || url.length > 2048) return null;
  try {
    const parsed = new URL(url);
    if (parsed.protocol !== "https:" || parsed.username || parsed.password || parsed.port || parsed.search || parsed.hash || /[%\\\s]/.test(url)) return null;
    return { url: parsed.href.replace(/\/+$/, ""), key };
  } catch { return null; }
}
