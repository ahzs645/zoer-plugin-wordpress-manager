<?php
namespace ZoerConnect;
require_once __DIR__."/SerializedReplacement.php";
/** Bounded replacements; serialized objects are parsed, never instantiated. */
final class Replacement {
    /** One snapshot cell is at most 16 MiB (SnapshotStream::MAX_RECORD_BYTES). */
    public const MAX_VALUE_BYTES=16777216;
    /**
     * Rules: literal and regex rules apply in order; a `map` rule ({find: replace} pairs) applies
     * as one longest-match pass (strtr), so a replacement is never matched again by a later pair.
     */
    public static function apply(string $value,array $rules): string {
        if(count($rules)>50)throw new \InvalidArgumentException('Replacement limit exceeded.');
        foreach($rules as $r){
            if(!is_array($r)||!in_array($r['mode']??null,['literal','regex','map'],true))throw new \InvalidArgumentException('Invalid replacement rule.');
            if($r['mode']==='map'){
                if(!is_array($r['pairs']??null)||!$r['pairs']||count($r['pairs'])>50)throw new \InvalidArgumentException('Invalid replacement rule.');
                foreach($r['pairs'] as $find=>$replace)if((string)$find===''||!is_string($replace))throw new \InvalidArgumentException('Invalid replacement rule.');
            }elseif(!is_string($r['find']??null)||$r['find']===''||!is_string($r['replace']??null))throw new \InvalidArgumentException('Invalid replacement rule.');
        }
        // Unrelated serialized plugin state must survive byte-for-byte, whatever its size. Do not
        // deserialize objects (e.g. Action Scheduler schedules) to change nothing.
        if(!self::possible($value,$rules))return $value;
        if(strlen($value)>self::MAX_VALUE_BYTES)throw new \InvalidArgumentException('Replacement limit exceeded.');
        return self::walk($value,$rules,0);
    }
    private static function possible(string $value,array $rules): bool {
        foreach($rules as $r){
            // A regex rule only matters where it matches (walking every value would hand plain
            // text such as `a:hover {` to the serialized parser).
            if($r['mode']==='regex'){if(@preg_match($r['find'],$value)===1)return true;continue;}
            if($r['mode']==='map'){foreach($r['pairs'] as $find=>$_)if(str_contains($value,(string)$find))return true;}
            elseif(str_contains($value,$r['find']))return true;
        }
        // Escaped JSON text (a\"b, \u00e9) can hide a match that its decoded strings contain.
        return str_contains($value,'\\')&&self::jsonContainer($value);
    }
    private static function jsonContainer(string $value): bool {
        if(!preg_match('/^\s*[\[{]/',$value))return false;
        if(function_exists('json_validate'))return json_validate($value);
        json_decode($value);return json_last_error()===JSON_ERROR_NONE;
    }
    /** A JSON object or array: rules apply to each decoded string (keys and values), which is
     * re-encoded in its original escaping style, so a replacement containing quotes or backslashes
     * stays valid JSON. Bytes outside changed strings are kept exactly. Null when not JSON. */
    private static function json(string $value,array $rules,int $depth): ?string {
        if(!self::jsonContainer($value))return null;
        // Valid JSON has no quote outside its string tokens, so this matches exactly those.
        $out=preg_replace_callback('/"(?:[^"\\\\]++|\\\\.)*+"/s',static function($m)use($rules,$depth){
            $text=json_decode($m[0]);if(!is_string($text))throw new \RuntimeException('Malformed JSON value.');
            $next=self::walk($text,$rules,$depth+1);if($next===$text)return $m[0];
            $flags=(str_contains($m[0],'\\u')?0:JSON_UNESCAPED_UNICODE)|(str_contains($m[0],'\\/')?0:JSON_UNESCAPED_SLASHES);
            $encoded=json_encode($next,$flags);if(!is_string($encoded))throw new \RuntimeException('A replacement produced text that cannot be stored in JSON.');
            return $encoded;
        },$value);
        if(!is_string($out))throw new \RuntimeException('JSON replacement failed or exceeded limits.');
        if(strlen($out)>self::MAX_VALUE_BYTES)throw new \RuntimeException('Replacement output too large.');
        return $out;
    }
    /** Columns whose bytes are never text: binary strings, BLOBs, BIT and spatial values.
     * Replacement skips them, so matching bytes inside an image or hash stay unchanged. */
    public static function binaryColumns(string $createTable): array {
        preg_match_all('/^\s*`([A-Za-z0-9_]+)`\s+(?:binary|varbinary|tinyblob|blob|mediumblob|longblob|bit|geometry|geometrycollection|geomcollection|point|multipoint|linestring|multilinestring|polygon|multipolygon)\b/mi',$createTable,$m);
        return array_values(array_unique($m[1]));
    }
    private static function serialized(string $value,int $depth): bool {
        try{SerializedReplacement::apply($value,static fn($text)=>$text,$depth);return true;}
        catch(\RuntimeException){return false;}
    }
    private static function walk($value,array $rules,int $depth) {
        if($depth>30)throw new \RuntimeException('Nested value limit exceeded.');
        if(is_array($value)){ $out=[];foreach($value as $key=>$item)$out[$key]=self::walk($item,$rules,$depth+1);return $out; }
        if(!is_string($value))return $value;
        if(!self::possible($value,$rules))return $value;
        // Only well-formed serialized values take the serialized path; text that merely starts like
        // one (CSS `a:hover`, a `C:\` path) is replaced as text.
        if(preg_match('/^(?:a|s|i|b|d|O|C|E|R|r):|^N;$/',$value)&&self::serialized($value,$depth)){
            return SerializedReplacement::apply($value,fn($text,$level)=>self::walk($text,$rules,$level),$depth);
        }
        $json=self::json($value,$rules,$depth);
        if($json!==null)return $json;
        foreach($rules as $r){
            if($r['mode']==='literal')$value=str_replace($r['find'],$r['replace'],$value);
            elseif($r['mode']==='map')$value=strtr($value,$r['pairs']);
            else{
                if(strlen($r['find'])>500)throw new \InvalidArgumentException('Pattern too long.');
                $old=ini_get('pcre.backtrack_limit');ini_set('pcre.backtrack_limit','100000');
                try{$next=@preg_replace($r['find'],$r['replace'],$value);if($next===null)throw new \RuntimeException('Regex failed or exceeded limits.');$value=$next;}
                finally{ini_set('pcre.backtrack_limit',$old);}
            }
            if(strlen($value)>self::MAX_VALUE_BYTES)throw new \RuntimeException('Replacement output too large.');
        }
        return $value;
    }
}
