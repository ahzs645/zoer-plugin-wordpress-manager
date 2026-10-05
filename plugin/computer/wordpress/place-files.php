<?php
// wordpress.copy.files: places one batch of staged, verified files into the site (temporary file
// beside the target, digest check, atomic rename; no links followed) — the legacy host engine's
// file copy loop. Zero-byte files are created here (they are never staged).
declare(strict_types=1);
require __DIR__ . '/lib.php';
const EMPTY_SHA256 = 'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855';
zoer_main(function (): void {
    $plan = zoer_plan();
    $stage = zoer_stage($plan['id']);
    if (!is_file($stage . '/pending')) throw new ZoerCommandError('The local copy stage is not prepared.');
    if (($plan['fromPrepared'] ?? false) === true) {
        $prepared = json_decode((string)file_get_contents($stage . '/prepared.json'), true, 64, JSON_THROW_ON_ERROR);
        $offset = (int)($plan['offset'] ?? 0); $limit = max(1, min(5000, (int)($plan['limit'] ?? 2000)));
        $files = array_slice(array_values(array_filter($prepared['files'], fn($f) => $f['path'] !== 'database.sql')), $offset, $limit);
    } else {
        $files = $plan['files'] ?? null;
    }
    if (!is_array($files) || count($files) > 5000) throw new ZoerCommandError('The file batch is invalid.');
    $placed = 0;
    foreach ($files as $f) {
        $path = (string)($f['path'] ?? ''); $sha = (string)($f['sha256'] ?? ''); $source = (string)($f['source'] ?? '');
        if (!preg_match('/^wp-content\/[^\x00-\x1f\\\\]{1,500}$/D', $path) || in_array('..', explode('/', $path), true) || in_array('', explode('/', $path), true) || in_array('.', explode('/', $path), true)) throw new ZoerCommandError('The file batch contains an unsupported path.');
        if (!preg_match('/^[a-f0-9]{64}$/D', $sha) || !preg_match('/^(?:\d{1,6}|extracted\/\d{1,6})$/D', $source)) throw new ZoerCommandError('The file batch is invalid.');
        $s = $stage . '/' . $source; $p = ZOER_WEB_ROOT . '/' . $path;
        $empty = (int)($f['bytes'] ?? -1) === 0 && $sha === EMPTY_SHA256;
        if (!$empty && (is_link($s) || hash_file('sha256', $s) !== $sha)) exit(2);
        for ($d = dirname($p); $d !== ZOER_WEB_ROOT; $d = dirname($d)) { if (is_link($d)) exit(3); }
        if (is_link($p)) exit(4);
        if (!is_dir(dirname($p))) mkdir(dirname($p), 0755, true);
        $tmp = dirname($p) . '/.zoer-copy-' . $plan['id'] . '-' . md5($path);
        if (is_link($tmp)) exit(5);
        if ($empty ? file_put_contents($tmp, '') !== 0 : (!copy($s, $tmp) || hash_file('sha256', $tmp) !== $sha)) exit(6);
        chmod($tmp, 0644);
        if (!rename($tmp, $p)) exit(7);
        $placed++;
    }
    echo json_encode(['ok' => true, 'placed' => $placed]), "\n";
}, 'Local copy operation failed. The partial destination and private staging are retained for inspection or retry.');
