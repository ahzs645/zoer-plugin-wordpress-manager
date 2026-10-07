<?php
// wordpress.copy.finish: the destination's own home/siteurl, cache flush, install and administrator
// checks, database upgrade for restored backups, permalinks with the restored theme loaded, then the
// stage "pending" marker goes and the site must answer HTTP 200 over HTTPS (the legacy host
// engine fetched the managed URL; here the container requests its own web server with that host).
declare(strict_types=1);
require __DIR__ . '/lib.php';
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
    zoer_wp(['user', 'get', 'admin', '--field=ID'], $fail, 120);
    if (($plan['updateDb'] ?? false) === true) zoer_wp(['core', 'update-db'], $fail, 600);
    // Load the restored theme's custom post types before rebuilding permalinks.
    zoer_wp(['rewrite', 'flush', '--hard'], $fail, 300, ['--skip-plugins', '--skip-packages']);
    @unlink($stage . '/pending');
    $path = ($url['path'] ?? '') === '' ? '/' : $url['path'];
    [$code, $status] = zoer_run(['curl', '-sk', '-H', 'X-Forwarded-Proto: https', '-o', '/dev/null', '-w', '%{http_code}', '--max-time', '20', '--resolve', $url['host'] . ':443:127.0.0.1', 'https://' . $url['host'] . $path], 30);
    if ($code !== 0 || trim($status) !== '200') {
        zoer_write($stage . '/pending', 'pending');
        throw new ZoerCommandError('Local website verification failed.');
    }
    echo json_encode(['ok' => true, 'http' => 200]), "\n";
}, 'Local copy operation failed. The partial destination and private staging are retained for inspection or retry.');
