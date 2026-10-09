<?php
// Test stand-in for WordPress's $wpdb on SQLite, with just the calls import-copy.php makes. MySQL-only
// statements (SHOW TABLES/COLUMNS/COLLATION, multi-table RENAME, ENGINE and COLLATE clauses) are
// translated; everything else runs as written, so the importer's own SQL is exercised. Like the
// server it stands in for, CREATE TABLE refuses a collation outside $collations (by default DDEV's
// MariaDB, which has no MySQL 8 `_0900_` collations).
const ARRAY_A = 'ARRAY_A';
final class FakeWpdb {
    public string $prefix; public string $users; public string $usermeta; public string $options;
    public const MARIADB_COLLATIONS = ['latin1_swedish_ci', 'utf8_general_ci', 'utf8_unicode_ci', 'utf8mb4_general_ci', 'utf8mb4_bin', 'utf8mb4_unicode_ci', 'utf8mb4_unicode_520_ci'];
    private PDO $db;
    public function __construct(string $path, string $prefix, private array $collations = self::MARIADB_COLLATIONS) {
        $this->db = new PDO('sqlite:' . $path, null, null, [PDO::ATTR_ERRMODE => PDO::ERRMODE_EXCEPTION]);
        $this->prefix = $prefix; $this->users = $prefix . 'users'; $this->usermeta = $prefix . 'usermeta'; $this->options = $prefix . 'options';
    }
    public function esc_like(string $text): string { return addcslashes($text, '_%\\'); }
    public function prepare(string $sql, ...$args): string {
        return preg_replace_callback('/%[sd]/', function ($m) use (&$args) { $v = array_shift($args); return $m[0] === '%d' ? (string)(int)$v : $this->db->quote((string)$v); }, $sql);
    }
    private function translate(string $sql): string {
        if (preg_match("/^SHOW TABLES LIKE '(.*)'$/s", $sql, $m)) return "SELECT name FROM sqlite_master WHERE type='table' AND name=" . $this->db->quote(stripslashes($m[1]));
        if (preg_match('/^SHOW COLUMNS FROM `([A-Za-z0-9_]+)`$/', $sql, $m)) return "SELECT name FROM pragma_table_info('" . $m[1] . "')";
        if (preg_match("/^SHOW COLLATION LIKE ('.*')$/s", $sql, $m)) return "SELECT value AS Collation FROM json_each(" . $this->db->quote(json_encode($this->collations)) . ") WHERE value LIKE $m[1] ESCAPE '\\'";
        if (str_starts_with($sql, 'CREATE TABLE')) return preg_replace(['/\)\s*ENGINE=InnoDB.*$/s', '/\s+(?:CHARACTER SET|CHARSET|COLLATE)(?:\s*=\s*|\s+)\w+/i'], [')', ''], $sql);
        return $sql;
    }
    public function query(string $sql) {
        if (preg_match('/^RENAME TABLE (.+)$/s', $sql, $m)) {
            $this->db->beginTransaction();
            foreach (explode(',', $m[1]) as $pair) { [$from, $to] = array_map('trim', explode(' TO ', $pair)); $this->db->exec("ALTER TABLE $from RENAME TO $to"); }
            $this->db->commit();
            return 0;
        }
        if (str_starts_with($sql, 'CREATE TABLE') && preg_match_all('/\bCOLLATE(?:\s*=\s*|\s+)(\w+)/i', $sql, $m) && array_diff(array_map('strtolower', $m[1]), $this->collations)) return false;
        return $this->db->exec($this->translate($sql));
    }
    private function rows(string $sql): array { return $this->db->query($this->translate($sql))->fetchAll(PDO::FETCH_ASSOC); }
    public function get_var(string $sql) { $row = $this->rows($sql)[0] ?? null; return $row === null ? null : (($v = array_values($row)[0]) === null ? null : (string)$v); }
    public function get_row(string $sql, $output = null) { $row = $this->rows($sql)[0] ?? null; return $row === null ? null : array_map(fn($v) => $v === null ? null : (string)$v, $row); }
    public function get_results(string $sql, $output = null): array { return array_map(fn($r) => array_map(fn($v) => $v === null ? null : (string)$v, $r), $this->rows($sql)); }
    public function get_col(string $sql): array { return array_map(fn($r) => (string)array_values($r)[0], $this->rows($sql)); }
    private function write(string $verb, string $table, array $row) {
        $columns = implode(',', array_map(fn($c) => "`$c`", array_keys($row)));
        $statement = $this->db->prepare("$verb INTO `$table` ($columns) VALUES (" . implode(',', array_fill(0, count($row), '?')) . ')');
        return $statement->execute(array_values($row)) ? 1 : false;
    }
    public function insert(string $table, array $row) { return $this->write('INSERT', $table, $row); }
    public function replace(string $table, array $row) { return $this->write('INSERT OR REPLACE', $table, $row); }
}
