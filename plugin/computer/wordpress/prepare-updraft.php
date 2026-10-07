<?php
// wordpress.updraft.prepare: converts a verified five-part UpdraftPlus set, staged in the copy
// stage, into a data-only Zoer snapshot (never executes SQL) plus extracted wp-content files.
// PHP port of Zoer `backend/scripts/wordpress/prepare-updraft-copy.py` (legacy host engine) with the
// same limits, checks and messages; the parity harness runs both on the same fixtures.
//
// Plan: { id, components: [{ component, size, sha256, source }] } where `source` is the staged
// position of each component. Writes <stage>/extracted/* and <stage>/prepared.json and prints one
// JSON summary line { metadata, warnings, fileCount, databaseSha256 } on stdout.
declare(strict_types=1);

const UPDRAFT_HEADER = "-- Zoer Connect database snapshot\nSET NAMES utf8mb4;\nSET FOREIGN_KEY_CHECKS=0;\nSET SQL_MODE='NO_AUTO_VALUE_ON_ZERO';\n";
const UPDRAFT_MAX_RECORD = 16 * 1024 * 1024;
const UPDRAFT_MAX_EXPANDED = 2 * 1024 ** 3;
const UPDRAFT_DROP_INS = ['advanced-cache.php', 'db.php', 'object-cache.php', 'sunrise.php', 'maintenance.php'];
const UPDRAFT_COMPONENTS = ['database', 'plugins', 'themes', 'uploads', 'others'];

final class UpdraftError extends RuntimeException {}
function updraft_fail(string $message): void { throw new UpdraftError($message); }

/** Yields complete SQL statements (comment and blank lines between statements skipped). */
function updraft_statements($handle): Generator {
    $pending = ''; $expanded = 0;
    while (($line = gzgets($handle, UPDRAFT_MAX_RECORD + 2)) !== false) {
        if (!preg_match('//u', $line)) updraft_fail('Database is not valid UTF-8.');
        $expanded += strlen($line);
        if (strlen($line) > UPDRAFT_MAX_RECORD || $expanded > 512 * 1024 ** 2) updraft_fail('Database exceeds record or expanded size limits.');
        if ($pending === '' && (trim($line) === '' || str_starts_with($line, '#') || str_starts_with($line, '--') || str_starts_with($line, '/*'))) continue;
        $pending .= $line;
        if (strlen($pending) > UPDRAFT_MAX_RECORD) updraft_fail('Database statement exceeds 16 MiB.');
        if (str_ends_with(rtrim($pending), ';')) { yield trim($pending); $pending = ''; }
    }
    if (trim($pending) !== '') updraft_fail('Incomplete SQL statement.');
}

/** Only quoted strings, numbers and NULL; no SQL expressions or functions. */
function updraft_rows(string $text): Generator {
    $i = 0; $n = strlen($text);
    $space = static function () use (&$i, $n, $text) { while ($i < $n && ctype_space($text[$i])) $i++; };
    while ($i < $n) {
        $space();
        if ($i >= $n || $text[$i] !== '(') updraft_fail('Unsupported INSERT tuple.');
        $i++;
        $row = [];
        while (true) {
            $space();
            if ($i >= $n) updraft_fail('Truncated INSERT.');
            if ($text[$i] === "'") {
                $i++; $value = ''; $closed = false;
                while ($i < $n) {
                    $c = $text[$i]; $i++;
                    if ($c === '\\') {
                        if ($i >= $n) updraft_fail('Truncated escape.');
                        $c = $text[$i]; $i++;
                        $value .= ['0' => "\0", 'n' => "\n", 'r' => "\r", 't' => "\t", 'b' => "\x08", 'Z' => "\x1a"][$c] ?? $c;
                    } elseif ($c === "'") {
                        if ($i < $n && $text[$i] === "'") { $value .= "'"; $i++; }
                        else { $closed = true; break; }
                    } else $value .= $c;
                }
                if (!$closed) updraft_fail('Unclosed SQL string.');
                $row[] = $value;
            } else {
                if (!preg_match('/\G(NULL|[-+]?(?:\d+(?:\.\d*)?|\.\d+)(?:[eE][-+]?\d+)?)\s*(?=[,)])/i', $text, $m, 0, $i)) updraft_fail('Unsupported SQL value.');
                $row[] = strtoupper($m[1]) === 'NULL' ? null : $m[1];
                $i += strlen($m[0]);
            }
            $space();
            if ($i >= $n) updraft_fail('Truncated INSERT.');
            $delimiter = $text[$i]; $i++;
            if ($delimiter === ')') break;
            if ($delimiter !== ',') updraft_fail('Unsupported INSERT delimiter.');
        }
        yield $row;
        $space();
        if ($i === $n) break;
        if ($text[$i] !== ',') updraft_fail('Trailing INSERT data.');
        $i++;
        if (trim(substr($text, $i)) === '') updraft_fail('Trailing INSERT comma.');
    }
}

