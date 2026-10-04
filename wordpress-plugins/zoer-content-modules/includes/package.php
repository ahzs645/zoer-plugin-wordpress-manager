<?php
namespace ZoerContentModules;

/** Validates the complete archive before any public files are written. */
final class Package {
    const MAX_FILES = 5000;
    const MAX_BYTES = 1073741824;
    const MAX_FILE_BYTES = 268435456;

    public static function inspect(\ZipArchive $zip, $requested_entry = '') {
        if ($zip->numFiles > self::MAX_FILES) {
            throw new \RuntimeException('The package has more than 5,000 entries.');
        }
        $files = array();
        $seen = array();
        $directories = array();
        $file_paths = array();
        $total = 0;
        $extensions = array('html','htm','js','mjs','css','json','map','xml','txt','csv','vtt','srt','gz','png','jpg','jpeg','gif','webp','avif','svg','ico','mp3','mp4','m4a','ogg','oga','ogv','wav','webm','pdf','doc','docx','ppt','pptx','woff','woff2','ttf','otf','eot');
        for ($i = 0; $i < $zip->numFiles; $i++) {
            $stat = $zip->statIndex($i);
            $name = $stat['name'];
            if ($name === '' || preg_match('/[\\\\\x00-\x1f\x7f:]/', $name) || $name[0] === '/') {
                throw new \RuntimeException('The archive contains an unsafe path.');
            }
            $parts = explode('/', rtrim($name, '/'));
            if (array_intersect($parts, array('', '.', '..'))) {
                throw new \RuntimeException('The archive contains an unsafe path.');
            }
            $opsys = 0;
            $attributes = 0;
            $zip->getExternalAttributesIndex($i, $opsys, $attributes);
            $kind = ($attributes >> 16) & 0170000;
            if ($kind !== 0 && $kind !== 0100000 && $kind !== 0040000) {
                throw new \RuntimeException('Links and special files are not supported.');
            }
            if ($parts[0] === '__MACOSX' || in_array(end($parts), array('.DS_Store', '.gitkeep'), true)) {
                continue;
            }
            foreach ($parts as $part) {
                if ($part[0] === '.' || preg_match('/\.(php[0-9]*|phtml|pht|phar|cgi|pl|py|sh|shtml|asp|aspx)(\.|$)/i', $part)) {
                    throw new \RuntimeException('Server scripts and hidden configuration files are not allowed.');
                }
            }
            $key = strtolower(rtrim($name, '/'));
            if (isset($seen[$key])) {
                throw new \RuntimeException('The archive contains duplicate or case-conflicting paths.');
            }
            $seen[$key] = true;
            $parent_parts = $parts;
            array_pop($parent_parts);
            $parent = '';
            foreach ($parent_parts as $part) {
                $parent = $parent === '' ? $part : $parent . '/' . $part;
                $parent_key = strtolower($parent);
                if (isset($file_paths[$parent_key]) || (isset($directories[$parent_key]) && $directories[$parent_key] !== $parent)) {
                    throw new \RuntimeException('The archive contains conflicting file and directory paths.');
                }
                $directories[$parent_key] = $parent;
            }
            if (substr($name, -1) === '/') {
                $directory = rtrim($name, '/');
                if (isset($file_paths[$key]) || (isset($directories[$key]) && $directories[$key] !== $directory)) {
                    throw new \RuntimeException('The archive contains conflicting directory paths.');
                }
                $directories[$key] = $directory;
                continue;
            }
            if (isset($directories[$key])) {
                throw new \RuntimeException('The archive contains conflicting file and directory paths.');
            }
            $file_paths[$key] = true;
            if (!in_array(strtolower(pathinfo($name, PATHINFO_EXTENSION)), $extensions, true)) {
                throw new \RuntimeException('Unsupported file type: ' . basename($name));
            }
            if (!empty($stat['encryption_method'])) {
                throw new \RuntimeException('Password-protected archives are not supported.');
            }
            $size = (int) $stat['size'];
            $total += $size;
            if ($size < 0 || $size > self::MAX_FILE_BYTES || $total > self::MAX_BYTES) {
                throw new \RuntimeException('The expanded package exceeds the size limit.');
            }
            $files[] = array('name' => $name, 'size' => $size, 'crc' => sprintf('%08x', $stat['crc']));
        }
        $names = array_column($files, 'name');
        if ($requested_entry !== '') {
            if (!in_array($requested_entry, $names, true) || !preg_match('/\.html?$/i', $requested_entry)) {
                throw new \RuntimeException('The entry file must be an HTML file inside the package.');
            }
            $entry = $requested_entry;
        } else {
            $candidates = array_values(array_filter($names, function ($name) {
                return in_array(strtolower(basename($name)), array('index.html', 'index.htm', 'story.html', 'story_html5.html'), true);
            }));
            usort($candidates, function ($a, $b) {
                $rank = array('index.html' => 0, 'index.htm' => 1, 'story.html' => 2, 'story_html5.html' => 3);
                return array(substr_count($a, '/'), $rank[strtolower(basename($a))], $a) <=> array(substr_count($b, '/'), $rank[strtolower(basename($b))], $b);
            });
            if (!$candidates) {
                throw new \RuntimeException('No entry page found. Specify the package’s HTML entry file.');
            }
            $entry = $candidates[0];
        }
        return array('files' => $files, 'entry' => $entry, 'bytes' => $total);
    }

    public static function extract(\ZipArchive $zip, array $plan, $destination) {
        if (file_exists($destination) || !mkdir($destination, 0755, true)) {
            throw new \RuntimeException('Could not create a new module directory.');
        }
        try {
            foreach ($plan['files'] as $file) {
                $target = $destination . '/' . $file['name'];
                if (!is_dir(dirname($target)) && !mkdir(dirname($target), 0755, true)) {
                    throw new \RuntimeException('Could not create a module subdirectory.');
                }
                $input = $zip->getStream($file['name']);
                $output = fopen($target, 'xb');
                if (!$input || !$output) {
                    if (is_resource($input)) { fclose($input); }
                    if (is_resource($output)) { fclose($output); }
                    throw new \RuntimeException('Could not extract a module file.');
                }
                $count = 0;
                $hash = hash_init('crc32b');
                try {
                    while (!feof($input)) {
                        $chunk = fread($input, 1048576);
                        if ($chunk === false || ($chunk === '' && !feof($input))) {
                            throw new \RuntimeException('Could not read a module file.');
                        }
                        $count += strlen($chunk);
                        if ($count > $file['size'] || fwrite($output, $chunk) !== strlen($chunk)) {
                            throw new \RuntimeException('A module file is corrupt or the disk is full.');
                        }
                        hash_update($hash, $chunk);
                    }
                } finally {
                    fclose($input);
                    fclose($output);
                }
                if ($count !== $file['size'] || hash_final($hash) !== $file['crc']) {
                    throw new \RuntimeException('A module file failed its integrity check.');
                }
                chmod($target, 0644);
            }
        } catch (\Throwable $error) {
            self::remove_created_directory($destination);
            throw $error;
        }
    }

    /** Only called for the unique directory created by this import attempt. */
    public static function remove_created_directory($directory) {
        if (!is_dir($directory)) { return; }
        $iterator = new \RecursiveIteratorIterator(new \RecursiveDirectoryIterator($directory, \FilesystemIterator::SKIP_DOTS), \RecursiveIteratorIterator::CHILD_FIRST);
        foreach ($iterator as $file) {
            if ($file->isDir() && !$file->isLink()) { rmdir($file->getPathname()); }
            else { unlink($file->getPathname()); }
        }
        rmdir($directory);
    }
}
