<?php
namespace ZoerConnect;
/**
 * Pure rules of the local copy import (import-copy.php): URL pairs, user-table handling and the
 * table-prefix rewrite. No database access, so the tests run them directly.
 */
final class LocalCopyRules {
    /** User meta that never travels: login sessions, application passwords, the local-admin marker. */
    public const DROPPED_USER_META=['session_tokens','_application_passwords','_application_passwords_last_used','zoer_local_administrator'];
    /** Marks the DDEV administrator this importer keeps, so a later refresh finds it again. */
    public const LOCAL_ADMIN_META='zoer_local_administrator';

    /**
     * Source URL → local URL for every common spelling, as one longest-match map: both schemes,
     * protocol-relative, JSON-escaped (`\/`) and URL-encoded forms.
     */
    public static function urlPairs(string $sourceUrl,string $targetUrl): array {
        $source=rtrim($sourceUrl,'/');$target=rtrim($targetUrl,'/');
        if(!preg_match('#^https?://([^/\s]+)(/\S*)?$#D',$source,$s)||!preg_match('#^https://([^/\s]+)(/\S*)?$#D',$target,$t))throw new \InvalidArgumentException('Invalid copy URLs.');
        $sourceRest=$s[1].($s[2]??'');$targetRest=$t[1].($t[2]??'');
        $pairs=[];
        foreach(['https://','http://'] as $scheme){
            $pairs[$scheme.$sourceRest]=$target;
            $pairs[str_replace('/','\/',$scheme.$sourceRest)]=str_replace('/','\/',$target);
            $pairs[rawurlencode($scheme.$sourceRest)]=rawurlencode($target);
        }
        $pairs['//'.$sourceRest]='//'.$targetRest;
        $pairs['\/\/'.str_replace('/','\/',$sourceRest)]='\/\/'.str_replace('/','\/',$targetRest);
        return $pairs;
    }

    /** WP Migrate's prefix rule: user meta keys that start with the source prefix take the local prefix. */
    public static function userMetaKey(string $key,string $sourcePrefix,string $localPrefix): string {
        return $sourcePrefix!==$localPrefix&&str_starts_with($key,$sourcePrefix)?$localPrefix.substr($key,strlen($sourcePrefix)):$key;
    }

    public static function dropUserMeta(string $key): bool { return in_array($key,self::DROPPED_USER_META,true); }

    /** A serialized roles option that still defines the administrator role. */
    public static function rolesHaveAdministrator(?string $value): bool {
        return is_string($value)&&preg_match('/s:13:"administrator";a:\d+:\{/',$value)===1;
    }

    /**
     * Supported collations to use in place of one the local server lacks, closest first. MySQL 8's
     * UCA 9.0.0 (`_0900_`) collations have no counterpart on older MySQL or MariaDB: case-insensitive
     * ones take UCA 5.2.0 (`utf8mb4_unicode_520_ci`, which WordPress itself prefers), then UCA 4.0.0;
     * case-sensitive and binary ones take `utf8mb4_bin`. As in WP Migrate's compatibility filter,
     * `utf8mb4_unicode_520_ci` falls back to `utf8mb4_unicode_ci` on servers older than MySQL 5.6.
     */
    public static function collationFallbacks(string $collation): array {
        $c=strtolower($collation);$uca9='/^utf8mb4_(?:[a-z]{2}(?:_[a-z]{2,4})?_)?0900_';
        if(preg_match($uca9.'(?:bin|as_cs(?:_ks)?)$/D',$c))return ['utf8mb4_bin'];
        if(preg_match($uca9.'a[is]_ci$/D',$c))return ['utf8mb4_unicode_520_ci','utf8mb4_unicode_ci'];
        return $c==='utf8mb4_unicode_520_ci'?['utf8mb4_unicode_ci']:[];
    }

    /**
     * Rewrites the COLLATE clauses of an already-checked CREATE TABLE body whose collation the local
     * server lacks ($supported) to the first supported fallback. Quoted strings and identifiers are
     * left alone and only collation names from collationFallbacks() are written, so the result
     * passes the same DDL checks. Returns [body, [source collation => local collation]].
     */
    public static function localCollations(string $schema,callable $supported): array {
        $converted=[];
        $out=preg_replace_callback('/\'(?:[^\'\\\\]++|\\\\.)*+\'|"(?:[^"\\\\]++|\\\\.)*+"|`[^`]*+`|\bCOLLATE(?:\s*=\s*|\s+)([A-Za-z0-9_]+)\b/i',function(array $m)use($supported,&$converted): string {
            if(!isset($m[1])||$supported($m[1]))return $m[0];
            foreach(self::collationFallbacks($m[1]) as $fallback)if($supported($fallback)){$converted[strtolower($m[1])]=$fallback;return substr($m[0],0,-strlen($m[1])).$fallback;}
            throw new \RuntimeException('The source database uses the collation '.$m[1].', which the local database server does not support.');
        },$schema);
        if(!is_string($out))throw new \RuntimeException('Unsupported source schema.');
        return [$out,$converted];
    }

    /** The login the DDEV bridge's Admin handoff signs in as on sites Zoer created (zoer ddev-bridge wordpressLoginCookies). */
    public const ADMIN_LOGIN='admin';

    /**
     * The account Zoer's Admin button will sign in to once copied users replace the local ones, as
     * the DDEV bridge chooses it: the `admin` login when it exists (it must be an administrator, the
     * bridge does not fall back), otherwise the only administrator. Returns [user ID, null] or
     * [null, why the button could not sign in] so the import stops before the cutover.
     */
    public static function adminSignIn(?int $named,array $administrators,string $mode): array {
        $instead=$mode==='exact'?'Choose “Copy users and user metadata” to keep the local administrator.':'Choose “Keep only the local administrator” instead.';
        if($named!==null)return in_array($named,$administrators,true)?[$named,null]:[null,'The copied “admin” account is not an administrator, so Zoer\'s Admin button could not sign in to the copy. '.$instead];
        if(count($administrators)===1)return [$administrators[0],null];
        return [null,($administrators?'The copy would have '.count($administrators).' administrators and none named “admin”':'The copy would have no administrator').', so Zoer\'s Admin button could not choose one to sign in. '.$instead];
    }

    /** A login (or e-mail) that does not collide with the copied users. */
    public static function freeLogin(string $wanted,callable $taken): string {
        if(!$taken($wanted))return $wanted;
        for($i=1;$i<=20;$i++){$candidate=$i===1?'zoer-local-admin':'zoer-local-admin-'.$i;if(!$taken($candidate))return $candidate;}
        throw new \RuntimeException('No free login for the local administrator.');
    }
}
