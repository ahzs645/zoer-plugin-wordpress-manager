<?php
// Hostinger's website tar.gz + MariaDB sql.gz -> the existing guarded copy snapshot.
// Uploaded PHP/configuration and SQL are never evaluated by this preparer.
declare(strict_types=1);
require_once __DIR__ . '/prepare-updraft.php';

function hosting_path(string $name): string {
    if (str_starts_with($name, './')) $name = substr($name, 2);
    $name = rtrim($name, '/');
    if ($name === '') return '';
    if (preg_match('/[\x00-\x1f\\\\]/', $name) || str_starts_with($name, '/') || preg_match('/^[A-Za-z]:/', $name) || array_intersect(explode('/', $name), ['', '.', '..'])) updraft_fail('Unsafe archive path.');
    return $name;
}

function hosting_read($h, int $size): string {
    $data = '';
    while (strlen($data) < $size) {
        $part = gzread($h, $size - strlen($data));
        if ($part === false || $part === '') updraft_fail('Truncated archive.');
        $data .= $part;
    }
    return $data;
}

/** Stream tar members without extracting their names; numeric private staging paths only. */
function hosting_walk(string $source, callable $visit): void {
    $h = gzopen($source, 'rb');
    if (!$h) updraft_fail('Could not read the website archive.');
    $expanded = 0; $count = 0; $longName = null; $paxName = null; $seen = [];
    try {
        while (true) {
            $header = hosting_read($h, 512);
            if ($header === str_repeat("\0", 512)) {
                if ($longName !== null || $paxName !== null || hosting_read($h, 512) !== str_repeat("\0", 512)) updraft_fail('Invalid archive trailer.');
                // Reject concatenated tar archives / hidden trailing members; bound all padding.
                while (!gzeof($h)) { $rest = gzread($h, 1048576); if ($rest === false || trim($rest, "\0") !== '') updraft_fail('Invalid archive trailer.'); $expanded += strlen($rest); if ($expanded > UPDRAFT_MAX_EXPANDED) updraft_fail('Archive exceeds expanded size limits.'); }
                break;
            }
            if (++$count > 100000) updraft_fail('Too many archive members.');
            foreach ([[124,12],[148,8]] as [$start,$length]) if (!preg_match('/^[0-7]+$/D', trim(substr($header,$start,$length), "\0 "))) updraft_fail('Unsupported tar header.');
            $checksum = octdec(trim(substr($header,148,8), "\0 "));
            $sum = array_sum(unpack('C*', substr_replace($header, str_repeat(' ',8),148,8)));
            if ($checksum !== $sum) updraft_fail('Invalid archive checksum.');
            $size = (int)octdec(trim(substr($header,124,12), "\0 "));
            $expanded += 512 + $size + (512 - $size % 512) % 512;
            if ($size > 64 * 1024 ** 2 || $expanded > UPDRAFT_MAX_EXPANDED || $expanded > max(1,filesize($source)) * 1000) updraft_fail('Archive exceeds expanded size or compression limits.');
            $type = $header[156];
            $name = rtrim(substr($header,0,100), "\0");
            $prefix = rtrim(substr($header,345,155), "\0");
            if ($prefix !== '' && substr($header,257,5) === 'ustar') $name = $prefix . '/' . $name;
            if (in_array($type, ['L','x'], true)) {
                if ($size > 65536) updraft_fail('Unsupported extended tar header.');
                $data = hosting_read($h, $size);
                if ($type === 'L') { if ($longName !== null) updraft_fail('Duplicate extended tar path.'); $longName = rtrim($data, "\0"); }
                else {
                    if ($paxName !== null) updraft_fail('Duplicate extended tar path.');
                    $offset = 0;
                    while ($offset < strlen($data)) {
                        if (!preg_match('/\G([1-9][0-9]*) /', $data, $m, 0, $offset)) updraft_fail('Invalid extended tar header.');
                        $length = (int)$m[1];
                        if ($length <= strlen($m[0]) || $length > strlen($data)-$offset) updraft_fail('Invalid extended tar header.');
                        $record = substr($data,$offset+strlen($m[0]),$length-strlen($m[0]));
                        if (!str_ends_with($record,"\n")) updraft_fail('Invalid extended tar header.');
                        [$key,$value] = array_pad(explode('=',rtrim($record,"\n"),2),2,'');
                        if ($key === 'path') { if ($paxName !== null) updraft_fail('Duplicate extended tar path.'); $paxName=$value; }
                        elseif (!in_array($key,['mtime','atime','ctime','uid','gid','uname','gname'],true)) updraft_fail('Unsupported extended tar metadata.');
                        $offset += $length;
                    }
                }
            } else {
                if (!in_array($type, ["\0",'0','5'], true) || trim(substr($header,157,100),"\0") !== '') updraft_fail('Links and special files are unsupported.');
                $name = hosting_path($paxName ?? $longName ?? $name); $longName = null; $paxName = null;
                if ($type === '5' && $size !== 0) updraft_fail('Invalid directory size.');
                if (isset($seen[$name])) updraft_fail('Duplicate archive path.'); $seen[$name] = true;
                $remaining = $size;
                $read = static function (int $bytes) use ($h, &$remaining): string { $bytes = min($bytes,$remaining); $remaining -= $bytes; return $bytes ? hosting_read($h,$bytes) : ''; };
                $visit($name,$size,$type,$read);
                while ($remaining > 0) $read(min(1048576,$remaining));
            }
            $padding = (512 - $size % 512) % 512;
            if ($padding) hosting_read($h,$padding);
        }
    } finally { gzclose($h); }
}

