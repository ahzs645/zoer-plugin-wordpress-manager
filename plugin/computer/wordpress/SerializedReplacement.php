<?php
namespace ZoerConnect;
/** Rewrites serialized string values without unserialize(), object hooks, or graph changes. */
final class SerializedReplacement {
 private int $at=0;private int $nodes=0;
 private function __construct(private string $input,private $replace){}
 public static function apply(string $input,callable $replace,int $depth):string{
  $parser=new self($input,$replace);$out=$parser->value($depth,true);
  if($parser->at!==strlen($input))throw new \RuntimeException('Trailing serialized data.');return $out;
 }
 private function take(string $literal):void{if(substr($this->input,$this->at,strlen($literal))!==$literal)throw new \RuntimeException('Malformed serialized value.');$this->at+=strlen($literal);}
 private function number():int{$end=strpos($this->input,':',$this->at);if($end===false||$end-$this->at>8)throw new \RuntimeException('Invalid serialized count.');$raw=substr($this->input,$this->at,$end-$this->at);if(!preg_match('/^(?:0|[1-9][0-9]*)$/D',$raw)||(int)$raw>Replacement::MAX_VALUE_BYTES)throw new \RuntimeException('Invalid serialized count.');$this->at=$end+1;return (int)$raw;}
 private function raw(int $bytes):string{if($this->at+$bytes>strlen($this->input))throw new \RuntimeException('Truncated serialized value.');$out=substr($this->input,$this->at,$bytes);$this->at+=$bytes;return $out;}
 private function value(int $depth,bool $change):string{
  if($depth>30||++$this->nodes>100000)throw new \RuntimeException('Nested value limit exceeded.');
  $start=$this->at;$kind=$this->input[$this->at]??'';
  if(in_array($kind,['N','b','i','d','R','r'],true)){
   $end=strpos($this->input,';',$this->at);if($end===false)throw new \RuntimeException('Malformed serialized scalar.');
   $out=substr($this->input,$this->at,$end-$this->at+1);
   if(!preg_match('/^(?:N;|b:[01];|i:-?[0-9]+;|d:(?:-?(?:[0-9]+(?:\.[0-9]*)?|\.[0-9]+)(?:[Ee][+-]?[0-9]+)?|-?INF|NAN);|[Rr]:[1-9][0-9]*;)$/D',$out))throw new \RuntimeException('Malformed serialized scalar.');$this->at=$end+1;return $out;
  }
  $this->take($kind.':');
  if($kind==='s'){
   $length=$this->number();$this->take('"');$payload=$this->raw($length);$this->take('";');
   $next=$change?($this->replace)($payload,$depth+1):$payload;if(strlen($next)>Replacement::MAX_VALUE_BYTES)throw new \RuntimeException('Replacement output too large.');return 's:'.strlen($next).':"'.$next.'";';
  }
  if(in_array($kind,['O','C','E'],true)){
   $length=$this->number();$this->take('"');$class=$this->raw($length);$this->take('"');
   if($kind==='E'){$this->take(';');return substr($this->input,$start,$this->at-$start);}
   $this->take(':');$count=$this->number();$this->take('{');
   if($kind==='C'){$payload=$this->raw($count);$this->take('}');if($change&&($this->replace)($payload,$depth+1)!==$payload)throw new \RuntimeException('Custom serialized payload requires a migration adapter.');return substr($this->input,$start,$this->at-$start);}
   $out='O:'.$length.':"'.$class.'":'.$count.':{';
  }elseif($kind==='a'){$count=$this->number();$this->take('{');$out='a:'.$count.':{';}
  else throw new \RuntimeException('Unsupported serialized token.');
  if($count>50000)throw new \RuntimeException('Serialized entry limit exceeded.');
  for($i=0;$i<$count;$i++){
   if(!in_array($this->input[$this->at]??'',['s','i'],true))throw new \RuntimeException('Invalid serialized key.');
   $out.=$this->value($depth+1,false).$this->value($depth+1,$change);
   if(strlen($out)>Replacement::MAX_VALUE_BYTES)throw new \RuntimeException('Replacement output too large.');
  }
  $this->take('}');return $out.'}';
 }
}
