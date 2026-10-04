<?php
/**
 * Plugin Name: Zoer Content Modules
 * Description: Import reusable HTML learning modules and insert them with a native Gutenberg block.
 * Version: 0.1.3
 * Requires at least: 6.7
 * Requires PHP: 7.4
 * Author: Zoer
 * License: GPL-2.0-or-later
 */
namespace ZoerContentModules;
defined('ABSPATH') || exit;
require_once __DIR__ . '/includes/package.php';

const VERSION = '0.1.3';
const MAX_UPLOAD = 268435456;
const CHUNK_BYTES = 524288;

add_action('init', function () {
    register_post_type('zcm_module', array(
        'label' => 'Content Modules', 'public' => false, 'show_ui' => false, 'rewrite' => false,
        'map_meta_cap' => false,
        'capabilities' => array_fill_keys(array('edit_post','read_post','delete_post','edit_posts','edit_others_posts','publish_posts','read_private_posts','delete_posts','delete_private_posts','delete_published_posts','delete_others_posts','edit_private_posts','edit_published_posts','create_posts'), 'manage_options'),
    ));
    wp_register_script('zcm-block-editor', plugins_url('block.js', __FILE__), array('wp-blocks','wp-element','wp-components','wp-block-editor','wp-api-fetch','wp-i18n'), VERSION, true);
    wp_register_style('zcm-block', plugins_url('style.css', __FILE__), array(), VERSION);
    register_block_type(__DIR__, array('editor_script' => 'zcm-block-editor', 'style' => 'zcm-block', 'render_callback' => __NAMESPACE__ . '\\render_module'));
});

function module_url($id) {
    $path = get_post_meta($id, '_zcm_entry', true);
    if (!$path || strpos($path, 'zoer-content-modules/') !== 0 || strpos($path, '..') !== false) { return ''; }
    $uploads = wp_upload_dir();
    return trailingslashit($uploads['baseurl']) . implode('/', array_map('rawurlencode', explode('/', $path)));
}

function render_module($attributes) {
    $id = absint(isset($attributes['moduleId']) ? $attributes['moduleId'] : 0);
    $post = get_post($id);
    if (!$post || $post->post_type !== 'zcm_module' || $post->post_status !== 'publish' || !module_url($id)) {
        return '<p class="zcm-unavailable">This content module is currently unavailable.</p>';
    }
    $height = max(320, min(1200, absint(isset($attributes['height']) ? $attributes['height'] : 650)));
    $title = get_the_title($id);
    $url = esc_url(module_url($id));
    $html = '<section ' . get_block_wrapper_attributes(array('class' => 'zcm-content-module')) . '>';
    if (!isset($attributes['showTitle']) || $attributes['showTitle']) {
        $html .= '<h2 class="zcm-module-title">' . esc_html($title) . '</h2>';
    }
    if (!isset($attributes['showOpenLink']) || $attributes['showOpenLink']) {
        $html .= '<p class="zcm-open"><a href="' . $url . '" target="_blank" rel="noopener">Open module in a new tab<span class="screen-reader-text">: ' . esc_html($title) . '</span> <span aria-hidden="true">↗</span></a></p>';
    }
    // Imported HTML is active content; imports are restricted to administrators.
    $html .= '<iframe class="zcm-frame" src="' . $url . '" title="' . esc_attr($title) . '" loading="lazy" allow="fullscreen" allowfullscreen style="height:' . $height . 'px"></iframe></section>';
    return $html;
}

add_action('rest_api_init', function () {
    register_rest_route('zoer-content-modules/v1', '/modules', array(
        'methods' => 'GET',
        'permission_callback' => function () { return current_user_can('edit_posts') || current_user_can('edit_pages'); },
        'callback' => function () {
            return array_map(function ($post) {
                return array('id' => $post->ID, 'title' => $post->post_title, 'url' => module_url($post->ID));
            }, get_posts(array('post_type' => 'zcm_module', 'post_status' => 'publish', 'numberposts' => -1, 'orderby' => 'title', 'order' => 'ASC')));
        },
    ));
});

add_action('admin_menu', function () {
    add_menu_page('Content Modules', 'Content Modules', 'manage_options', 'zoer-content-modules', __NAMESPACE__ . '\\admin_page', 'dashicons-welcome-learn-more', 25);
});

