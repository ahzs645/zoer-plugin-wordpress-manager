<?php
// wordpress.copy.finish: the destination's own home/siteurl, cache flush, install and administrator
// checks, database upgrade for restored backups, permalinks with the restored theme loaded, then the
// stage "pending" marker goes and the site must answer HTTP 200 over HTTPS (the legacy host
// engine fetched the managed URL; here the container requests its own web server with that host).
// After that check the tables the import replaced (zc_b_*) are dropped.
declare(strict_types=1);
require __DIR__ . '/lib.php';
require_once __DIR__ . '/LocalCopyRules.php';

/**
 * `prune`: in every theme and plugin folder the refresh placed, delete local files the source did not
 * have (WP Migrate replaces those folders whole). Links are never followed; empty folders go too.
 * Uploads, must-use plugins, single-file plugins and folders the source did not send stay as they are.
 */
function zoer_prune_placed(string $stage): int {
    $list = $stage . '/placed.list';
    if (!is_file($list)) return 0;
    $placed = array_fill_keys(array_filter(explode("\n", (string)file_get_contents($list)), 'strlen'), true);
    $removed = 0;
    foreach (\ZoerConnect\LocalCopyRules::pruneRoots(array_keys($placed)) as $relative) {
        $root = ZOER_WEB_ROOT . '/' . $relative;
        for ($d = $root; $d !== ZOER_WEB_ROOT; $d = dirname($d)) { if (is_link($d)) throw new ZoerCommandError('A placed folder is a link; nothing was removed.'); }
        if (!is_dir($root)) continue;
        $walk = new RecursiveIteratorIterator(new RecursiveDirectoryIterator($root, FilesystemIterator::SKIP_DOTS), RecursiveIteratorIterator::CHILD_FIRST);
        foreach ($walk as $entry) {
            $path = substr($entry->getPathname(), strlen(ZOER_WEB_ROOT) + 1);
            if ($entry->isLink() || $entry->isFile()) {
                if (isset($placed[$path]) || \ZoerConnect\LocalCopyRules::keepOnPrune($path)) continue;
                if (!unlink($entry->getPathname())) throw new ZoerCommandError('Could not remove a file the source no longer has.');
                $removed++;
            } elseif ($entry->isDir() && !\ZoerConnect\LocalCopyRules::keepOnPrune($path) && count(scandir($entry->getPathname()) ?: ['.', '..', 'x']) === 2) @rmdir($entry->getPathname());
        }
    }
    return $removed;
}
zoer_main(function (): void {
    $plan = zoer_plan();
    $stage = zoer_stage($plan['id']);
    // Refresh the generated guard for restores resumed from an older command bundle.
    $mu = ZOER_WEB_ROOT . '/wp-content/mu-plugins';
    if (is_link($mu) || !is_dir($mu)) throw new ZoerCommandError('The local copy guard is missing.');
    zoer_write($mu . '/zoer-local-copy.php', zoer_copy_guard_source($stage . '/pending'), 0644);
    $target = (string)($plan['targetUrl'] ?? '');
    $url = parse_url($target);
    if (!preg_match('/^https:\/\/\S{1,2040}$/D', $target) || !is_array($url) || empty($url['host']) || isset($url['user']) || isset($url['query'])) throw new ZoerCommandError('The local site address is invalid.');
    $fail = 'Local copy operation failed. The partial destination and private staging are retained for inspection or retry.';
    zoer_wp(['option', 'update', 'home', $target], $fail, 120);
    zoer_wp(['option', 'update', 'siteurl', $target], $fail, 120);
    zoer_wp(['cache', 'flush'], $fail, 120);
    zoer_wp(['core', 'is-installed'], $fail, 120);
    // The administrator the importer kept (by ID: copied source accounts may include another "admin").
    $imported = json_decode((string)@file_get_contents($stage . '/database-complete.json'), true);
    $admin = is_array($imported) && is_int($imported['localAdministrator'] ?? null) && $imported['localAdministrator'] > 0 ? (string)$imported['localAdministrator'] : 'admin';
    if (!str_contains(zoer_wp(['user', 'get', $admin, '--field=roles'], $fail, 120), 'administrator')) throw new ZoerCommandError('The local administrator account is missing after the import.');
    if (($plan['updateDb'] ?? false) === true) zoer_wp(['core', 'update-db'], $fail, 600);
    // Load the restored theme's custom post types before rebuilding permalinks.
    // A database refresh retains the destination's complete options table and its existing
    // plugin routes. Flushing with plugins skipped would erase their rewrite rules.
    // A files-only refresh keeps the database too, so the same applies.
    $pruned = ($plan['prune'] ?? false) === true ? zoer_prune_placed($stage) : null;
    if (!in_array($plan['scope'] ?? 'complete', ['database', 'files'], true)) zoer_wp(['rewrite', 'flush', '--hard'], $fail, 300, ['--skip-plugins', '--skip-packages']);
    @unlink($stage . '/pending');
    $path = ($url['path'] ?? '') === '' ? '/' : $url['path'];
    [$code, $status] = zoer_run(['curl', '-sk', '-H', 'X-Forwarded-Proto: https', '-o', '/dev/null', '-w', '%{http_code}', '--max-time', '20', '--resolve', $url['host'] . ':443:127.0.0.1', 'https://' . $url['host'] . $path], 30);
    if ($code !== 0 || trim($status) !== '200') {
        zoer_write($stage . '/pending', 'pending');
        throw new ZoerCommandError('Local website verification failed.');
    }
    // The tables the cutover replaced are not a recovery point (a refresh takes a DDEV backup first).
    $cleaned = zoer_drop_replaced_tables($stage);
    echo json_encode(['ok' => true, 'http' => 200, 'replacedTablesDropped' => $cleaned, ...($pruned !== null ? ['pruned' => $pruned] : [])]), "\n";
}, 'Local copy operation failed. The partial destination and private staging are retained for inspection or retry.');
