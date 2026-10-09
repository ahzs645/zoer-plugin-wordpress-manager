import { afterAll, describe, expect, test } from "bun:test";
import { copyFileSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { Database } from "bun:sqlite";

// Runs the real local importer (plugin/computer/wordpress/import-copy.php) and its replacement rules
// with PHP, against a SQLite stand-in for $wpdb (tests/fakes/wpdb.php).
const BUNDLE = resolve("plugin/computer/wordpress");
const temp = mkdtempSync(join(tmpdir(), "wpm-local-import-"));
afterAll(() => rmSync(temp, { recursive: true, force: true }));

function php(code: string) {
  const proc = Bun.spawnSync(["php", "-d", "memory_limit=512M", "-r", code]);
  if (proc.exitCode !== 0) throw new Error(proc.stderr.toString() || proc.stdout.toString());
  return proc.stdout.toString();
}
const rules = (body: string) => JSON.parse(php(`require ${JSON.stringify(`${BUNDLE}/Replacement.php`)};require ${JSON.stringify(`${BUNDLE}/LocalCopyRules.php`)};use ZoerConnect\\LocalCopyRules;use ZoerConnect\\Replacement;echo json_encode((function(){${body}})());`));
const ser = (value: string) => `s:${Buffer.byteLength(value)}:"${value}";`;

describe("local copy rules", () => {
  test("URL pairs cover both schemes, protocol-relative, JSON-escaped and URL-encoded forms", () => {
    const pairs = rules(`return LocalCopyRules::urlPairs('http://example.com/','https://copy.ddev.site');`);
    expect(pairs).toMatchObject({
      "https://example.com": "https://copy.ddev.site", "http://example.com": "https://copy.ddev.site", "//example.com": "//copy.ddev.site",
      "https:\\/\\/example.com": "https:\\/\\/copy.ddev.site", "\\/\\/example.com": "\\/\\/copy.ddev.site", "https%3A%2F%2Fexample.com": "https%3A%2F%2Fcopy.ddev.site",
    });
  });
  test("one longest-match pass never rewrites a replacement, even when the local address contains the source host", () => {
    const out = rules(`return Replacement::apply('a https://example.com/x b http://example.com c //example.com/i.png d https:\\\\/\\\\/example.com\\\\/j',[['mode'=>'map','pairs'=>LocalCopyRules::urlPairs('https://example.com','https://example.com.ddev.site')]]);`);
    expect(out).toBe("a https://example.com.ddev.site/x b https://example.com.ddev.site c //example.com.ddev.site/i.png d https:\\/\\/example.com.ddev.site\\/j");
  });
  test("large values pass through untouched unless a rule matches; matching values up to 16 MiB are rewritten", () => {
    const out = rules(`$m=[['mode'=>'map','pairs'=>['https://a.test'=>'https://b.test']]];$big=str_repeat('x',3*1048576);
      return [Replacement::apply($big,$m)===$big, strlen(Replacement::apply($big.'https://a.test',$m)), Replacement::apply(serialize(['u'=>'https://a.test/p']),$m)];`);
    expect(out[0]).toBe(true);
    expect(out[1]).toBe(3 * 1048576 + "https://b.test".length);
    expect(out[2]).toBe(`a:1:{s:1:"u";${ser("https://b.test/p")}}`);
  });
  test("user meta: WP Migrate's prefix rule, dropped sessions and application passwords, roles check, free logins", () => {
    const out = rules(`return [LocalCopyRules::userMetaKey('src_capabilities','src_','wp_'),LocalCopyRules::userMetaKey('nickname','src_','wp_'),LocalCopyRules::userMetaKey('wp_capabilities','wp_','wp_'),
      LocalCopyRules::dropUserMeta('session_tokens'),LocalCopyRules::dropUserMeta('_application_passwords'),LocalCopyRules::dropUserMeta('clerk_user_id'),
      LocalCopyRules::rolesHaveAdministrator(serialize(['administrator'=>['name'=>'Administrator','capabilities'=>[]]])),LocalCopyRules::rolesHaveAdministrator(serialize(['editor'=>[]])),
      LocalCopyRules::freeLogin('admin',fn($v)=>in_array($v,['admin','zoer-local-admin'],true))];`);
    expect(out).toEqual(["wp_capabilities", "nickname", "wp_capabilities", true, true, false, true, false, "zoer-local-admin-2"]);
  });
  test("collations the local server lacks take their closest supported one; quoted text and identifiers are left alone", () => {
    const out = rules(`$mariadb=fn($c)=>in_array(strtolower($c),['utf8mb4_bin','utf8mb4_unicode_ci','utf8mb4_unicode_520_ci','utf8mb4_general_ci'],true);
      return [array_map([LocalCopyRules::class,'collationFallbacks'],['utf8mb4_0900_ai_ci','utf8mb4_0900_as_ci','utf8mb4_de_pb_0900_ai_ci','utf8mb4_0900_as_cs','utf8mb4_ja_0900_as_cs_ks','utf8mb4_0900_bin','utf8mb4_unicode_520_ci','utf8mb4_general_ci','latin1_0900_ai_ci']),
        LocalCopyRules::localCollations("(\`a\` text COLLATE utf8mb4_0900_ai_ci DEFAULT 'x COLLATE utf8mb4_0900_ai_ci', \`COLLATE utf8mb4_0900_as_cs\` text CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_as_cs, \`c\` text COLLATE utf8mb4_general_ci) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci",$mariadb),
        LocalCopyRules::localCollations('(\`a\` text) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE utf8mb4_unicode_520_ci',fn($c)=>$c==='utf8mb4_unicode_ci')];`);
    expect(out[0]).toEqual([
      ["utf8mb4_unicode_520_ci", "utf8mb4_unicode_ci"], ["utf8mb4_unicode_520_ci", "utf8mb4_unicode_ci"], ["utf8mb4_unicode_520_ci", "utf8mb4_unicode_ci"],
      ["utf8mb4_bin"], ["utf8mb4_bin"], ["utf8mb4_bin"], ["utf8mb4_unicode_ci"], [], [],
    ]);
    expect(out[1]).toEqual([
      "(`a` text COLLATE utf8mb4_unicode_520_ci DEFAULT 'x COLLATE utf8mb4_0900_ai_ci', `COLLATE utf8mb4_0900_as_cs` text CHARACTER SET utf8mb4 COLLATE utf8mb4_bin, `c` text COLLATE utf8mb4_general_ci) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_520_ci",
      { utf8mb4_0900_ai_ci: "utf8mb4_unicode_520_ci", utf8mb4_0900_as_cs: "utf8mb4_bin" },
    ]);
    expect(out[2]).toEqual(["(`a` text) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE utf8mb4_unicode_ci", { utf8mb4_unicode_520_ci: "utf8mb4_unicode_ci" }]);
    expect(() => rules(`return LocalCopyRules::localCollations('(\`a\` text) ENGINE=InnoDB COLLATE=utf8mb4_0900_ai_ci',fn($c)=>$c==='latin1_swedish_ci');`)).toThrow(/collation utf8mb4_0900_ai_ci/);
  });
});

// ---------------------------------------------------------------------------------------------
// The importer end to end
// ---------------------------------------------------------------------------------------------

type Cell = string | number | null;
const SCHEMAS: Record<string, string> = {
  options: "(`option_id` INTEGER PRIMARY KEY, `option_name` TEXT UNIQUE, `option_value` TEXT, `autoload` TEXT) ENGINE=InnoDB",
  posts: "(`ID` INTEGER PRIMARY KEY, `post_author` INTEGER, `post_content` TEXT, `guid` TEXT) ENGINE=InnoDB",
  comments: "(`comment_ID` INTEGER PRIMARY KEY, `user_id` INTEGER, `comment_content` TEXT) ENGINE=InnoDB",
  users: "(`ID` INTEGER PRIMARY KEY, `user_login` TEXT, `user_pass` TEXT, `user_nicename` TEXT, `user_email` TEXT, `user_url` TEXT) ENGINE=InnoDB",
  usermeta: "(`umeta_id` INTEGER PRIMARY KEY, `user_id` INTEGER, `meta_key` TEXT, `meta_value` TEXT) ENGINE=InnoDB",
  clerk_links: "(`id` INTEGER PRIMARY KEY, `user_id` INTEGER, `clerk_id` TEXT) ENGINE=InnoDB",
};
const hex = (value: Cell) => value === null ? "NULL" : `X'${Buffer.from(String(value)).toString("hex")}'`;
function snapshot(prefix: string, tables: Record<string, Record<string, Cell>[]>, schemas = SCHEMAS) {
  let out = "-- Zoer Connect database snapshot\nSET NAMES utf8mb4;\nSET FOREIGN_KEY_CHECKS=0;\nSET SQL_MODE='NO_AUTO_VALUE_ON_ZERO';\n";
  for (const [suffix, rows] of Object.entries(tables)) {
    out += `DROP TABLE IF EXISTS \`${prefix}${suffix}\`;\nCREATE TABLE \`${prefix}${suffix}\` ${schemas[suffix]};\n`;
    for (const row of rows) out += `INSERT INTO \`${prefix}${suffix}\` (${Object.keys(row).map(c => `\`${c}\``).join(",")}) VALUES (${Object.values(row).map(hex).join(",")});\n`;
  }
  return out + "SET FOREIGN_KEY_CHECKS=1;\n";
}

const ADMIN_CAPS = 'a:1:{s:13:"administrator";b:1;}';
const LOCAL_ROLES = 'a:1:{s:13:"administrator";a:2:{s:4:"name";s:13:"Administrator";s:12:"capabilities";a:0:{}}}';
const SOURCE_ROLES = 'a:2:{s:13:"administrator";a:2:{s:4:"name";s:13:"Administrator";s:12:"capabilities";a:0:{}}s:6:"player";a:2:{s:4:"name";s:6:"Player";s:12:"capabilities";a:0:{}}}';
const WIDGET = `a:1:{s:3:"url";${ser("https://example.com/a/b")}}`;
const LOCAL_URL = "https://example.com.ddev.site";

/** A fresh DDEV-like local site: one administrator, its own options and empty content tables. */
function localSite(path: string) {
  const db = new Database(path);
  for (const [suffix, schema] of Object.entries(SCHEMAS)) if (suffix !== "clerk_links") db.run(`CREATE TABLE wp_${suffix} ${schema.replace(/\) ENGINE=InnoDB$/, ")")}`);
  db.run("INSERT INTO wp_users VALUES (1,'admin','$local','admin','admin@example.com','')");
  db.run(`INSERT INTO wp_usermeta (user_id,meta_key,meta_value) VALUES (1,'wp_capabilities',?),(1,'wp_user_level','10'),(1,'session_tokens','local-session'),(1,'nickname','admin')`, [ADMIN_CAPS]);
  const options = [["home", LOCAL_URL], ["siteurl", LOCAL_URL], ["admin_email", "local@example.test"], ["wp_user_roles", LOCAL_ROLES], ["blog_public", "1"], ["active_plugins", "a:0:{}"], ["cron", "a:0:{}"]];
  for (const [name, value] of options) db.run("INSERT INTO wp_options (option_name,option_value,autoload) VALUES (?,?,'yes')", [name, value]);
  db.close();
}

function source(prefix: string, schemas = SCHEMAS) {
  const big = "x".repeat(2 * 1048576);
  return snapshot(prefix, {
    options: [
      { option_id: 1, option_name: "home", option_value: "https://example.com", autoload: "yes" },
      { option_id: 2, option_name: "siteurl", option_value: "https://example.com", autoload: "yes" },
      { option_id: 3, option_name: `${prefix}user_roles`, option_value: SOURCE_ROLES, autoload: "yes" },
      { option_id: 4, option_name: "blog_public", option_value: "1", autoload: "yes" },
      { option_id: 5, option_name: "active_plugins", option_value: 'a:1:{i:0;s:9:"clerk.php";}', autoload: "yes" },
      { option_id: 6, option_name: "widget_links", option_value: WIDGET, autoload: "yes" },
      { option_id: 7, option_name: "_transient_cache", option_value: "stale", autoload: "no" },
    ],
    posts: [
      { ID: 1, post_author: 2, post_content: 'Visit https://example.com/page, http://example.com, //example.com/i.png and {"u":"https:\\/\\/example.com\\/x"}', guid: "https://example.com/?p=1" },
      { ID: 2, post_author: 3, post_content: big, guid: "https://example.com/?p=2" },
      { ID: 3, post_author: 3, post_content: `${big} https://example.com/end`, guid: "https://example.com/?p=3" },
    ],
    comments: [{ comment_ID: 1, user_id: 3, comment_content: "Nice" }],
    users: [
      { ID: 1, user_login: "admin", user_pass: "$source1", user_nicename: "admin", user_email: "admin@example.com", user_url: "https://example.com" },
      { ID: 2, user_login: "jane", user_pass: "$source2", user_nicename: "jane", user_email: "jane@example.com", user_url: "" },
      { ID: 3, user_login: "player1", user_pass: "$source3", user_nicename: "player1", user_email: "p1@example.com", user_url: "" },
    ],
    usermeta: [
      { umeta_id: 1, user_id: 1, meta_key: `${prefix}capabilities`, meta_value: ADMIN_CAPS },
      { umeta_id: 2, user_id: 2, meta_key: `${prefix}capabilities`, meta_value: 'a:1:{s:6:"editor";b:1;}' },
      { umeta_id: 3, user_id: 3, meta_key: `${prefix}capabilities`, meta_value: 'a:1:{s:6:"player";b:1;}' },
      { umeta_id: 4, user_id: 2, meta_key: "session_tokens", meta_value: "prod-session" },
      { umeta_id: 5, user_id: 3, meta_key: "_application_passwords", meta_value: "prod-app-password" },
      { umeta_id: 6, user_id: 3, meta_key: "clerk_user_id", meta_value: "user_abc" },
      { umeta_id: 7, user_id: 2, meta_key: `${prefix}user-settings`, meta_value: "libraryContent=browse" },
    ],
    clerk_links: [{ id: 1, user_id: 3, clerk_id: "user_abc" }],
  }, schemas);
}