add_action('admin_enqueue_scripts', function ($hook) {
    if ($hook !== 'toplevel_page_zoer-content-modules') { return; }
    wp_enqueue_script('zcm-admin', plugins_url('admin.js', __FILE__), array(), VERSION, true);
    wp_enqueue_style('zcm-admin', plugins_url('admin.css', __FILE__), array(), VERSION);
    wp_localize_script('zcm-admin', 'zcmAdmin', array('url' => admin_url('admin-ajax.php'), 'nonce' => wp_create_nonce('zcm_import'), 'chunkBytes' => CHUNK_BYTES, 'maxBytes' => MAX_UPLOAD));
});

function admin_page() {
    if (!current_user_can('manage_options')) { return; }
    $modules = get_posts(array('post_type' => 'zcm_module', 'post_status' => array('publish','draft'), 'numberposts' => -1, 'orderby' => 'date', 'order' => 'DESC'));
    ?>
    <div class="wrap zcm-admin">
        <h1>Content Modules</h1>
        <p>Import an HTML course, interactive presentation or other self-contained web module. In the page editor, add a <strong>Content Module</strong> block and choose it from your library.</p>
        <div class="zcm-import-card">
            <h2>Import a module</h2>
            <p>Choose a ZIP containing the HTML entry page and its assets. Uploads use small chunks for large packages. Maximum ZIP: 256 MB; expanded size: 1 GB.</p>
            <p>Only import packages you trust. HTML and JavaScript run in your visitors’ browsers. This plugin displays content; it does not provide LMS completion or score tracking.</p>
            <?php if (!class_exists('ZipArchive')) : ?>
                <div class="notice notice-error inline"><p>Your server needs the PHP ZIP extension to import modules.</p></div>
            <?php else : ?>
            <form id="zcm-import-form">
                <label for="zcm-title">Module title</label>
                <input id="zcm-title" name="title" type="text" class="regular-text" maxlength="160" required placeholder="e.g. Wood Smoke Education Course">
                <label for="zcm-file">Module ZIP file</label>
                <input id="zcm-file" name="package" type="file" accept=".zip,application/zip" required>
                <details><summary>Entry page (optional)</summary>
                    <label for="zcm-entry">HTML path inside the ZIP</label>
                    <input id="zcm-entry" name="entry" type="text" class="regular-text" placeholder="Automatically find index.html or story.html">
                </details>
                <p><button type="submit" class="button button-primary">Import module</button></p>
                <progress id="zcm-progress" max="100" value="0" hidden aria-label="Module import progress"></progress>
                <p id="zcm-import-status" role="status" aria-live="polite"></p>
            </form>
            <?php endif; ?>
        </div>
        <h2>Module library</h2>
        <?php if (!$modules) : ?>
            <p>No modules yet. Import your first package above, then select it in a Content Module block.</p>
        <?php else : ?>
        <table class="widefat striped zcm-library"><thead><tr><th>Module</th><th>Package</th><th>Availability</th><th>Actions</th></tr></thead><tbody>
        <?php foreach ($modules as $module) : ?>
            <tr><td><strong><?php echo esc_html($module->post_title); ?></strong><br>Module #<?php echo (int) $module->ID; ?></td>
                <td><?php echo (int) get_post_meta($module->ID, '_zcm_file_count', true); ?> files<br><?php echo esc_html(size_format((int) get_post_meta($module->ID, '_zcm_bytes', true))); ?></td>
                <td><?php echo $module->post_status === 'publish' ? 'Available' : 'Archived'; ?></td>
                <td><a href="<?php echo esc_url(module_url($module->ID)); ?>" target="_blank" rel="noopener">Preview module <span class="screen-reader-text"><?php echo esc_html($module->post_title); ?></span></a>
                    <details><summary>Manage module</summary>
                        <form method="post" action="<?php echo esc_url(admin_url('admin-post.php')); ?>">
                            <input type="hidden" name="action" value="zcm_manage">
                            <input type="hidden" name="module" value="<?php echo (int) $module->ID; ?>">
                            <?php wp_nonce_field('zcm_manage_' . $module->ID); ?>
                            <p><label>Title <input type="text" name="title" value="<?php echo esc_attr($module->post_title); ?>" required maxlength="160"></label></p>
                            <p><label>Availability <select name="status"><option value="publish" <?php selected($module->post_status, 'publish'); ?>>Available</option><option value="draft" <?php selected($module->post_status, 'draft'); ?>>Archived</option></select></label></p>
                            <p>Archiving hides this module from blocks. Its files are retained; direct links remain accessible.</p>
                            <button class="button">Save module</button>
                        </form>
                    </details>
                </td></tr>
        <?php endforeach; ?>
        </tbody></table>
        <?php endif; ?>
    </div>
    <?php
}

