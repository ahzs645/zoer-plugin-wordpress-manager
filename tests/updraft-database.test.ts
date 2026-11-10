import { afterAll, expect, test } from "bun:test";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { gzipSync } from "node:zlib";

const temp = mkdtempSync(join(tmpdir(), "wpm-updraft-database-"));
afterAll(() => rmSync(temp, { recursive: true, force: true }));
const script = resolve("plugin/computer/wordpress/prepare-updraft.php");

function rows(value: string) {
  const code = `require ${JSON.stringify(script)};try {echo json_encode(array_map(fn($r)=>array_map(fn($v)=>$v===null?null:bin2hex($v),$r),iterator_to_array(updraft_rows(${JSON.stringify(value)}))));}catch(UpdraftError $e){fwrite(STDERR,$e->getMessage());exit(1);}`;
  return Bun.spawnSync(["php", "-r", code]);
}

test("Updraft hexadecimal columns preserve binary bytes, quoted lookalikes and following rows", () => {
  const result = rows("(1,0x6666313233,0x00ff,'0x1234',NULL),(2, 0x4142 ,3.5,'it''s',-2)");
  expect(result.exitCode).toBe(0);
  expect(JSON.parse(result.stdout.toString())).toEqual([
    ["31", "6666313233", "00ff", "307831323334", null],
    ["32", "4142", "332e35", "69742773", "2d32"],
  ]);
});

test("hexadecimal support still refuses malformed literals and SQL expressions", () => {
  for (const literal of ["0x", "0x1", "0xGG", "0x12 OR 1", "0x12+1", "0x12/* comment */", "UNHEX('12')", "LOAD_FILE('/secret')"]) {
    const result = rows(`(1,${literal})`);
    expect(result.exitCode).toBe(1);
    expect(result.stderr.toString()).toContain("Unsupported SQL value");
  }
});

test("a complete Updraft dump with a binary plugin column converts to the guarded snapshot", () => {
  let sql = "# WordPress MySQL database backup\n# Created by UpdraftPlus\n# WordPress Version: 6.9.4\n# Home URL: https://example.com\n# Table prefix: wp_\n# Site info: multisite=0\n";
  for (const table of ["options", "posts", "users", "usermeta", "simply_static_pages"]) {
    sql += `CREATE TABLE \`wp_${table}\` (\n  \`id\` bigint NOT NULL,\n  \`content_hash\` varbinary(32) DEFAULT NULL\n) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;\nINSERT INTO \`wp_${table}\` VALUES (1,0x6666313233);\n`;
  }
  const source = join(temp, "database.gz"), destination = join(temp, "database.sql");
  writeFileSync(source, gzipSync(sql));
  const code = `require ${JSON.stringify(script)};echo json_encode(updraft_convert_database(${JSON.stringify(source)},${JSON.stringify(destination)}));`;
  const result = Bun.spawnSync(["php", "-r", code]);
  expect(result.exitCode).toBe(0);
  expect(JSON.parse(result.stdout.toString())).toMatchObject({ tables: 5, prefix: "wp_", wordpressVersion: "6.9.4" });
  const converted = readFileSync(destination, "utf8");
  expect(converted).toStartWith("-- Zoer Connect database snapshot\n");
  expect(converted).toContain("INSERT INTO `wp_simply_static_pages` (`id`,`content_hash`) VALUES (X'31',X'6666313233');");
});
