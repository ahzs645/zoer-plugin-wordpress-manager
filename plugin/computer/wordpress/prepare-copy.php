<?php
// wordpress.copy.prepare: private stage, "pending" marker, the guard must-use plugin (503 to web
// visitors while pending; mail and outgoing HTTP disabled) and DISABLE_WP_CRON — the first step of
// the legacy host engine's local copy (`wordpress-local-copy.ts` "creating").
declare(strict_types=1);
require __DIR__ . '/lib.php';
zoer_main(function (): void {
    $plan = zoer_plan();
    $stage = zoer_stage($plan['id'], true);
    $mu = ZOER_WEB_ROOT . '/wp-content/mu-plugins';
    if (is_link($mu) || (!is_dir($mu) && !mkdir($mu, 0755, true) && !is_dir($mu))) throw new ZoerCommandError('Could not prepare the local site.');
    zoer_write($stage . '/pending', 'pending');
    $guard = "<?php if (is_file(" . json_encode($stage . '/pending') . ")) { if (PHP_SAPI !== 'cli') { http_response_code(503); exit('Local copy is being prepared.'); } } add_filter('pre_wp_mail', '__return_false'); add_filter('pre_http_request', static fn()=>new WP_Error('local_copy','Outbound requests are disabled in this local copy.'));";
    zoer_write($mu . '/zoer-local-copy.php', $guard, 0644);
    zoer_wp(['config', 'set', 'DISABLE_WP_CRON', 'true', '--raw'], 'Could not disable WordPress cron on the local copy.', 120);
    echo json_encode(['ok' => true, 'stage' => true]), "\n";
}, 'Local copy operation failed. The partial destination and private staging are retained for inspection or retry.');
