<?php
/**
 * Disposable content for static-export qualification on an authorized DDEV test site.
 * Run remotely through the site's supported WordPress terminal with WordPress loaded:
 *
 * ZOER_STATIC_FIXTURE_SITE_ID=<allowed id> ZOER_STATIC_FIXTURE_HOME=<exact home URL> \
 *   wp eval-file <private staged script> baseline|setup|inspect|cleanup
 *
 * The script never changes existing posts, themes, plugins or site settings. It creates
 * its own posts, category, public fixture assets and one bookkeeping option in the
 * existing WordPress database. Cleanup refuses content changed since fixture creation.
 */
if (!defined('ABSPATH') || PHP_SAPI !== 'cli') {
    throw new RuntimeException('Run through WP-CLI on an authorized test site.');
}

$allowed_sites = array(
    'ddev-zoer-connect-040-source',
    'ddev-zoer-connect-040-destination',
    'ddev-zoer-connect-0314-compatibility',
);
$site_id = (string) getenv('ZOER_STATIC_FIXTURE_SITE_ID');
$expected_home = rtrim((string) getenv('ZOER_STATIC_FIXTURE_HOME'), '/');
$actual_home = rtrim(home_url('/'), '/');
if (!in_array($site_id, $allowed_sites, true) || !$expected_home || $expected_home !== $actual_home) {
    throw new RuntimeException('An allowed test-site ID and its exact current home URL are required.');
}

$mode = isset($args[0]) ? (string) $args[0] : 'inspect';
$option = 'zoer_static_export_fixture_v1';
$state = get_option($option, null);
$emit = static function ($value) {
    echo "ZOER_STATIC_FIXTURE_JSON_BEGIN\n" . wp_json_encode($value, JSON_PRETTY_PRINT | JSON_UNESCAPED_SLASHES) . "\nZOER_STATIC_FIXTURE_JSON_END\n";
};

if ($mode === 'baseline') {
    global $wpdb;
    $rows = $wpdb->get_results("SELECT ID,post_type,post_status,post_title,post_name,post_content,post_excerpt,post_parent,post_modified FROM {$wpdb->posts} ORDER BY ID", ARRAY_A);
    $posts = array();
    foreach ($rows as $row) {
        $posts[(string) $row['ID']] = hash('sha256', wp_json_encode($row));
    }
    $keys = array('home', 'siteurl', 'blogname', 'posts_per_page', 'show_on_front', 'page_on_front', 'page_for_posts', 'stylesheet', 'template', 'active_plugins', 'permalink_structure');
    $options = array();
    foreach ($keys as $key) {
        $options[$key] = get_option($key);
    }
    $emit(array('siteId' => $site_id, 'home' => $actual_home, 'posts' => $posts, 'options' => $options));
    return;
}

if ($mode === 'inspect') {
    $emit(array('siteId' => $site_id, 'home' => $actual_home, 'fixture' => $state));
    return;
}

if ($mode === 'cleanup') {
    if (!$state) {
        $emit(array('cleaned' => true, 'alreadyAbsent' => true));
        return;
    }
    if (!is_array($state) || ($state['home'] ?? '') !== $actual_home || !preg_match('/^[a-f0-9]{12}$/', $state['marker'] ?? '')) {
        throw new RuntimeException('The saved fixture does not match this site.');
    }
    foreach ($state['posts'] as $entry) {
        $post = get_post($entry['id']);
        if (!$post) {
            continue;
        }
        if (get_post_meta($post->ID, '_zoer_static_fixture', true) !== $state['marker'] || hash('sha256', $post->post_content) !== $entry['contentSha256']) {
            throw new RuntimeException('Fixture content changed; refusing cleanup of post ' . $entry['id']);
        }
    }
    $uploads = wp_upload_dir();
    $root = trailingslashit($uploads['basedir']) . 'zoer-static-export-' . $state['marker'];
    foreach ($state['files'] as $entry) {
        $path = $root . '/' . $entry['path'];
        if (is_link($path) || (is_file($path) && hash_file('sha256', $path) !== $entry['sha256'])) {
            throw new RuntimeException('Fixture asset changed; refusing cleanup of ' . $entry['path']);
        }
    }
    if (!empty($state['categoryId']) && get_term_meta($state['categoryId'], '_zoer_static_fixture', true) !== $state['marker']) {
        throw new RuntimeException('Fixture category ownership changed.');
    }
    foreach ($state['posts'] as $entry) {
        if (get_post($entry['id'])) {
            wp_delete_post($entry['id'], true);
        }
    }
    if (!empty($state['categoryId'])) {
        wp_delete_term($state['categoryId'], 'category');
    }
    foreach ($state['files'] as $entry) {
        $path = $root . '/' . $entry['path'];
        if (is_file($path) && !unlink($path)) {
            throw new RuntimeException('Could not remove fixture asset ' . $entry['path']);
        }
    }
    foreach (array('/nested', '/media', '') as $suffix) {
        $directory = $root . $suffix;
        if (is_dir($directory) && !rmdir($directory)) {
            throw new RuntimeException('Fixture directory is not empty; preserving its remaining files.');
        }
    }
    delete_option($option);
    $emit(array('cleaned' => true, 'removedPosts' => count($state['posts'])));
    return;
}

