<?php
namespace ZoerContentModules;
if (!class_exists(__NAMESPACE__ . '\\Package')) { require dirname(__DIR__) . '/includes/package.php'; }

$root = sys_get_temp_dir() . '/zcm-tests-' . bin2hex(random_bytes(8));
mkdir($root, 0700);
$checks = 0;
function check($condition, $message) {
    global $checks;
    if (!$condition) { throw new \RuntimeException($message); }
    $checks++;
}
function archive($name, $files) {
    global $root;
    $zip = new \ZipArchive();
    $zip->open($root . '/' . $name . '.zip', \ZipArchive::CREATE);
    foreach ($files as $path => $content) { $zip->addFromString($path, $content); }
    $zip->close();
    $zip->open($root . '/' . $name . '.zip');
    return $zip;
}
function refuses($name, $files, $entry = '') {
    $zip = archive($name, $files);
    try {
        Package::inspect($zip, $entry);
        throw new \LogicException('Accepted unsafe fixture: ' . $name);
    } catch (\RuntimeException $error) {
        check(true, $name);
    } finally { $zip->close(); }
}
try {
    $zip = archive('valid', array('fbc/index.html' => '<h1>Course</h1>', 'fbc/js/app.js' => 'console.log("course");', 'fbc/images/a b.png' => "\x89PNG", '__MACOSX/._index.html' => 'metadata', 'fbc/.DS_Store' => 'metadata'));
    $plan = Package::inspect($zip);
    check($plan['entry'] === 'fbc/index.html', 'Nested entry was not detected.');
    check(count($plan['files']) === 3, 'OS metadata was not excluded.');
    Package::extract($zip, $plan, $root . '/module');
    check(file_get_contents($root . '/module/fbc/images/a b.png') === "\x89PNG", 'Asset bytes changed.');
    check(file_get_contents($root . '/module/fbc/index.html') === '<h1>Course</h1>', 'Entry was not extracted.');
    $zip->close();
    refuses('traversal', array('../outside.js' => 'bad', 'index.html' => 'ok'));
    refuses('absolute', array('/outside.js' => 'bad', 'index.html' => 'ok'));
    refuses('backslash', array('..\\outside.js' => 'bad', 'index.html' => 'ok'));
    refuses('configuration', array('.htaccess' => 'bad', 'index.html' => 'ok'));
    refuses('php', array('server.php' => '<?php', 'index.html' => 'ok'));
    refuses('double-extension', array('server.php.jpg' => '<?php', 'index.html' => 'ok'));
    refuses('hidden-folder', array('.git/config.txt' => 'bad', 'index.html' => 'ok'));
    refuses('case-collision', array('index.html' => 'a', 'INDEX.html' => 'b'));
    refuses('directory-case-collision', array('index.html' => 'ok', 'Assets/a.js' => 'a', 'assets/b.js' => 'b'));
    refuses('file-parent-collision', array('index.html' => 'ok', 'assets.js' => 'a', 'assets.js/b.js' => 'b'));
    refuses('parent-file-collision', array('index.html' => 'ok', 'assets.js/b.js' => 'b', 'assets.js' => 'a'));
    refuses('missing-entry', array('lesson.js' => 'only js'));
    refuses('wrong-entry', array('index.html' => 'ok', 'code.js' => 'code'), 'code.js');
    $zip = archive('symlink', array('index.html' => 'ok', 'link.js' => '/etc/passwd'));
    $zip->setExternalAttributesName('link.js', \ZipArchive::OPSYS_UNIX, 0120777 << 16);
    $zip->close();
    $zip->open($root . '/symlink.zip');
    try { Package::inspect($zip); throw new \LogicException('Accepted symlink.'); }
    catch (\RuntimeException $error) { check(true, 'symlink rejected'); }
    $zip->close();
    $zip = archive('crc', array('index.html' => 'ok'));
    $plan = Package::inspect($zip);
    $plan['files'][0]['crc'] = '00000000';
    try { Package::extract($zip, $plan, $root . '/bad-crc'); throw new \LogicException('Accepted incorrect CRC.'); }
    catch (\RuntimeException $error) { check(!file_exists($root . '/bad-crc'), 'Failed extraction left files behind.'); }
    $zip->close();
    $zip = archive('size', array('index.html' => 'content'));
    $plan = Package::inspect($zip);
    $plan['files'][0]['size'] = 2;
    try { Package::extract($zip, $plan, $root . '/bad-size'); throw new \LogicException('Accepted incorrect size.'); }
    catch (\RuntimeException $error) { check(!file_exists($root . '/bad-size'), 'Size failure left files behind.'); }
    $zip->close();
    $zip = archive('existing', array('index.html' => 'new'));
    $plan = Package::inspect($zip);
    try { Package::extract($zip, $plan, $root . '/module'); throw new \LogicException('Overwrote an existing directory.'); }
    catch (\RuntimeException $error) { check(file_get_contents($root . '/module/fbc/index.html') === '<h1>Course</h1>', 'Existing content was not preserved.'); }
    $zip->close();
    echo json_encode(array('pass' => true, 'checks' => $checks)) . "\n";
} finally {
    Package::remove_created_directory($root);
}
