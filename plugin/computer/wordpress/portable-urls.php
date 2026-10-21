<?php
// wordpress.portable-urls: before a push's export, theme and plugin text files that spell out this
// local site's own address (Site Editor patterns save image and link URLs in full) get site-relative
// URLs instead: https://<local host>/wp-content/x.jpg becomes /wp-content/x.jpg, which works here
// and on every live site. Zoer Connect replaces addresses only in the database and files travel
// byte for byte, so this is done on the source, as WP Migrate filters wp-config.php into a temporary
// copy before sending it. Originals are kept in the private stage; only exact local host names
// change (never a longer host that merely starts with one), and links are never followed.
declare(strict_types=1);
require __DIR__ . '/lib.php';
require_once __DIR__ . '/PortableUrls.php';
use ZoerConnect\PortableUrls;

const ZOER_PORTABLE_MAX_BYTES = 4194304;

/** The local site's host names: the plan's address, then WordPress's own home and siteurl. */
function zoer_portable_hosts(array $plan): array {
    $hosts = [];
    $add = static function ($url) use (&$hosts): void {
        $host = is_string($url) ? strtolower((string)parse_url(trim($url), PHP_URL_HOST)) : '';
        if ($host !== '' && preg_match('/^[a-z0-9](?:[a-z0-9.-]{0,251}[a-z0-9])?$/D', $host) && str_contains($host, '.')) $hosts[$host] = true;
    };
    $add($plan['sourceUrl'] ?? null);
    foreach (['home', 'siteurl'] as $option) {
        try { $add(trim(zoer_wp(['option', 'get', $option], 'Could not read the site address.', 60))); } catch (ZoerCommandError $error) { /* The plan's address is enough. */ }
    }
    return array_keys($hosts);
}

zoer_main(function (): void {
    $plan = zoer_plan();
    $hosts = zoer_portable_hosts($plan);
    // Kept apart from the copy stages (an export releases those): /var/www/.zoer-portable/<export ID>.
    $stage = '/var/www/.zoer-portable/' . $plan['id'];
    foreach (['/var/www', '/var/www/.zoer-portable'] as $dir) if (is_link($dir)) throw new ZoerCommandError('The copy store is not a private directory.');
    $changed = []; $urls = 0;
    if ($hosts) foreach (PortableUrls::roots($plan) as $relative) {
        $root = ZOER_WEB_ROOT . '/' . $relative;
        if (is_link($root) || !is_dir($root)) continue;
        $walk = new RecursiveIteratorIterator(new RecursiveDirectoryIterator($root, FilesystemIterator::SKIP_DOTS), RecursiveIteratorIterator::LEAVES_ONLY);
        foreach ($walk as $entry) {
            $path = substr($entry->getPathname(), strlen(ZOER_WEB_ROOT) + 1);
            if ($entry->isLink() || !$entry->isFile() || !preg_match(PortableUrls::TEXT, $path) || $entry->getSize() > ZOER_PORTABLE_MAX_BYTES) continue;
            if (preg_match('~/(?:\.|node_modules/|__MACOSX/)~', '/' . $path)) continue;
            $text = @file_get_contents($entry->getPathname());
            if ($text === false || !preg_match('~' . implode('|', array_map(static fn ($h) => preg_quote($h, '~'), $hosts)) . '~i', $text)) continue;
            [$portable, $count] = PortableUrls::text($text, $hosts);
            if (!$count || $portable === $text) continue;
            $backup = $stage . '/' . $path;
            if (!is_dir(dirname($backup)) && !mkdir(dirname($backup), 0700, true) && !is_dir(dirname($backup))) throw new ZoerCommandError('Could not keep a copy of a theme or plugin file.');
            if (!is_file($backup)) zoer_write($backup, $text, 0600);
            zoer_write($entry->getPathname(), $portable, fileperms($entry->getPathname()) & 0777);
            $changed[] = $path; $urls += $count;
        }
    }
    echo json_encode(['ok' => true, 'files' => count($changed), 'urls' => $urls, 'changed' => array_slice($changed, 0, 20)], JSON_UNESCAPED_SLASHES), "\n";
}, 'Could not make the theme and plugin addresses portable. Nothing was exported.');