let runs = 0;
let lastStage = "";
/**
 * Runs import-copy.php in a stage named after its copy ID, as wordpress.copy.database does, optionally
 * with other source schemas and the collations of another local server.
 */
function importCopy(dbPath: string, prefix: string, users?: "local" | "source" | "exact", options: { schemas?: Record<string, string>; collations?: string[]; edit?: (sql: string) => string } = {}) {
  const id = createHash("md5").update(`copy-${runs++}`).digest("hex");
  const stage = join(temp, "stage", id);
  mkdirSync(stage, { recursive: true });
  lastStage = stage;
  for (const name of ["SnapshotStream.php", "SerializedReplacement.php", "Replacement.php", "LocalCopyRules.php", "import-copy.php"]) copyFileSync(join(BUNDLE, name), join(stage, name));
  const data = (options.edit ?? (sql => sql))(source(prefix, options.schemas));
  writeFileSync(join(stage, "0"), data);
  writeFileSync(join(stage, "plan.json"), JSON.stringify({ id, prefix, sourceUrl: "https://example.com", targetUrl: LOCAL_URL, databaseIndex: 0, databaseSha256: createHash("sha256").update(data).digest("hex"), ...(users ? { users } : {}) }));
  const out = php(`define('ABSPATH','/var/www/html/');require ${JSON.stringify(resolve("tests/fakes/wpdb.php"))};$wpdb=new FakeWpdb(${JSON.stringify(dbPath)},'wp_'${options.collations ? `,json_decode(${JSON.stringify(JSON.stringify(options.collations))})` : ""});require ${JSON.stringify(join(stage, "import-copy.php"))};`);
  expect(out).toContain("DATABASE_READY");
  return JSON.parse(readFileSync(join(stage, "database-complete.json"), "utf8"));
}