add_action('admin_post_zcm_manage', function () {
    if (!current_user_can('manage_options')) { wp_die('Not allowed.', '', array('response' => 403)); }
    $id = absint(isset($_POST['module']) ? $_POST['module'] : 0);
    check_admin_referer('zcm_manage_' . $id);
    if (get_post_type($id) !== 'zcm_module') { wp_die('Module not found.'); }
    $title = sanitize_text_field(wp_unslash(isset($_POST['title']) ? $_POST['title'] : ''));
    if ($title === '') { wp_die('A title is required.'); }
    $status = isset($_POST['status']) && $_POST['status'] === 'draft' ? 'draft' : 'publish';
    $result = wp_update_post(array('ID' => $id, 'post_title' => $title, 'post_status' => $status), true);
    if (is_wp_error($result)) { wp_die(esc_html($result->get_error_message())); }
    wp_safe_redirect(admin_url('admin.php?page=zoer-content-modules'));
    exit;
});

function authorize_import() {
    if (!current_user_can('manage_options')) { wp_send_json_error(array('message' => 'Only administrators can import modules.'), 403); }
    check_ajax_referer('zcm_import', 'nonce');
}

function upload_state() {
    $id = isset($_POST['upload']) ? sanitize_text_field(wp_unslash($_POST['upload'])) : '';
    if (!preg_match('/^[a-f0-9]{32}$/', $id)) { throw new \RuntimeException('Invalid upload session.'); }
    $state = get_transient('zcm_upload_' . $id);
    if (!$state || (int) $state['user'] !== get_current_user_id()) { throw new \RuntimeException('The upload session expired. Please import the ZIP again.'); }
    return array($id, $state);
}

function import_error($error) { wp_send_json_error(array('message' => $error->getMessage()), 400); }

add_action('wp_ajax_zcm_begin', function () {
    authorize_import();
    try {
        if (!class_exists('ZipArchive')) { throw new \RuntimeException('The PHP ZIP extension is required.'); }
        $size = isset($_POST['size']) ? (int) $_POST['size'] : 0;
        $title = sanitize_text_field(wp_unslash(isset($_POST['title']) ? $_POST['title'] : ''));
        if ($size < 1 || $size > MAX_UPLOAD || $title === '' || strlen($title) > 640) { throw new \RuntimeException('Supply a title and a ZIP file no larger than 256 MB.'); }
        $id = bin2hex(random_bytes(16));
        $temp = trailingslashit(get_temp_dir());
        // Clean only abandoned directories created by this plugin, at a bounded rate.
        $old = glob($temp . 'zcm-upload-*', GLOB_ONLYDIR);
        foreach (array_slice($old ?: array(), 0, 20) as $directory) {
            if (preg_match('/\/zcm-upload-[a-f0-9]{32}$/', $directory) && !is_link($directory) && filemtime($directory) < time() - DAY_IN_SECONDS) {
                if (is_file($directory . '/package.zip')) { unlink($directory . '/package.zip'); }
                @rmdir($directory);
            }
        }
        $directory = $temp . 'zcm-upload-' . $id;
        if (!mkdir($directory, 0700) || file_put_contents($directory . '/package.zip', '') === false) { throw new \RuntimeException('Could not create temporary upload storage.'); }
        $state = array('user' => get_current_user_id(), 'size' => $size, 'title' => $title, 'entry' => trim(wp_unslash(isset($_POST['entry']) ? $_POST['entry'] : '')), 'path' => $directory . '/package.zip');
        set_transient('zcm_upload_' . $id, $state, 12 * HOUR_IN_SECONDS);
        wp_send_json_success(array('upload' => $id));
    } catch (\Throwable $error) { import_error($error); }
});

