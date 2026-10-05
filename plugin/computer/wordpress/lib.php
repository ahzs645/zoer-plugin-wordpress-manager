<?php
// Shared helpers of the WordPress Manager command bundle (runtime.exec.v1 on a DDEV web container).
// Every command reads its plan from inputs/plan.json (Zoer passes inputs as files, never on the
// command line), works inside the private copy stage /var/www/.zoer-local-copy/<id>, and reports a
// user-facing failure as the last stderr line "ZOER_ERROR: <message>".
declare(strict_types=1);

const ZOER_STAGE_ROOT = '/var/www/.zoer-local-copy';
const ZOER_WEB_ROOT = '/var/www/html';

final class ZoerCommandError extends RuntimeException {}

function zoer_fail(string $message, int $code = 1): void {
    fwrite(STDERR, "ZOER_ERROR: " . str_replace(["\r", "\n"], ' ', $message) . "\n");
    exit($code);
}

/** Runs `$main` and turns any exception into one safe failure line. */
function zoer_main(callable $main, string $fallback): void {
    try { $main(); }
    catch (ZoerCommandError $error) { zoer_fail($error->getMessage()); }
    catch (Throwable $error) { zoer_fail($fallback); }
}

function zoer_plan(): array {
    $raw = @file_get_contents(getcwd() . '/inputs/plan.json');
    if ($raw === false || strlen($raw) > 1048576) throw new ZoerCommandError('The command plan is missing.');
    $plan = json_decode($raw, true, 64, JSON_THROW_ON_ERROR);
    if (!is_array($plan) || !preg_match('/^[a-f0-9]{32}$/D', (string)($plan['id'] ?? ''))) throw new ZoerCommandError('The command plan is invalid.');
    return $plan;
}

/** The private stage of a copy job; every parent must be a real directory, never a link. */
function zoer_stage(string $id, bool $create = false): string {
    if (!preg_match('/^[a-f0-9]{32}$/D', $id)) throw new ZoerCommandError('Invalid copy ID.');
    $stage = ZOER_STAGE_ROOT . '/' . $id;
    if ($create) {
        foreach (['/var/www', ZOER_STAGE_ROOT, $stage] as $dir) {
            if (is_link($dir)) throw new ZoerCommandError('The copy stage is not a private directory.');
            if (!is_dir($dir) && !mkdir($dir, 0700, true) && !is_dir($dir)) throw new ZoerCommandError('Could not create the copy stage.');
        }
        chmod($stage, 0700);
    }
    foreach (['/var', '/var/www', ZOER_STAGE_ROOT, $stage] as $dir) if (!is_dir($dir) || is_link($dir)) throw new ZoerCommandError('The copy stage is unavailable.');
    return $stage;
}

/** Runs one command without a shell; returns [exit code, stdout]. */
function zoer_run(array $argv, int $timeout = 1800): array {
    $process = proc_open($argv, [0 => ['file', '/dev/null', 'r'], 1 => ['pipe', 'w'], 2 => ['pipe', 'w']], $pipes, ZOER_WEB_ROOT);
    if (!is_resource($process)) throw new ZoerCommandError('Could not start ' . $argv[0] . '.');
    stream_set_blocking($pipes[1], false); stream_set_blocking($pipes[2], false);
    $out = ''; $err = ''; $deadline = time() + $timeout;
    while (true) {
        $status = proc_get_status($process);
        $out .= (string)stream_get_contents($pipes[1]); $err .= (string)stream_get_contents($pipes[2]);
        if (!$status['running']) break;
        if (time() > $deadline) { proc_terminate($process); throw new ZoerCommandError('A WordPress command timed out.'); }
        usleep(50000);
    }
    $out .= (string)stream_get_contents($pipes[1]); $err .= (string)stream_get_contents($pipes[2]);
    fclose($pipes[1]); fclose($pipes[2]);
    $code = proc_close($process);
    if ($code === -1) $code = $status['exitcode'];
    if ($code !== 0 && $err !== '') fwrite(STDERR, substr($err, -2000));
    return [$code, $out];
}

/** WP-CLI on the site with plugins and themes skipped (as the legacy host engine runs it). */
function zoer_wp(array $args, string $failure, int $timeout = 1800, array $skip = ['--skip-plugins', '--skip-themes']): string {
    [$code, $out] = zoer_run(array_merge(['wp', '--path=' . ZOER_WEB_ROOT], $skip, $args), $timeout);
    if ($code !== 0) throw new ZoerCommandError($failure);
    return $out;
}

function zoer_write(string $path, string $data, int $mode = 0600): void {
    if (is_link($path)) throw new ZoerCommandError('Refusing to write through a link.');
    $tmp = $path . '.tmp-' . bin2hex(random_bytes(6));
    if (file_put_contents($tmp, $data) !== strlen($data)) { @unlink($tmp); throw new ZoerCommandError('Could not write the copy stage.'); }
    chmod($tmp, $mode);
    if (!rename($tmp, $path)) { @unlink($tmp); throw new ZoerCommandError('Could not write the copy stage.'); }
}
