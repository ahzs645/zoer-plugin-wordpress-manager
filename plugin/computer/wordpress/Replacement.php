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
            if($r['mode']==='regex')return true;
            if($r['mode']==='map'){foreach($r['pairs'] as $find=>$_)if(str_contains($value,(string)$find))return true;}
            elseif(str_contains($value,$r['find']))return true;
        }
        return false;
    }
    private static function walk($value,array $rules,int $depth) {
        if($depth>30)throw new \RuntimeException('Nested value limit exceeded.');
        if(is_array($value)){ $out=[];foreach($value as $key=>$item)$out[$key]=self::walk($item,$rules,$depth+1);return $out; }
        if(!is_string($value))return $value;
        if(!self::possible($value,$rules))return $value;
        if(preg_match('/^(?:a|s|i|b|d|O|C|E|R|r):|^N;$/',$value)){
            return SerializedReplacement::apply($value,fn($text,$level)=>self::walk($text,$rules,$level),$depth);
        }
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