function updraft_convert_database(string $source, string $destination, ?array $hosting = null): array {
    if ($hosting !== null) {
        $prefix = $hosting['prefix']; $sourceUrl = ''; $version = $hosting['wordpressVersion'];
    } else {
        $h = gzopen($source, 'rb');
        if (!$h) updraft_fail('Not an UpdraftPlus database.');
        $header = (string)gzread($h, 65536); gzclose($h);
        if (!str_contains($header, 'WordPress MySQL database backup') || !str_contains($header, 'UpdraftPlus')) updraft_fail('Not an UpdraftPlus database.');
        if (preg_match('/multisite=1\b/', $header)) updraft_fail('Multisite is not supported.');
        $field = static function (string $pattern) use ($header): string {
            if (!preg_match($pattern, $header, $m)) updraft_fail('Required backup metadata is missing.');
            return $m[1];
        };
        $prefix = $field('/# Table prefix:\s*([A-Za-z0-9_]{1,48})\s/');
        $sourceUrl = rtrim($field('/# Home URL:\s*(https?:\/\/[^\s]+)/'), '/');
        $url = parse_url($sourceUrl);
        if (!is_array($url) || empty($url['host']) || isset($url['user']) || isset($url['pass']) || isset($url['path']) || isset($url['query']) || isset($url['fragment'])) updraft_fail('Only standard-root WordPress backups are supported.');
        $version = $field('/# WordPress Version:\s*(\d+\.\d+(?:\.\d+)?)/');
    }
    $siteUrl = null;
    $schemas = []; $current = null; $total = 0; $activePlugins = null;
    $in = gzopen($source, 'rb'); $out = fopen($destination, 'wb');
    if (!$in || !$out) updraft_fail('Backup preparation failed. Verify all files and retry.');
    fwrite($out, UPDRAFT_HEADER);
    foreach (updraft_statements($in) as $sql) {
        $total += strlen($sql);
        if ($total > 512 * 1024 ** 2) updraft_fail('Database exceeds 512 MiB.');
        if ($hosting !== null && preg_match('/^(?:SET @OLD_AUTOCOMMIT=@@AUTOCOMMIT, @@AUTOCOMMIT=0;|SET AUTOCOMMIT=@OLD_AUTOCOMMIT;|COMMIT;|LOCK TABLES `[A-Za-z0-9_]+` WRITE;|UNLOCK TABLES;)$/D', $sql)) continue;
        if (preg_match('/^DROP TABLE IF EXISTS `[A-Za-z0-9_]+`;$/D', $sql)) continue;
        if (preg_match('/^CREATE TABLE `([A-Za-z0-9_]+)` ([\s\S]+);$/D', $sql, $m)) {
            [, $table, $body] = $m;
            if (!str_starts_with($table, $prefix) || isset($schemas[$table]) || count($schemas) >= 500) updraft_fail('Duplicate or out-of-scope table.');
            if (!str_starts_with($body, '(') || !preg_match('/\) ENGINE=InnoDB\b/', $body) || preg_match('/;|\/\*|--|\b(?:SELECT|REFERENCES|FOREIGN|TRIGGER|TABLESPACE|DIRECTORY|UNION|INTO|OUTFILE|LOAD)\b/i', $body)) updraft_fail('Unsupported database schema.');
            preg_match_all('/^\s*`([A-Za-z0-9_]+)`\s/m', $body, $columns);
            $columns = $columns[1];
            if (!$columns || count(array_unique($columns)) !== count($columns)) updraft_fail('Invalid schema columns.');
            $schemas[$table] = $columns; $current = $table;
            fwrite($out, "DROP TABLE IF EXISTS `{$table}`;\nCREATE TABLE `{$table}` {$body};\n");
            continue;
        }
        if (!preg_match('/^INSERT INTO `([A-Za-z0-9_]+)` VALUES\s+([\s\S]+);$/D', $sql, $m) || $m[1] !== $current) updraft_fail('Unsupported SQL statement.');
        $table = $m[1]; $columns = $schemas[$table];
        $names = implode(',', array_map(fn($c) => '`' . $c . '`', $columns));
        foreach (updraft_rows($m[2]) as $row) {
            if (count($row) !== count($columns)) updraft_fail('INSERT columns do not match schema.');
            if ($table === $prefix . 'options') {
                $values = array_combine($columns, $row);
                if ($hosting !== null && ($values['option_name'] ?? null) === 'home') $sourceUrl = rtrim((string)$values['option_value'], '/');
                if ($hosting !== null && ($values['option_name'] ?? null) === 'siteurl') $siteUrl = rtrim((string)$values['option_value'], '/');
                if (($values['option_name'] ?? null) === 'active_plugins') $activePlugins = $values['option_value'] ?? null;
            }
            $cells = implode(',', array_map(fn($v) => $v === null ? 'NULL' : "X'" . bin2hex($v) . "'", $row));
            fwrite($out, "INSERT INTO `{$table}` ({$names}) VALUES ({$cells});\n");
        }
    }
    foreach (['options', 'posts', 'users', 'usermeta'] as $t) if (!isset($schemas[$prefix . $t])) updraft_fail('Required WordPress tables are missing.');
    if ($hosting !== null) {
        $url = parse_url($sourceUrl);
        if ($siteUrl !== $sourceUrl || !is_array($url) || !in_array($url['scheme'] ?? '', ['http', 'https'], true) || empty($url['host']) || isset($url['user']) || isset($url['pass']) || isset($url['path']) || isset($url['query']) || isset($url['fragment'])) updraft_fail('Only standard-root WordPress backups are supported.');
        foreach (array_keys($schemas) as $table) if (preg_match('/^' . preg_quote($prefix, '/') . '(?:\d+_|blogs$|site$|sitemeta$)/', $table)) updraft_fail('Multisite is not supported.');
    }
    fwrite($out, "SET FOREIGN_KEY_CHECKS=1;\n");
    fclose($out); gzclose($in);
    return ['prefix' => $prefix, 'sourceUrl' => $sourceUrl, 'wordpressVersion' => $version, 'activePlugins' => $activePlugins, 'tables' => count($schemas)];
}

