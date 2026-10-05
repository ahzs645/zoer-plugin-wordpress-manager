<?php
// Runs only in a newly created DDEV copy, with WordPress plugins/themes skipped.
require_once __DIR__.'/SnapshotStream.php';
require_once __DIR__.'/Replacement.php';
$root=__DIR__;
$plan=json_decode(file_get_contents($root.'/plan.json'),true,512,JSON_THROW_ON_ERROR);
if(ABSPATH!=='/var/www/html/' || !preg_match('/^[a-f0-9]{32}$/D',$plan['id']??'') || !str_contains($root,$plan['id']))throw new RuntimeException('Copy destination mismatch.');
$lock=fopen($root.'/import.lock','c');if(!flock($lock,LOCK_EX|LOCK_NB))throw new RuntimeException('Import already running.');
if(is_file($root.'/database-complete.json')){echo "DATABASE_READY\n";return;}
global $wpdb;
$prefix=$plan['prefix'];if(!preg_match('/^[A-Za-z0-9_]{1,48}$/D',$prefix))throw new RuntimeException('Invalid source prefix.');
$source=$root.'/'.$plan['databaseIndex'];
if(hash_file('sha256',$source)!==$plan['databaseSha256'])throw new RuntimeException('Database digest mismatch.');
$query=static function($sql)use($wpdb){if($wpdb->query($sql)===false)throw new RuntimeException('Local database operation failed.');};
$journal=$root.'/tables.json';
if(is_file($journal)){
 $tables=json_decode(file_get_contents($journal),true,512,JSON_THROW_ON_ERROR);
 // Rename is atomic: backup table presence distinguishes a lost rename response.
 $renamed=0;foreach($tables as $t)if($t['hadOld']&&$wpdb->get_var($wpdb->prepare('SHOW TABLES LIKE %s',$wpdb->esc_like($t['backup'])))===$t['backup'])$renamed++;
 $oldCount=count(array_filter($tables,fn($t)=>$t['hadOld']));
 if($renamed){if($renamed!==$oldCount)throw new RuntimeException('Unexpected partial table cutover.');file_put_contents($root.'/database-complete.json',json_encode(['tables'=>count($tables)]));echo "DATABASE_READY\n";return;}
 foreach($tables as $t)$query('DROP TABLE IF EXISTS `'.$t['stage'].'`');
}
$cursor=\ZoerConnect\SnapshotStream::initial();$schemas=[];$tables=[];
while(!$cursor['done']){
 $batch=\ZoerConnect\SnapshotStream::read($source,[],$cursor,250,true);$cursor=$batch['cursor'];
 foreach($batch['records'] as $record){
  $table=$record['table'];if(!str_starts_with($table,$prefix))throw new RuntimeException('Out-of-scope source table.');
  $suffix=substr($table,strlen($prefix));if(!preg_match('/^[A-Za-z0-9_]{1,48}$/D',$suffix))throw new RuntimeException('Invalid table suffix.');
  if(in_array($suffix,['users','usermeta'],true))continue;
  $schema=\ZoerConnect\SnapshotStream::schema($record['schema'],$table);
  // Source DDL is limited to one ordinary InnoDB CREATE; no cross-database or file clauses.
  if(!str_starts_with($schema,'(')||!preg_match('/\) ENGINE=InnoDB\b/',$schema)||preg_match('/;|\/\*|--|\b(?:SELECT|REFERENCES|FOREIGN|TRIGGER|TABLESPACE|DIRECTORY|UNION|INTO|OUTFILE|LOAD)\b/i',$schema))throw new RuntimeException('Unsupported source schema.');
  $target=$wpdb->prefix.$suffix;$token=substr(hash('sha256',$plan['id'].$table),0,16);
  $tables[$table]=['target'=>$target,'stage'=>'zc_c_'.$token,'backup'=>'zc_b_'.$token,'hadOld'=>$wpdb->get_var($wpdb->prepare('SHOW TABLES LIKE %s',$wpdb->esc_like($target)))===$target,'schema'=>$schema,'suffix'=>$suffix];
  $schemas[$table]=$record['schema'];
 }
}
if(!isset($tables[$prefix.'options'],$tables[$prefix.'posts']))throw new RuntimeException('Core WordPress tables missing.');
file_put_contents($journal,json_encode($tables,JSON_THROW_ON_ERROR));
foreach($tables as $t){$query('DROP TABLE IF EXISTS `'.$t['stage'].'`');$query('CREATE TABLE `'.$t['stage'].'` '.$t['schema']);}
$admin=(int)$wpdb->get_var("SELECT ID FROM `{$wpdb->users}` ORDER BY ID LIMIT 1");if(!$admin)throw new RuntimeException('Local administrator missing.');
$rules=[];foreach(array_unique([$plan['sourceUrl'],str_replace('https://','http://',$plan['sourceUrl'])]) as $url)$rules[]=['find'=>$url,'replace'=>$plan['targetUrl'],'mode'=>'literal'];
$preserve=['home','siteurl','admin_email','new_admin_email','cron','upload_path','upload_url_path','zoer_connect_connection','zoer_connect_profiles','active_plugins',$prefix.'user_roles'];
$cursor=\ZoerConnect\SnapshotStream::initial();$rows=0;
while(!$cursor['done']){
 $batch=\ZoerConnect\SnapshotStream::read($source,$schemas,$cursor,250);$cursor=$batch['cursor'];
 foreach($batch['records'] as $r){
  if($r['type']!=='row')continue;$t=$tables[$r['table']];$row=$r['row'];
  if($t['suffix']==='options'&&(in_array($row['option_name']??'',$preserve,true)||str_starts_with($row['option_name']??'','_transient_')||str_starts_with($row['option_name']??'','_site_transient_')))continue;
  foreach($row as $k=>$v)if(is_string($v)&&$k!=='guid')$row[$k]=\ZoerConnect\Replacement::apply($v,$rules);
  if($t['suffix']==='posts'&&isset($row['post_author']))$row['post_author']=$admin;
  if($wpdb->insert($t['stage'],$row)===false)throw new RuntimeException('Local row import failed.');$rows++;
 }
}
$options=$tables[$prefix.'options']['stage'];
foreach(['home','siteurl','admin_email','new_admin_email','cron','upload_path','upload_url_path','zoer_connect_connection','zoer_connect_profiles','active_plugins',$wpdb->prefix.'user_roles'] as $key){
 $row=$wpdb->get_row($wpdb->prepare("SELECT option_name,option_value,autoload FROM `{$wpdb->options}` WHERE option_name=%s",$key),ARRAY_A);
 if($row&&$wpdb->replace($options,$row)===false)throw new RuntimeException('Local identity preservation failed.');
}
// Plugins start inactive in the copy: external mail/payment/integration jobs must not auto-run.
$wpdb->replace($options,['option_name'=>'active_plugins','option_value'=>'a:0:{}','autoload'=>'yes']);
$renames=[];foreach($tables as $t){if($t['hadOld'])$renames[]='`'.$t['target'].'` TO `'.$t['backup'].'`';$renames[]='`'.$t['stage'].'` TO `'.$t['target'].'`';}
$query('RENAME TABLE '.implode(',',$renames));
file_put_contents($root.'/database-complete.json',json_encode(['tables'=>count($tables),'rows'=>$rows]));
echo "DATABASE_READY\n";