function hosting_prepare(string $root, array $components): array {
    foreach (['database','archive'] as $component) {
        $r = $components[$component] ?? null;
        if (!$r || is_link($r['path']) || !is_file($r['path']) || filesize($r['path']) !== $r['size'] || hash_file('sha256',$r['path']) !== $r['sha256']) updraft_fail('Upload failed its SHA-256 or size check.');
    }
    $roots = []; $configs = [];
    hosting_walk($components['archive']['path'], static function ($name,$size,$type,$read) use (&$roots,&$configs) {
        if ($type === '5') return;
        if (str_ends_with($name,'/wp-includes/version.php') || $name === 'wp-includes/version.php') {
            if ($size > 65536) updraft_fail('Invalid WordPress version file.');
            $text = $read($size);
            if (!preg_match('/\$wp_version\s*=\s*[\'"](\d+\.\d+(?:\.\d+)?)[\'"]/', $text, $m)) updraft_fail('WordPress version is missing.');
            $roots[substr($name,0,-strlen('wp-includes/version.php'))] = $m[1];
        }
        if (str_ends_with($name,'/wp-config.php') || $name === 'wp-config.php') $configs[] = substr($name,0,-strlen('wp-config.php'));
    });
    if (count($roots) !== 1) updraft_fail('Choose an archive containing exactly one WordPress installation.');
    $web = array_key_first($roots);
    if ($configs !== [$web]) updraft_fail('Only standard-root WordPress backups are supported.');
    $prefixes = [];
    $h = gzopen($components['database']['path'],'rb');
    try { foreach (updraft_statements($h) as $sql) if (preg_match('/^CREATE TABLE `([A-Za-z0-9_]{1,48})options` /',$sql,$m)) $prefixes[]=$m[1]; }
    finally { gzclose($h); }
    if (count($prefixes) !== 1) updraft_fail('The database must contain exactly one WordPress options table.');
    $extracted = $root . '/extracted';
    if (is_link($extracted) || (!is_dir($extracted) && !mkdir($extracted,0700,true))) updraft_fail('Invalid private extraction directory.');
    $db = $extracted . '/database.sql';
    if (is_link($db)) updraft_fail('Invalid private extraction path.');
    $metadata = updraft_convert_database($components['database']['path'],$db,['prefix'=>$prefixes[0],'wordpressVersion'=>$roots[$web]]);
    $files = [['path'=>'database.sql','source'=>'extracted/database.sql','bytes'=>filesize($db),'sha256'=>hash_file('sha256',$db)]];
    $warnings = [];
    hosting_walk($components['archive']['path'], static function ($name,$size,$type,$read) use ($web,$root,&$files,&$warnings) {
        if ($type === '5' || !str_starts_with($name,$web.'wp-content/')) return;
        $path = substr($name,strlen($web)); $parts = explode('/',substr($path,11));
        if (in_array($parts[0],array_merge(UPDRAFT_DROP_INS,['mu-plugins','cache','updraft','backups','backup-db']),true) || preg_match('/(^|\/)(?:\.[^\/]+|wp-config\.php|__MACOSX)(\/|$)/i',$path) || preg_match('/^wp-content\/plugins\/zoer-connect(\/|$)/i',$path)) { $warnings[]='Skipped configuration, cache, drop-in, must-use plugin or backup file.'; return; }
        if ($parts[0] === 'uploads' && in_array($parts[1] ?? '', ['wp-migrate-db','updraft','backups'],true)) { $warnings[]='Skipped archived database backup files.'; return; }
        if (strlen($path)>500) updraft_fail('Unsupported content path.');
        if ($parts[0]==='uploads' && preg_match('/\.(php\d*|phtml|phar|cgi|pl|sh)(\.|$)/i',$path)) {
            $content = $size<=256 ? $read($size) : '';
            if (end($parts)!=='index.php' || $size>256 || !in_array(trim($content),["<?php\n// Silence is golden.",'<?php // Silence is golden.'],true)) updraft_fail('Executable upload is unsupported.');
        } else $content = null;
        $source = 'extracted/'.count($files);
        if (is_link($root.'/'.$source)) updraft_fail('Invalid private extraction path.');
        $out = fopen($root.'/'.$source,'wb'); if (!$out) updraft_fail('Could not stage content.');
        try {
            if ($content !== null) fwrite($out,$content);
            else for ($left=$size; $left>0;) { $part=$read(min(1048576,$left)); if (fwrite($out,$part)!==strlen($part)) updraft_fail('Could not stage content.'); $left-=strlen($part); }
        } finally { fclose($out); }
        $files[]=['path'=>$path,'source'=>$source,'bytes'=>$size,'sha256'=>hash_file('sha256',$root.'/'.$source)];
    });
    if (count($files)===1) updraft_fail('The website archive contains no WordPress content.');
    $warnings[]='Restored plugins start inactive. Review and activate the required plugins before publication.';
    $warnings[]='The new local site uses its installed WordPress core; archived core and server configuration are omitted. Check updates and compatibility before publishing.';
    $prepared=['metadata'=>$metadata,'files'=>$files,'warnings'=>array_values(array_unique($warnings))];
    $tmp=$root.'/prepared.json.tmp'; if (is_link($tmp) || is_link($root.'/prepared.json')) updraft_fail('Invalid private extraction path.');
    file_put_contents($tmp,json_encode($prepared,JSON_UNESCAPED_SLASHES|JSON_UNESCAPED_UNICODE|JSON_THROW_ON_ERROR)); chmod($tmp,0600); rename($tmp,$root.'/prepared.json');
    return $prepared;
}