if ($mode !== 'setup') {
    throw new RuntimeException('Choose baseline, setup, inspect or cleanup.');
}
if ($state) {
    $emit(array('alreadyExists' => true, 'fixture' => $state));
    return;
}

$marker = substr(bin2hex(random_bytes(12)), 0, 12);
$state = array('v' => 1, 'marker' => $marker, 'siteId' => $site_id, 'home' => $actual_home, 'createdAt' => gmdate('c'), 'complete' => false, 'posts' => array(), 'files' => array());
$save = static function () use (&$state, $option) {
    update_option($option, $state, false);
};
$save();
$category = wp_insert_term('Static export fixture ' . $marker, 'category', array('slug' => 'zoer-static-export-' . $marker));
if (is_wp_error($category)) {
    throw new RuntimeException($category->get_error_message());
}
$state['categoryId'] = (int) $category['term_id'];
update_term_meta($state['categoryId'], '_zoer_static_fixture', $marker);
$save();

$uploads = wp_upload_dir();
if (!empty($uploads['error'])) {
    throw new RuntimeException($uploads['error']);
}
$asset_root = trailingslashit($uploads['basedir']) . 'zoer-static-export-' . $marker;
$asset_url = trailingslashit($uploads['baseurl']) . 'zoer-static-export-' . $marker;
$svg = '<svg xmlns="http://www.w3.org/2000/svg" width="32" height="32"><defs><linearGradient id="g"><stop stop-color="#2563eb"/><stop offset="1" stop-color="#22c55e"/></linearGradient></defs><rect width="32" height="32" fill="url(#g)"/></svg>';
$files = array(
    'fixture.css' => '@import "nested/palette.css"; .zoer-static-fixture{background-image:url("./media/pattern.svg");border:4px solid var(--fixture-color);padding:1rem}.zoer-static-fixture img{width:32px;height:32px}',
    'nested/palette.css' => ':root{--fixture-color:#2563eb}.fixture-inline{background-image:url("data:image/svg+xml,%3Csvg xmlns=%27http://www.w3.org/2000/svg%27/%3E")}',
    'media/pattern.svg' => $svg,
    'media/image.svg' => $svg,
    'media/image@2x.svg' => $svg,
    'fixture.js' => 'import {text} from "./nested/message.js";const button=document.querySelector("#static-fixture-action");button?.addEventListener("click",()=>{document.querySelector("#static-fixture-result").textContent=text;});',
    'nested/message.js' => 'export const text="Static module interaction works";',
);
foreach ($files as $relative => $bytes) {
    $path = $asset_root . '/' . $relative;
    if (!wp_mkdir_p(dirname($path)) || file_put_contents($path, $bytes) !== strlen($bytes)) {
        throw new RuntimeException('Could not create fixture asset ' . $relative);
    }
    $state['files'][] = array('path' => $relative, 'sha256' => hash('sha256', $bytes));
    $save();
}

$create = static function ($kind, $slug, $title, $content, $date = null) use (&$state, $marker, $save) {
    $data = array('post_type' => $kind, 'post_status' => 'publish', 'post_title' => $title, 'post_name' => $slug . '-' . $marker, 'post_content' => $content, 'meta_input' => array('_zoer_static_fixture' => $marker));
    if ($date !== null) {
        $data['post_date'] = $date;
        $data['post_date_gmt'] = $date;
    }
    if ($kind === 'post') {
        $data['post_category'] = array($state['categoryId']);
    }
    // Preserve this fixture's trusted script/module markup without changing any
    // persistent capability or filter configuration on the site.
    $kses_priority = has_filter('content_save_pre', 'wp_filter_post_kses');
    if ($kses_priority !== false) {
        remove_filter('content_save_pre', 'wp_filter_post_kses', $kses_priority);
    }
    try {
        $id = wp_insert_post($data, true);
    } finally {
        if ($kses_priority !== false) {
            add_filter('content_save_pre', 'wp_filter_post_kses', $kses_priority);
        }
    }
    if (is_wp_error($id)) {
        throw new RuntimeException($id->get_error_message());
    }
    $saved = get_post($id);
    $state['posts'][] = array('id' => $id, 'type' => $kind, 'slug' => $saved->post_name, 'title' => $title, 'url' => get_permalink($id), 'contentSha256' => hash('sha256', $saved->post_content));
    $save();
    return $id;
};

