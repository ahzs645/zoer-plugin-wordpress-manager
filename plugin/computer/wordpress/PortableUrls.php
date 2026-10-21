<?php
// Rules of wordpress.portable-urls (portable-urls.php), kept apart so they can be tested on their own.
declare(strict_types=1);
namespace ZoerConnect;

final class PortableUrls {
    /** Text files a theme or plugin carries addresses in. */
    public const TEXT = '/\.(?:php|js|mjs|cjs|css|html?|json|svg|twig|ya?ml|ini)$/i';

    /**
     * `$text` with every full URL of `$hosts` made site-relative, and the number of URLs changed:
     * https://host/a → /a, https://host → /, //host:8080/a → /a, JSON https:\/\/host\/a → \/a.
     * A longer host that only starts with one of `$hosts` (host.example.org) is left alone.
     */
    public static function text(string $text, array $hosts): array {
        $count = 0;
        foreach ($hosts as $host) {
            $h = preg_quote((string)$host, '~');
            $text = (string)preg_replace('~(?:https?:)?\\\\/\\\\/' . $h . '(?::\d{1,5})?(?![A-Za-z0-9.-])(?:\\\\/)?~i', '\\/', $text, -1, $escaped);
            $text = (string)preg_replace('~(?:https?:)?//' . $h . '(?::\d{1,5})?(?![A-Za-z0-9.-])/?~i', '/', $text, -1, $plain);
            $count += $escaped + $plain;
        }
        return [$text, $count];
    }

    /** The theme and plugin folders an export includes: `all`, or the selected slugs. */
    public static function roots(array $plan): array {
        $roots = [];
        foreach (['themes', 'plugins'] as $kind) {
            $choice = $plan[$kind] ?? false;
            if ($choice === 'all') { $roots[] = 'wp-content/' . $kind; continue; }
            if (!is_array($choice)) continue;
            foreach ($choice as $slug) if (is_string($slug) && preg_match('/^[A-Za-z0-9][A-Za-z0-9._-]{0,199}$/D', $slug)) $roots[] = 'wp-content/' . $kind . '/' . $slug;
        }
        return $roots;
    }
}
