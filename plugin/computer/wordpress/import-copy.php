<?php
// Runs only in a newly created or refreshed DDEV copy, with WordPress plugins/themes skipped.
// Plan `users`: "local" (default) keeps the copy's own accounts, assigns posts to its administrator
// and detaches comments from source accounts. "source" copies users and user meta with their IDs
// (capability keys and roles take the local table prefix), drops login sessions and application
// passwords, and adds the local administrator back, marked so a later refresh finds it again.
// "exact" copies them the same way but, like WP Migrate, adds no local administrator: the copy has
// exactly the source's accounts. Both copying modes stop before the cutover when Zoer's Admin button
// could not sign in afterwards (LocalCopyRules::adminSignIn).
require_once __DIR__.'/SnapshotStream.php';
require_once __DIR__.'/Replacement.php';
require_once __DIR__.'/LocalCopyRules.php';
use ZoerConnect\LocalCopyRules as Rules;
$root=__DIR__;
$plan=json_decode(file_get_contents($root.'/plan.json'),true,512,JSON_THROW_ON_ERROR);
if(ABSPATH!=='/var/www/html/' || !preg_match('/^[a-f0-9]{32}$/D',$plan['id']??'') || !str_contains($root,$plan['id']))throw new RuntimeException('Copy destination mismatch.');
$lock=fopen($root.'/import.lock','c');if(!flock($lock,LOCK_EX|LOCK_NB))throw new RuntimeException('Import already running.');
if(is_file($root.'/database-complete.json')){echo "DATABASE_READY\n";return;}
global $wpdb;
$prefix=$plan['prefix'];if(!preg_match('/^[A-Za-z0-9_]{1,48}$/D',$prefix))throw new RuntimeException('Invalid source prefix.');
$mode=$plan['users']??'local';if(!in_array($mode,['local','source','exact'],true))throw new RuntimeException('Invalid user mode.');
$copyUsers=$mode!=='local';$keepLocalAdmin=$mode==='source';
$source=$root.'/'.$plan['databaseIndex'];
if(hash_file('sha256',$source)!==$plan['databaseSha256'])throw new RuntimeException('Database digest mismatch.');
$query=static function($sql)use($wpdb){if($wpdb->query($sql)===false)throw new RuntimeException('Local database operation failed.');};
$journal=$root.'/tables.json';$summaryFile=$root.'/import-summary.json';
if(is_file($journal)){
 $tables=json_decode(file_get_contents($journal),true,512,JSON_THROW_ON_ERROR);
 // Rename is atomic: backup table presence distinguishes a lost rename response.
 $renamed=0;foreach($tables as $t)if($t['hadOld']&&$wpdb->get_var($wpdb->prepare('SHOW TABLES LIKE %s',$wpdb->esc_like($t['backup'])))===$t['backup'])$renamed++;
 $oldCount=count(array_filter($tables,fn($t)=>$t['hadOld']));
 if($renamed){if($renamed!==$oldCount)throw new RuntimeException('Unexpected partial table cutover.');file_put_contents($root.'/database-complete.json',is_file($summaryFile)?file_get_contents($summaryFile):json_encode(['tables'=>count($tables)]));echo "DATABASE_READY\n";return;}
 foreach($tables as $t)$query('DROP TABLE IF EXISTS `'.$t['stage'].'`');
}
// Source DDL is limited to one ordinary InnoDB CREATE; no cross-database or file clauses.
$validSchema=static fn(string $schema)=>str_starts_with($schema,'(')&&preg_match('/\) ENGINE=InnoDB\b/',$schema)&&!preg_match('/;|\/\*|--|\b(?:SELECT|REFERENCES|FOREIGN|TRIGGER|TABLESPACE|DIRECTORY|UNION|INTO|OUTFILE|LOAD)\b/i',$schema);
// Collations the local server lacks (MySQL 8 `_0900_` ones on MariaDB) take their closest supported one.
$known=[];$supported=static function(string $name)use($wpdb,&$known): bool {return $known[strtolower($name)]??=strcasecmp((string)$wpdb->get_var($wpdb->prepare('SHOW COLLATION LIKE %s',$wpdb->esc_like($name))),$name)===0;};
$cursor=\ZoerConnect\SnapshotStream::initial();$schemas=[];$tables=[];$collations=[];
while(!$cursor['done']){
 $batch=\ZoerConnect\SnapshotStream::read($source,[],$cursor,250,true);$cursor=$batch['cursor'];
 foreach($batch['records'] as $record){
  $table=$record['table'];if(!str_starts_with($table,$prefix))throw new RuntimeException('Out-of-scope source table.');
  $suffix=substr($table,strlen($prefix));if(!preg_match('/^[A-Za-z0-9_]{1,48}$/D',$suffix))throw new RuntimeException('Invalid table suffix.');
  if(!$copyUsers&&in_array($suffix,['users','usermeta'],true))continue;
  $schema=\ZoerConnect\SnapshotStream::schema($record['schema'],$table);
  if(!$validSchema($schema))throw new RuntimeException('Unsupported source schema.');
  [$schema,$converted]=Rules::localCollations($schema,$supported);
  if(!$validSchema($schema))throw new RuntimeException('Unsupported source schema.');
  foreach($converted as $from=>$to){$collations[$from]??=['from'=>$from,'to'=>$to,'tables'=>0];$collations[$from]['tables']++;}
  $target=$wpdb->prefix.$suffix;$token=substr(hash('sha256',$plan['id'].$table),0,16);
  $tables[$table]=['target'=>$target,'stage'=>'zc_c_'.$token,'backup'=>'zc_b_'.$token,'hadOld'=>$wpdb->get_var($wpdb->prepare('SHOW TABLES LIKE %s',$wpdb->esc_like($target)))===$target,'schema'=>$schema,'suffix'=>$suffix];
  $schemas[$table]=$record['schema'];
 }
}
if(!isset($tables[$prefix.'options'],$tables[$prefix.'posts']))throw new RuntimeException('Core WordPress tables missing.');
if($copyUsers&&!isset($tables[$prefix.'users'],$tables[$prefix.'usermeta']))throw new RuntimeException('The source has no user tables to copy.');
file_put_contents($journal,json_encode($tables,JSON_THROW_ON_ERROR));
foreach($tables as $t){$query('DROP TABLE IF EXISTS `'.$t['stage'].'`');$query('CREATE TABLE `'.$t['stage'].'` '.$t['schema']);}
// The local administrator: the one this importer marked before, else the DDEV "admin", else the
// lowest-ID administrator, else (older copies) the lowest-ID user.
$capabilities=$wpdb->prefix.'capabilities';
$isAdmin=static fn(int $id)=>$id>0&&str_contains((string)$wpdb->get_var($wpdb->prepare("SELECT meta_value FROM `{$wpdb->usermeta}` WHERE user_id=%d AND meta_key=%s LIMIT 1",$id,$capabilities)),'"administrator"');
$admin=0;
foreach([(int)$wpdb->get_var($wpdb->prepare("SELECT u.ID FROM `{$wpdb->users}` u JOIN `{$wpdb->usermeta}` m ON m.user_id=u.ID WHERE m.meta_key=%s ORDER BY u.ID LIMIT 1",Rules::LOCAL_ADMIN_META)),(int)$wpdb->get_var("SELECT ID FROM `{$wpdb->users}` WHERE user_login='admin' LIMIT 1")] as $candidate)if($isAdmin($candidate)){$admin=$candidate;break;}
if(!$admin)$admin=(int)$wpdb->get_var($wpdb->prepare("SELECT u.ID FROM `{$wpdb->users}` u JOIN `{$wpdb->usermeta}` m ON m.user_id=u.ID AND m.meta_key=%s WHERE m.meta_value LIKE %s ORDER BY u.ID LIMIT 1",$capabilities,'%'.$wpdb->esc_like('"administrator"').'%'));
if(!$admin)$admin=(int)$wpdb->get_var("SELECT ID FROM `{$wpdb->users}` ORDER BY ID LIMIT 1");
if(!$admin)throw new RuntimeException('Local administrator missing.');
$adminUser=$keepLocalAdmin?$wpdb->get_row($wpdb->prepare("SELECT * FROM `{$wpdb->users}` WHERE ID=%d",$admin),ARRAY_A):null;
$adminMeta=$keepLocalAdmin?$wpdb->get_results($wpdb->prepare("SELECT meta_key,meta_value FROM `{$wpdb->usermeta}` WHERE user_id=%d ORDER BY umeta_id",$admin),ARRAY_A):[];
if($keepLocalAdmin&&!$adminUser)throw new RuntimeException('Local administrator missing.');
$rules=[['mode'=>'map','pairs'=>Rules::urlPairs($plan['sourceUrl'],$plan['targetUrl'])]];
// Source rows never imported; the local values of $keep are copied in below.
$keep=['home','siteurl','admin_email','new_admin_email','cron','upload_path','upload_url_path','zoer_connect_connection','zoer_connect_profiles','active_plugins'];
$skip=[...$keep,'blog_public'];
$sourceRoles=$prefix.'user_roles';$localRoles=$wpdb->prefix.'user_roles';$copiedRoles=false;
$cursor=\ZoerConnect\SnapshotStream::initial();$rows=0;$replaced=0;$userRows=0;$metaRows=0;$droppedMeta=0;
while(!$cursor['done']){
 $batch=\ZoerConnect\SnapshotStream::read($source,$schemas,$cursor,250);$cursor=$batch['cursor'];
 foreach($batch['records'] as $r){
  if($r['type']!=='row')continue;$t=$tables[$r['table']];$row=$r['row'];$suffix=$t['suffix'];
  if($suffix==='options'){
   $name=(string)($row['option_name']??'');
   if(in_array($name,$skip,true)||str_starts_with($name,'_transient_')||str_starts_with($name,'_site_transient_'))continue;
   if($name===$sourceRoles){
    // Copied users keep their custom roles; without them (or without an administrator role) the copy keeps its own.
    if(!$copyUsers||!Rules::rolesHaveAdministrator($row['option_value']??null))continue;
    $row['option_name']=$localRoles;$copiedRoles=true;
   }elseif($name===$localRoles)continue;
  }
  if($suffix==='usermeta'){
   $key=(string)($row['meta_key']??'');
   if(Rules::dropUserMeta($key)){$droppedMeta++;continue;}
   $row['meta_key']=Rules::userMetaKey($key,$prefix,$wpdb->prefix);
  }
  foreach($row as $k=>$v)if(is_string($v)&&$k!=='guid'){$next=\ZoerConnect\Replacement::apply($v,$rules);if($next!==$v){$row[$k]=$next;$replaced++;}}
  if(!$copyUsers&&$suffix==='posts'&&isset($row['post_author']))$row['post_author']=$admin;
  if(!$copyUsers&&$suffix==='comments'&&isset($row['user_id']))$row['user_id']=0;
  if($wpdb->insert($t['stage'],$row)===false)throw new RuntimeException('Local row import failed.');$rows++;
  if($suffix==='users')$userRows++;elseif($suffix==='usermeta')$metaRows++;
 }
}
$localAdmin=$admin;$loginChanged=false;
if($copyUsers){$users=$tables[$prefix.'users']['stage'];$meta=$tables[$prefix.'usermeta']['stage'];}
if($keepLocalAdmin){
 // The DDEV administrator joins the copied accounts: its own ID when the source does not use it.
 $taken=static fn(string $column,string $value)=>$wpdb->get_var($wpdb->prepare("SELECT ID FROM `$users` WHERE `$column`=%s LIMIT 1",$value))!==null;
 if($wpdb->get_var($wpdb->prepare("SELECT ID FROM `$users` WHERE ID=%d",$admin))!==null)$localAdmin=1+(int)$wpdb->get_var("SELECT MAX(ID) FROM `$users`");
 $user=array_intersect_key($adminUser,array_flip($wpdb->get_col("SHOW COLUMNS FROM `$users`")));
 $user['ID']=$localAdmin;
 $user['user_login']=Rules::freeLogin((string)$adminUser['user_login'],fn($v)=>$taken('user_login',$v));
 $loginChanged=$user['user_login']!==$adminUser['user_login'];
 if(isset($user['user_nicename']))$user['user_nicename']=Rules::freeLogin((string)$adminUser['user_nicename'],fn($v)=>$taken('user_nicename',$v));
 if(isset($user['user_email'])&&$taken('user_email',(string)$adminUser['user_email']))$user['user_email']=$user['user_login'].'@localhost.invalid';
 if($wpdb->insert($users,$user)===false)throw new RuntimeException('Local administrator import failed.');
 $own=[$capabilities=>serialize(['administrator'=>true]),$wpdb->prefix.'user_level'=>'10',Rules::LOCAL_ADMIN_META=>'1'];
 foreach($adminMeta as $m)if(!Rules::dropUserMeta($m['meta_key'])&&!array_key_exists($m['meta_key'],$own)&&$wpdb->insert($meta,['user_id'=>$localAdmin,'meta_key'=>$m['meta_key'],'meta_value'=>$m['meta_value']])===false)throw new RuntimeException('Local administrator import failed.');
 foreach($own as $key=>$value)if($wpdb->insert($meta,['user_id'=>$localAdmin,'meta_key'=>$key,'meta_value'=>$value])===false)throw new RuntimeException('Local administrator import failed.');
}
if($copyUsers){
 $named=$wpdb->get_var($wpdb->prepare("SELECT ID FROM `$users` WHERE user_login=%s LIMIT 1",Rules::ADMIN_LOGIN));
 $administrators=array_map('intval',$wpdb->get_col($wpdb->prepare("SELECT DISTINCT m.user_id FROM `$meta` m JOIN `$users` u ON u.ID=m.user_id WHERE m.meta_key=%s AND m.meta_value LIKE %s ORDER BY m.user_id",$capabilities,'%'.$wpdb->esc_like('"administrator"').'%')));
 [$signIn,$problem]=Rules::adminSignIn($named===null?null:(int)$named,$administrators,$mode);
 // Reported as the run's message (import-database.php → execCommand); nothing was swapped in.
 if($problem!==null){fwrite(STDERR,'ZOER_ERROR: '.$problem."\n");exit(1);}
 if($mode==='exact')$localAdmin=$signIn;
}
$options=$tables[$prefix.'options']['stage'];
foreach($copiedRoles?$keep:[...$keep,$localRoles] as $key){
 $row=$wpdb->get_row($wpdb->prepare("SELECT option_name,option_value,autoload FROM `{$wpdb->options}` WHERE option_name=%s",$key),ARRAY_A);
 if($row&&$wpdb->replace($options,$row)===false)throw new RuntimeException('Local identity preservation failed.');
}
// Plugins start inactive in the copy: external mail/payment/integration jobs must not auto-run.
$wpdb->replace($options,['option_name'=>'active_plugins','option_value'=>'a:0:{}','autoload'=>'yes']);
// The copy has a reachable address of its own: ask search engines not to index it.
$wpdb->replace($options,['option_name'=>'blog_public','option_value'=>'0','autoload'=>'yes']);
$summary=['tables'=>count($tables),'rows'=>$rows,'replacements'=>$replaced,'users'=>['mode'=>$mode,'copied'=>$userRows,'meta'=>$metaRows,'droppedMeta'=>$droppedMeta,'roles'=>$copiedRoles?'source':'local','loginChanged'=>$loginChanged],'localAdministrator'=>$localAdmin,'collations'=>array_values($collations)];
file_put_contents($summaryFile,json_encode($summary,JSON_THROW_ON_ERROR));
$renames=[];foreach($tables as $t){if($t['hadOld'])$renames[]='`'.$t['target'].'` TO `'.$t['backup'].'`';$renames[]='`'.$t['stage'].'` TO `'.$t['target'].'`';}
$query('RENAME TABLE '.implode(',',$renames));
file_put_contents($root.'/database-complete.json',json_encode($summary,JSON_THROW_ON_ERROR));
echo "DATABASE_READY\n";