function open(dbPath: string) {
  const db = new Database(dbPath);
  const option = (name: string) => (db.query("SELECT option_value FROM wp_options WHERE option_name=?").get(name) as { option_value: string } | null)?.option_value ?? null;
  const meta = (userId: number) => Object.fromEntries((db.query("SELECT meta_key,meta_value FROM wp_usermeta WHERE user_id=?").all(userId) as { meta_key: string; meta_value: string }[]).map(r => [r.meta_key, r.meta_value]));
  return { db, option, meta };
}

describe("import-copy.php", () => {
  test("default: keeps the local accounts, assigns posts to the local administrator and detaches comments", () => {
    const path = join(temp, "local.sqlite");
    localSite(path);
    const summary = importCopy(path, "wp_");
    expect(summary).toMatchObject({ users: { mode: "local", copied: 0, roles: "local" }, localAdministrator: 1 });
    const { db, option } = open(path);
    expect(db.query("SELECT ID,user_login FROM wp_users").all()).toEqual([{ ID: 1, user_login: "admin" }]);
    expect(db.query("SELECT DISTINCT post_author FROM wp_posts").all()).toEqual([{ post_author: 1 }]);
    expect(db.query("SELECT user_id FROM wp_comments").get()).toEqual({ user_id: 0 });
    expect(option("wp_user_roles")).toBe(LOCAL_ROLES);
    expect(option("home")).toBe(LOCAL_URL);
    expect(option("admin_email")).toBe("local@example.test");
    expect(option("blog_public")).toBe("0");
    expect(option("active_plugins")).toBe("a:0:{}");
    expect(option("_transient_cache")).toBeNull();
    expect(option("widget_links")).toBe(`a:1:{s:3:"url";${ser(`${LOCAL_URL}/a/b`)}}`);
    const post = db.query("SELECT post_content,guid FROM wp_posts WHERE ID=1").get() as { post_content: string; guid: string };
    expect(post.post_content).toBe(`Visit ${LOCAL_URL}/page, ${LOCAL_URL}, //example.com.ddev.site/i.png and {"u":"https:\\/\\/example.com.ddev.site\\/x"}`);
    expect(post.guid).toBe("https://example.com/?p=1");
    expect((db.query("SELECT length(post_content) AS n FROM wp_posts WHERE ID=2").get() as { n: number }).n).toBe(2 * 1048576);
    expect((db.query("SELECT post_content FROM wp_posts WHERE ID=3").get() as { post_content: string }).post_content.endsWith(`${LOCAL_URL}/end`)).toBe(true);
    expect((db.query("SELECT clerk_id FROM wp_clerk_links").get() as { clerk_id: string }).clerk_id).toBe("user_abc");
    db.close();
  });

  test("users copied: IDs, relationships and plugin user data kept; prefix rewritten; sessions dropped; local administrator added and marked", () => {
    const path = join(temp, "source.sqlite");
    localSite(path);
    const summary = importCopy(path, "src_", "source");
    expect(summary).toMatchObject({ users: { mode: "source", copied: 3, meta: 5, droppedMeta: 2, roles: "source", loginChanged: true }, localAdministrator: 4 });
    const { db, option, meta } = open(path);
    expect(db.query("SELECT ID,user_login,user_email FROM wp_users ORDER BY ID").all()).toEqual([
      { ID: 1, user_login: "admin", user_email: "admin@example.com" }, { ID: 2, user_login: "jane", user_email: "jane@example.com" },
      { ID: 3, user_login: "player1", user_email: "p1@example.com" }, { ID: 4, user_login: "zoer-local-admin", user_email: "zoer-local-admin@localhost.invalid" },
    ]);
    expect((db.query("SELECT user_pass FROM wp_users WHERE ID=4").get() as { user_pass: string }).user_pass).toBe("$local");
    expect(db.query("SELECT post_author FROM wp_posts ORDER BY ID").all()).toEqual([{ post_author: 2 }, { post_author: 3 }, { post_author: 3 }]);
    expect(db.query("SELECT user_id FROM wp_comments").get()).toEqual({ user_id: 3 });
    expect(meta(2)).toEqual({ wp_capabilities: 'a:1:{s:6:"editor";b:1;}', "wp_user-settings": "libraryContent=browse" });
    expect(meta(3)).toEqual({ wp_capabilities: 'a:1:{s:6:"player";b:1;}', clerk_user_id: "user_abc" });
    expect(meta(4)).toEqual({ wp_capabilities: ADMIN_CAPS, wp_user_level: "10", nickname: "admin", zoer_local_administrator: "1" });
    expect(db.query("SELECT COUNT(*) AS n FROM wp_usermeta WHERE meta_key LIKE 'src\\_%' ESCAPE '\\' OR meta_key IN ('session_tokens','_application_passwords')").get()).toEqual({ n: 0 });
    expect(option("wp_user_roles")).toBe(SOURCE_ROLES);
    expect(option("src_user_roles")).toBeNull();
    expect((db.query("SELECT user_url FROM wp_users WHERE ID=1").get() as { user_url: string }).user_url).toBe(LOCAL_URL);
    // The cutover keeps the replaced tables aside until the finish step drops them.
    expect((db.query("SELECT COUNT(*) AS n FROM sqlite_master WHERE name LIKE 'zc\\_b\\_%' ESCAPE '\\'").get() as { n: number }).n).toBe(5);
    db.close();

    // A later refresh finds the marked administrator again, and keeps its ID and login.
    const again = importCopy(path, "src_", "source");
    expect(again).toMatchObject({ localAdministrator: 4, users: { loginChanged: false } });
    const reopened = open(path);
    expect(reopened.db.query("SELECT ID,user_login FROM wp_users ORDER BY ID").all()).toEqual([{ ID: 1, user_login: "admin" }, { ID: 2, user_login: "jane" }, { ID: 3, user_login: "player1" }, { ID: 4, user_login: "zoer-local-admin" }]);
    expect(reopened.meta(4).zoer_local_administrator).toBe("1");
    reopened.db.close();
  });

  test("a source without an administrator role keeps the local roles", () => {
    const path = join(temp, "roles.sqlite");
    localSite(path);
    const data = source("wp_").replace(Buffer.from(SOURCE_ROLES).toString("hex"), Buffer.from('a:1:{s:6:"player";a:0:{}}').toString("hex"));
    const id = createHash("md5").update("roles").digest("hex");
    const stage = join(temp, "stage", id);
    mkdirSync(stage, { recursive: true });
    for (const name of ["SnapshotStream.php", "SerializedReplacement.php", "Replacement.php", "LocalCopyRules.php", "import-copy.php"]) copyFileSync(join(BUNDLE, name), join(stage, name));
    writeFileSync(join(stage, "0"), data);
    writeFileSync(join(stage, "plan.json"), JSON.stringify({ id, prefix: "wp_", sourceUrl: "https://example.com", targetUrl: LOCAL_URL, databaseIndex: 0, databaseSha256: createHash("sha256").update(data).digest("hex"), users: "source" }));
    php(`define('ABSPATH','/var/www/html/');require ${JSON.stringify(resolve("tests/fakes/wpdb.php"))};$wpdb=new FakeWpdb(${JSON.stringify(path)},'wp_');require ${JSON.stringify(join(stage, "import-copy.php"))};`);
    const { db, option } = open(path);
    expect(option("wp_user_roles")).toBe(LOCAL_ROLES);
    db.close();
  });

  test("MySQL 8 collations: converted to the closest one the local server has, reported, and the DDL checks still apply", () => {
    const mysql8 = "ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci";
    const schemas: Record<string, string> = Object.fromEntries(Object.entries(SCHEMAS).map(([suffix, schema]) => [suffix, schema.replace("ENGINE=InnoDB", mysql8)]));
    schemas.posts = `(\`ID\` INTEGER PRIMARY KEY, \`post_author\` INTEGER, \`post_content\` TEXT COLLATE utf8mb4_0900_ai_ci, \`guid\` TEXT CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_as_cs) ${mysql8}`;
    const staged = () => Object.values(JSON.parse(readFileSync(join(lastStage, "tables.json"), "utf8")) as { suffix: string; schema: string }[]);

    // DDEV's MariaDB: no `_0900_` collations, so the staged tables use UCA 5.2.0 and utf8mb4_bin.
    const path = join(temp, "mysql8.sqlite");
    localSite(path);
    expect(importCopy(path, "wp_", "local", { schemas }).collations).toEqual([
      { from: "utf8mb4_0900_ai_ci", to: "utf8mb4_unicode_520_ci", tables: 4 },
      { from: "utf8mb4_0900_as_cs", to: "utf8mb4_bin", tables: 1 },
    ]);
    expect(staged().find(t => t.suffix === "posts")!.schema).toBe("(`ID` INTEGER PRIMARY KEY, `post_author` INTEGER, `post_content` TEXT COLLATE utf8mb4_unicode_520_ci, `guid` TEXT CHARACTER SET utf8mb4 COLLATE utf8mb4_bin) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_520_ci");
    expect(staged().some(t => t.schema.includes("0900"))).toBe(false);
    const { db, option } = open(path);
    expect(option("home")).toBe(LOCAL_URL);
    expect((db.query("SELECT post_content FROM wp_posts WHERE ID=1").get() as { post_content: string }).post_content).toStartWith(`Visit ${LOCAL_URL}/page`);
    db.close();

    // A server without UCA 5.2.0 (MySQL 5.5) takes utf8mb4_unicode_ci; MySQL 8 itself keeps the source's collations.
    const old = join(temp, "mysql55.sqlite");
    localSite(old);
    expect(importCopy(old, "wp_", "local", { schemas, collations: ["utf8mb4_general_ci", "utf8mb4_bin", "utf8mb4_unicode_ci"] }).collations)
      .toEqual([{ from: "utf8mb4_0900_ai_ci", to: "utf8mb4_unicode_ci", tables: 4 }, { from: "utf8mb4_0900_as_cs", to: "utf8mb4_bin", tables: 1 }]);
    const same = join(temp, "mysql80.sqlite");
    localSite(same);
    expect(importCopy(same, "wp_", "local", { schemas, collations: ["utf8mb4_0900_ai_ci", "utf8mb4_0900_as_cs", "utf8mb4_unicode_520_ci"] }).collations).toEqual([]);
    expect(staged().find(t => t.suffix === "posts")!.schema).toBe(schemas.posts);

    // No supported fallback: refused before any table is staged.
    const none = join(temp, "latin1.sqlite");
    localSite(none);
    expect(() => importCopy(none, "wp_", "local", { schemas, collations: ["latin1_swedish_ci"] })).toThrow(/collation utf8mb4_0900_ai_ci/);
    const left = new Database(none);
    expect(left.query("SELECT COUNT(*) AS n FROM sqlite_master WHERE name LIKE 'zc\\_%' ESCAPE '\\'").get()).toEqual({ n: 0 });
    left.close();

    // A collation the server lacks does not excuse DDL the importer refuses.
    const unsafe = { ...schemas, comments: `(\`comment_ID\` INTEGER PRIMARY KEY, \`user_id\` INTEGER, \`comment_content\` TEXT COLLATE utf8mb4_0900_ai_ci, FOREIGN KEY (\`user_id\`) REFERENCES \`wp_users\` (\`ID\`)) ${mysql8}` };
    expect(() => importCopy(join(temp, "unsafe.sqlite"), "wp_", "local", { schemas: unsafe })).toThrow(/Unsupported source schema/);
  });

  test("exact users (WP Migrate): exactly the source's accounts, no extra administrator; the Admin button signs in as the source's admin", () => {
    const path = join(temp, "exact.sqlite");
    localSite(path);
    const summary = importCopy(path, "src_", "exact");
    expect(summary).toMatchObject({ users: { mode: "exact", copied: 3, meta: 5, droppedMeta: 2, roles: "source", loginChanged: false }, localAdministrator: 1 });
    const { db, option, meta } = open(path);
    expect(db.query("SELECT ID,user_login,user_pass FROM wp_users ORDER BY ID").all()).toEqual([{ ID: 1, user_login: "admin", user_pass: "$source1" }, { ID: 2, user_login: "jane", user_pass: "$source2" }, { ID: 3, user_login: "player1", user_pass: "$source3" }]);
    expect(meta(1)).toEqual({ wp_capabilities: ADMIN_CAPS });
    expect(db.query("SELECT COUNT(*) AS n FROM wp_usermeta WHERE meta_key='zoer_local_administrator'").get()).toEqual({ n: 0 });
    expect(db.query("SELECT post_author FROM wp_posts ORDER BY ID").all()).toEqual([{ post_author: 2 }, { post_author: 3 }, { post_author: 3 }]);
    expect(option("wp_user_roles")).toBe(SOURCE_ROLES);
    db.close();
  });

  // Cells are hex in the snapshot: rename the source's "admin" login, or make "jane" an administrator.
  const cell = (value: string) => `X'${Buffer.from(value).toString("hex")}'`;
  const renameAdmin = (sql: string) => sql.replaceAll(cell("admin"), cell("boss"));
  const janeAdmin = (sql: string) => sql.replace(cell('a:1:{s:6:"editor";b:1;}'), cell(ADMIN_CAPS));
  const adminSubscriber = (sql: string) => sql.replace(cell(ADMIN_CAPS), cell('a:1:{s:10:"subscriber";b:1;}'));

  test("exact users: with no “admin” login the only administrator signs in; with several the import stops before the cutover", () => {
    const one = join(temp, "exact-one.sqlite");
    localSite(one);
    expect(importCopy(one, "src_", "exact", { edit: renameAdmin })).toMatchObject({ localAdministrator: 1, users: { mode: "exact" } });

    const several = join(temp, "exact-several.sqlite");
    localSite(several);
    expect(() => importCopy(several, "src_", "exact", { edit: sql => janeAdmin(renameAdmin(sql)) }))
      .toThrow("ZOER_ERROR: The copy would have 2 administrators and none named “admin”, so Zoer's Admin button could not choose one to sign in. Choose “Copy users and user metadata” to keep the local administrator.");
    const { db } = open(several);
    expect(db.query("SELECT ID,user_login FROM wp_users").all()).toEqual([{ ID: 1, user_login: "admin" }]);
    expect((db.query("SELECT COUNT(*) AS n FROM sqlite_master WHERE name LIKE 'zc\\_b\\_%' ESCAPE '\\'").get() as { n: number }).n).toBe(0);
    db.close();
  });

  test("copied users: a copied “admin” login that is not an administrator stops the import (the Admin button would refuse it)", () => {
    const path = join(temp, "source-subscriber-admin.sqlite");
    localSite(path);
    expect(() => importCopy(path, "src_", "source", { edit: adminSubscriber }))
      .toThrow("ZOER_ERROR: The copied “admin” account is not an administrator, so Zoer's Admin button could not sign in to the copy. Choose “Keep only the local administrator” instead.");
  });

  test("the Admin sign-in rule follows the DDEV bridge", () => {
    const out = rules(`return [LocalCopyRules::adminSignIn(1,[1,2],'exact'),LocalCopyRules::adminSignIn(null,[7],'exact'),LocalCopyRules::adminSignIn(3,[1],'source')[0],LocalCopyRules::adminSignIn(null,[],'exact')[0]];`);
    expect(out).toEqual([[1, null], [7, null], null, null]);
  });

  test("an unknown user mode is refused", () => {
    expect(() => importCopy(join(temp, "bad.sqlite"), "wp_", "everyone" as "source")).toThrow();
  });
});
