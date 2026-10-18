/** Readable names and labels for what WordPress and the transfer engine report by ID or slug. */

const KNOWN_NAMES: Record<string, string> = {
  akismet: "Akismet",
  hello: "Hello Dolly",
  "hello-dolly": "Hello Dolly",
  updraftplus: "UpdraftPlus",
  woocommerce: "WooCommerce",
  "wordpress-seo": "Yoast SEO",
  "contact-form-7": "Contact Form 7",
  "litespeed-cache": "LiteSpeed Cache",
  "wp-mail-smtp": "WP Mail SMTP",
  elementor: "Elementor",
  jetpack: "Jetpack",
  wordfence: "Wordfence Security",
  "hostinger": "Hostinger Tools",
  "zoer-connect": "Zoer Connect",
  "zoer-local-copy": "Zoer Local Copy",
};

const NUMBERS: Record<string, string> = {
  ten: "Ten", eleven: "Eleven", twelve: "Twelve", thirteen: "Thirteen", fourteen: "Fourteen", fifteen: "Fifteen",
  sixteen: "Sixteen", seventeen: "Seventeen", nineteen: "Nineteen", twenty: "Twenty",
  twentyone: "Twenty-One", twentytwo: "Twenty-Two", twentythree: "Twenty-Three", twentyfour: "Twenty-Four", twentyfive: "Twenty-Five", twentysix: "Twenty-Six",
};

const titleWord = (word: string) => word ? word.charAt(0).toUpperCase() + word.slice(1) : word;

/**
 * The name to show for an installed plugin or theme. Sites that report only the slug as its name
 * get a readable version of it: known plugins by their published names, the default
 * "twentytwentyfive" themes as "Twenty Twenty-Five", anything else in title case.
 */
export function extensionDisplayName(name: string | null | undefined, slug: string) {
  if (name && name.trim() && name !== slug) return name;
  if (KNOWN_NAMES[slug]) return KNOWN_NAMES[slug];
  const twenty = /^twenty([a-z]+?)(-.+)?$/.exec(slug);
  if (twenty && NUMBERS[twenty[1]!]) return [`Twenty ${NUMBERS[twenty[1]!]}`, ...(twenty[2] ?? "").split("-").filter(Boolean).map(titleWord)].join(" ");
  return slug.split(/[-_]/).filter(Boolean).map(titleWord).join(" ");
}

const ACTIONS: Record<string, string> = { activate: "activate", deactivate: "deactivate", update: "update", install: "install", uninstall: "delete", delete: "delete" };

/**
 * A recovery point's label. The engine names copy restores points "before-copy-<id>" and
 * extension changes "Before plugin activate"; neither says much on its own.
 */
export function recoveryPointLabel(name: string | null | undefined) {
  const text = (name ?? "").replace(/\s*\d{4}-\d{2}-\d{2}T[\d:.]+Z?$/, "").trim();
  if (/^before-copy-[0-9a-f]+$/i.test(text)) return "Before refreshing from live";
  if (/^before-restore-[0-9a-f]+$/i.test(text)) return "Before restoring a backup";
  if (/^before-core-update/i.test(text)) return "Before WordPress update";
  const change = /^before (plugin|theme) (\w+)(?::\s*(.+))?$/i.exec(text);
  if (change) return `Before ${change[1]!.toLowerCase()} ${ACTIONS[change[2]!.toLowerCase()] ?? change[2]!.toLowerCase()}${change[3] ? `: ${change[3]}` : ""}`;
  return text || "Recovery point";
}

const BYTES = ["B", "KB", "MB", "GB", "TB"];
function readableBytes(bytes: number) {
  const index = Math.min(BYTES.length - 1, Math.max(0, Math.floor(Math.log10(Math.max(bytes, 1)) / 3)));
  return `${(bytes / 1000 ** index).toFixed(index ? 1 : 0)} ${BYTES[index]}`;
}

/** Transfer summaries from the worker: "1 files (45,777,127 bytes) exported" → "1 file (45.8 MB) exported". */
export function tidyTransferSummary(summary: string) {
  return summary
    .replace(/\((\d[\d,]*) bytes\)/g, (_, digits: string) => `(${readableBytes(Number(digits.replaceAll(",", "")))})`)
    .replace(/\b1 files\b/g, "1 file");
}

/** A host name for a site address, without the scheme, port or trailing slash. */
export function siteAddressHost(value: string | null | undefined) {
  if (!value) return "";
  try { return new URL(value.includes("://") ? value : `https://${value}`).hostname; } catch { return value; }
}