if (realpath($_SERVER['SCRIPT_FILENAME'] ?? '') === __FILE__) {
    require __DIR__.'/lib.php';
    zoer_main(function (): void {
        $plan=zoer_plan(); $stage=zoer_stage($plan['id']); $components=[];
        foreach ((array)($plan['components'] ?? []) as $record) {
            $c=(string)($record['component'] ?? '');
            if (!in_array($c,['database','archive'],true) || isset($components[$c]) || !preg_match('/^[01]$/D',(string)($record['source'] ?? ''))) throw new ZoerCommandError('Invalid backup component.');
            $components[$c]=['path'=>$stage.'/'.$record['source'],'size'=>(int)$record['size'],'sha256'=>(string)$record['sha256']];
        }
        try { $prepared=hosting_prepare($stage,$components); } catch (UpdraftError $e) { throw new ZoerCommandError($e->getMessage()); }
        $m=$prepared['metadata'];
        echo json_encode(['metadata'=>['prefix'=>$m['prefix'],'sourceUrl'=>$m['sourceUrl'],'wordpressVersion'=>$m['wordpressVersion'],'tables'=>$m['tables'],'activePlugins'=>$m['activePlugins']===null?null:true],'warnings'=>$prepared['warnings'],'fileCount'=>count($prepared['files']),'databaseSha256'=>$prepared['files'][0]['sha256']],JSON_UNESCAPED_SLASHES),"\n";
    },'Backup preparation failed. Verify the website archive and database dump and retry.');
}