/** Prepares `$root` (the copy stage). `$components` maps component → [path, size, sha256]. */
function updraft_prepare(string $root, array $components): array {
    foreach (UPDRAFT_COMPONENTS as $component) {
        $record = $components[$component] ?? null;
        if (!$record) updraft_fail('select one database, plugins, themes, uploads, and others backup file');
        if (!is_file($record['path']) || is_link($record['path']) || filesize($record['path']) !== $record['size'] || hash_file('sha256', $record['path']) !== $record['sha256']) updraft_fail('Upload failed its SHA-256 or size check.');
    }
    $extracted = $root . '/extracted';
    if (!is_dir($extracted) && !mkdir($extracted, 0700, true)) updraft_fail('Backup preparation failed. Verify all files and retry.');
    $db = $extracted . '/database.sql';
    $metadata = updraft_convert_database($components['database']['path'], $db);
    $files = []; $warnings = []; $seen = []; $expanded = filesize($db);
    $add = static function (string $path, string $source) use (&$files, $root) {
        $files[] = ['path' => $path, 'source' => $source, 'bytes' => filesize($root . '/' . $source), 'sha256' => hash_file('sha256', $root . '/' . $source)];
    };
    $add('database.sql', 'extracted/database.sql');
    foreach (['plugins', 'themes', 'uploads', 'others'] as $component) {
        $zip = new ZipArchive();
        if ($zip->open($components[$component]['path'], ZipArchive::RDONLY) !== true) updraft_fail('Backup preparation failed. Verify all files and retry.');
        if ($zip->numFiles > 100000) updraft_fail('Too many archive members.');
        for ($index = 0; $index < $zip->numFiles; $index++) {
            $info = $zip->statIndex($index, ZipArchive::FL_UNCHANGED);
            $name = (string)$info['name'];
            $trimmed = rtrim($name, '/');
            if (str_contains($name, '\\') || str_contains($name, "\0") || str_starts_with($name, '/') || preg_match('/^[A-Za-z]:/', $name) || array_intersect(explode('/', $trimmed), ['', '.', '..'])) updraft_fail('Unsafe archive path.');
            $zip->getExternalAttributesIndex($index, $opsys, $attributes);
            $kind = ($attributes >> 16) & 0170000;
            if (!in_array($kind, [0, 0100000, 0040000], true) || ($info['encryption_method'] ?? 0) !== 0) updraft_fail('Links, special files and encrypted archives are unsupported.');
            $parts = explode('/', $trimmed);
            if ($component !== 'others' && $parts[0] !== $component) updraft_fail('Archive root does not match component.');
            if (str_ends_with($name, '/')) continue;
            if ($component === 'others' && (in_array($parts[0], UPDRAFT_DROP_INS, true) || in_array($parts[0], ['mu-plugins', 'cache', 'updraft'], true) || end($parts) === '.htaccess')) {
                $warnings[] = 'Skipped local cache, drop-in, must-use plugin or backup file.';
                continue;
            }
            if ($component === 'uploads' && preg_match('/\.(php\d*|phtml|phar|cgi|pl|sh)(\.|$)/i', $name)) {
                $content = $info['size'] <= 256 ? $zip->getFromIndex($index) : false;
                if (end($parts) !== 'index.php' || $info['size'] > 256 || !in_array(trim((string)$content), ["<?php\n// Silence is golden.", '<?php // Silence is golden.'], true)) updraft_fail('Executable upload is unsupported.');
            }
            $path = 'wp-content/' . $name;
            if (isset($seen[$path]) || count($files) >= 100000) updraft_fail('Duplicate or excessive files.');
            $seen[$path] = true; $expanded += $info['size'];
            if ($info['size'] > 64 * 1024 ** 2 || $expanded > UPDRAFT_MAX_EXPANDED || $info['size'] / max(1, $info['comp_size']) > 1000) updraft_fail('Archive exceeds expanded size or compression limits.');
            $source = 'extracted/' . count($files);
            $in = $zip->getStream($name);
            $out = fopen($root . '/' . $source, 'wb');
            if (!$in || !$out) updraft_fail('Backup preparation failed. Verify all files and retry.');
            $size = 0;
            while (!feof($in)) {
                $data = fread($in, 1024 * 1024);
                if ($data === false) break;
                $size += strlen($data);
                if ($size > $info['size']) updraft_fail('Invalid archive size.');
                fwrite($out, $data);
            }
            fclose($in); fclose($out);
            if ($size !== $info['size']) updraft_fail('Truncated archive.');
            $add($path, $source);
        }
        $zip->close();
    }
    $warnings[] = 'Restored plugins start inactive. Review and activate the required plugins before publication.';
    $warnings[] = 'The backup has no WordPress core files. The new local site uses its installed core; check updates and test compatibility before publishing.';
    $prepared = ['metadata' => $metadata, 'files' => $files, 'warnings' => array_values(array_unique($warnings))];
    $temporary = $root . '/prepared.json.tmp';
    file_put_contents($temporary, json_encode($prepared, JSON_UNESCAPED_SLASHES | JSON_UNESCAPED_UNICODE | JSON_THROW_ON_ERROR));
    chmod($temporary, 0600);
    rename($temporary, $root . '/prepared.json');
    return $prepared;
}

