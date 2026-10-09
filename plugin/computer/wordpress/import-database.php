<?php
// wordpress.copy.database: copies the reviewed import scripts beside the staged snapshot and runs
// import-copy.php with WP-CLI (staged tables, atomic RENAME cutover, journal for replays). Plan
// `users` ("local", "source" or "exact") chooses whether and how the source's accounts are copied.
declare(strict_types=1);
require __DIR__ . '/lib.php';
zoer_main(function (): void {
    $plan = zoer_plan();
    $stage = zoer_stage($plan['id']);
    if (!is_file($stage . '/pending')) throw new ZoerCommandError('The local copy stage is not prepared.');
    $source = (string)($plan['databaseIndex'] ?? '');
    if (!preg_match('/^(?:\d{1,6}|extracted\/database\.sql)$/D', $source)) throw new ZoerCommandError('The database snapshot is missing.');
    foreach (['prefix' => '/^[A-Za-z0-9_]{1,48}$/D', 'databaseSha256' => '/^[a-f0-9]{64}$/D', 'sourceUrl' => '/^https?:\/\/\S{1,2040}$/D', 'targetUrl' => '/^https:\/\/\S{1,2040}$/D'] as $key => $pattern) {
        if (!is_string($plan[$key] ?? null) || !preg_match($pattern, $plan[$key])) throw new ZoerCommandError('The database import plan is invalid.');
    }
    $users = $plan['users'] ?? 'local';
    if (!in_array($users, ['local', 'source', 'exact'], true)) throw new ZoerCommandError('The database import plan is invalid.');
    foreach (['SnapshotStream.php', 'SerializedReplacement.php', 'Replacement.php', 'LocalCopyRules.php', 'import-copy.php'] as $name) {
        $bytes = file_get_contents(__DIR__ . '/' . $name);
        if ($bytes === false) throw new ZoerCommandError('The import scripts are missing from the plugin package.');
        zoer_write($stage . '/' . $name, $bytes);
    }
    zoer_write($stage . '/plan.json', json_encode(['id' => $plan['id'], 'prefix' => $plan['prefix'], 'sourceUrl' => $plan['sourceUrl'], 'targetUrl' => $plan['targetUrl'],
        'databaseIndex' => ctype_digit($source) ? (int)$source : $source, 'databaseSha256' => $plan['databaseSha256'], 'users' => $users], JSON_UNESCAPED_SLASHES));
    $out = zoer_wp(['eval-file', $stage . '/import-copy.php'], 'Local copy operation failed. The partial destination and private staging are retained for inspection or retry.', 1800);
    if (!str_contains($out, 'DATABASE_READY')) throw new ZoerCommandError('The local database import did not finish.');
    // The importer's summary (tables, rows, replacements, users) for the run output and catalog.
    $summary = json_decode((string)@file_get_contents($stage . '/database-complete.json'), true);
    echo json_encode(['ok' => true, 'database' => 'ready', 'summary' => is_array($summary) ? $summary : null], JSON_UNESCAPED_SLASHES), "\n";
}, 'Local copy operation failed. The partial destination and private staging are retained for inspection or retry.');