for ($number = 1; $number <= 6; $number++) {
    $create('post', 'static-fixture-post-' . $number, 'Static fixture post ' . $number, '<!-- wp:paragraph --><p data-static-fixture-post="' . $number . '">Unique fixture item ' . $number . '.</p><!-- /wp:paragraph -->', '2020-01-0' . $number . ' 12:00:00');
}

$loop = static function ($id, $order, $enhanced = false) use (&$state) {
    $attributes = array('queryId' => $id, 'query' => array('perPage' => 2, 'pages' => 0, 'offset' => 0, 'postType' => 'post', 'order' => $order, 'orderBy' => 'date', 'author' => '', 'search' => '', 'exclude' => array(), 'sticky' => 'exclude', 'inherit' => false, 'taxQuery' => array('category' => array($state['categoryId']))), 'enhancedPagination' => $enhanced);
    return '<!-- wp:query ' . wp_json_encode($attributes) . ' --><div class="wp-block-query">' .
        '<!-- wp:post-template --><!-- wp:post-title {"isLink":true} /--><!-- wp:post-excerpt /--><!-- /wp:post-template -->' .
        '<!-- wp:query-pagination --><div class="wp-block-query-pagination"><!-- wp:query-pagination-previous /--><!-- wp:query-pagination-numbers /--><!-- wp:query-pagination-next /--></div><!-- /wp:query-pagination -->' .
        '<!-- wp:query-no-results --><!-- wp:paragraph --><p>No fixture posts.</p><!-- /wp:paragraph --><!-- /wp:query-no-results -->' .
        '</div><!-- /wp:query -->';
};
$assets = '<!-- wp:html --><link rel="stylesheet" href="' . esc_url($asset_url . '/fixture.css?ver=1') . '"><div class="zoer-static-fixture"><img alt="Static export fixture" src="' . esc_url($asset_url . '/media/image.svg?ver=2') . '" srcset="' . esc_url($asset_url . '/media/image.svg?ver=1') . ' 1x, ' . esc_url($asset_url . '/media/image@2x.svg') . ' 2x"><button id="static-fixture-action" type="button">Test static module</button><output id="static-fixture-result"></output></div><script type="module" src="' . esc_url($asset_url . '/fixture.js?ver=1') . '"></script><!-- /wp:html -->';
$page_id = $create('page', 'static-fixture-loops', 'Static export pagination fixture', $assets . $loop(7, 'asc') . $loop(9, 'desc'));
$enhanced_id = $create('page', 'static-fixture-enhanced', 'Static export enhanced pagination fixture', $loop(17, 'asc', true));
$dynamic_id = $create('page', 'static-fixture-dynamic', 'Static export dynamic dependencies fixture', '<!-- wp:html --><form method="post" action="' . esc_url(home_url('/wp-admin/admin-ajax.php')) . '"><label>Fixture message <input name="message"></label><button>Send fixture message</button></form><button type="button" data-rest-endpoint="' . esc_url(rest_url('wp/v2/posts')) . '">Requires a live API</button><a href="https://example.com/">External navigation</a><!-- /wp:html -->');
$broken_id = $create('page', 'static-fixture-broken', 'Static export missing asset fixture', '<!-- wp:image --><figure class="wp-block-image"><img src="' . esc_url($asset_url . '/media/required-missing.png') . '" alt="Intentionally missing fixture asset"></figure><!-- /wp:image -->');

$state['routes'] = array(
    'loops' => get_permalink($page_id),
    'loop7Page2' => add_query_arg('query-7-page', 2, get_permalink($page_id)),
    'combined' => add_query_arg(array('query-7-page' => 2, 'query-9-page' => 3), get_permalink($page_id)),
    'combinedReordered' => add_query_arg(array('query-9-page' => 3, 'query-7-page' => 2), get_permalink($page_id)),
    'enhanced' => get_permalink($enhanced_id),
    'dynamic' => get_permalink($dynamic_id),
    'broken' => get_permalink($broken_id),
    'category' => get_category_link($state['categoryId']),
);
$state['expectedLoopTitles'] = array('page1Loop7' => array('Static fixture post 1', 'Static fixture post 2'), 'page2Loop7' => array('Static fixture post 3', 'Static fixture post 4'), 'page3Loop9' => array('Static fixture post 2', 'Static fixture post 1'));
$state['complete'] = true;
$save();
$emit($state);