add_action('wp_ajax_zcm_chunk', function () {
    authorize_import();
    $output = null;
    try {
        list($id, $state) = upload_state();
        if (isset($state['module'])) { throw new \RuntimeException('This upload has already been imported.'); }
        $file = isset($_FILES['chunk']) ? $_FILES['chunk'] : null;
        if (!$file || $file['error'] !== UPLOAD_ERR_OK || !is_uploaded_file($file['tmp_name']) || $file['size'] < 1 || $file['size'] > CHUNK_BYTES) { throw new \RuntimeException('Upload chunk failed. Please retry the import.'); }
        $output = fopen($state['path'], 'c+b');
        if (!$output || !flock($output, LOCK_EX)) { throw new \RuntimeException('The upload is busy. Please retry.'); }
        $offset = isset($_POST['offset']) ? (int) $_POST['offset'] : -1;
        $current = fstat($output)['size'];
        if ($offset !== $current || $current + $file['size'] > $state['size']) { throw new \RuntimeException('Upload offset mismatch. Please restart the import.'); }
        fseek($output, 0, SEEK_END);
        $input = fopen($file['tmp_name'], 'rb');
        $written = $input ? stream_copy_to_stream($input, $output, CHUNK_BYTES) : false;
        if ($input) { fclose($input); }
        if ($written !== (int) $file['size']) { ftruncate($output, $current); throw new \RuntimeException('Could not store this upload chunk.'); }
        fflush($output);
        flock($output, LOCK_UN);
        fclose($output);
        $output = null;
        wp_send_json_success(array('received' => $current + $written));
    } catch (\Throwable $error) {
        if (is_resource($output)) { flock($output, LOCK_UN); fclose($output); }
        import_error($error);
    }
});

add_action('wp_ajax_zcm_finish', function () {
    authorize_import();
    $lock = null;
    $destination = '';
    $extracted = false;
    $post_id = 0;
    $zip = null;
    try {
        list($id, $state) = upload_state();
        if (isset($state['module'])) { wp_send_json_success(array('module' => $state['module'])); }
        $lock = fopen($state['path'], 'rb');
        if (!$lock || !flock($lock, LOCK_EX | LOCK_NB)) { throw new \RuntimeException('This module is still being imported.'); }
        // Re-read after acquiring the file lock to avoid publishing the same upload twice.
        list($id, $state) = upload_state();
        if (isset($state['module'])) { fclose($lock); wp_send_json_success(array('module' => $state['module'])); }
        if (fstat($lock)['size'] !== (int) $state['size']) { throw new \RuntimeException('The ZIP upload is incomplete.'); }
        $zip = new \ZipArchive();
        if ($zip->open($state['path'], \ZipArchive::CHECKCONS) !== true) { $zip = null; throw new \RuntimeException('The uploaded file is not a valid ZIP archive.'); }
        $plan = Package::inspect($zip, $state['entry']);
        $uploads = wp_upload_dir();
        if ($uploads['error']) { throw new \RuntimeException('The WordPress uploads directory is unavailable.'); }
        $relative = 'zoer-content-modules/' . $id;
        $destination = trailingslashit($uploads['basedir']) . $relative;
        Package::extract($zip, $plan, $destination);
        $extracted = true;
        $zip->close();
        $zip = null;
        $post_id = wp_insert_post(array('post_type' => 'zcm_module', 'post_status' => 'draft', 'post_title' => $state['title']), true);
        if (is_wp_error($post_id)) { $message = $post_id->get_error_message(); $post_id = 0; throw new \RuntimeException($message); }
        $metadata = array('_zcm_entry' => $relative . '/' . $plan['entry'], '_zcm_file_count' => count($plan['files']), '_zcm_bytes' => $plan['bytes'], '_zcm_sha256' => hash_file('sha256', $state['path']));
        foreach ($metadata as $key => $value) {
            if (!add_post_meta($post_id, $key, $value, true)) { throw new \RuntimeException('Could not save module metadata.'); }
        }
        $saved = wp_update_post(array('ID' => $post_id, 'post_status' => 'publish'), true);
        if (is_wp_error($saved)) { throw new \RuntimeException('Could not make this module available.'); }
        $state['module'] = $post_id;
        set_transient('zcm_upload_' . $id, $state, 12 * HOUR_IN_SECONDS);
        flock($lock, LOCK_UN);
        fclose($lock);
        $lock = null;
        unlink($state['path']);
        rmdir(dirname($state['path']));
        wp_send_json_success(array('module' => $post_id, 'files' => count($plan['files'])));
    } catch (\Throwable $error) {
        if ($zip instanceof \ZipArchive) { $zip->close(); }
        if (is_resource($lock)) { flock($lock, LOCK_UN); fclose($lock); }
        if ($post_id) { wp_delete_post($post_id, true); }
        if ($extracted) { Package::remove_created_directory($destination); }
        import_error($error);
    }
});