// Command entry (skipped when the parity harness includes this file as a library).
if (realpath($_SERVER['SCRIPT_FILENAME'] ?? '') === __FILE__ && !defined('UPDRAFT_LIBRARY')) {
    require __DIR__ . '/lib.php';
    zoer_main(function (): void {
        $plan = zoer_plan();
        $stage = zoer_stage($plan['id']);
        $components = [];
        foreach ((array)($plan['components'] ?? []) as $record) {
            $component = (string)($record['component'] ?? '');
            if (!in_array($component, UPDRAFT_COMPONENTS, true) || isset($components[$component]) || !preg_match('/^\d{1}$/D', (string)($record['source'] ?? ''))) throw new ZoerCommandError('invalid backup component');
            $components[$component] = ['path' => $stage . '/' . $record['source'], 'size' => (int)$record['size'], 'sha256' => (string)$record['sha256']];
        }
        try { $prepared = updraft_prepare($stage, $components); }
        catch (UpdraftError $error) { throw new ZoerCommandError($error->getMessage()); }
        $database = $prepared['files'][0];
        $metadata = $prepared['metadata'];
        echo json_encode(['metadata' => ['prefix' => $metadata['prefix'], 'sourceUrl' => $metadata['sourceUrl'], 'wordpressVersion' => $metadata['wordpressVersion'], 'tables' => $metadata['tables'], 'activePlugins' => $metadata['activePlugins'] === null ? null : true],
            'warnings' => $prepared['warnings'], 'fileCount' => count($prepared['files']), 'databaseSha256' => $database['sha256']], JSON_UNESCAPED_SLASHES), "\n";
    }, 'Backup preparation failed. Verify all files and retry.');
}
