/** Minimal ZIP writer/reader for fixtures (stored or deflated entries, central directory only). */
import { deflateRawSync, inflateRawSync } from "node:zlib";

const CRC_TABLE = Array.from({ length: 256 }, (_, n) => { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; return c >>> 0; });
export function crc32(data: Uint8Array) { let c = 0xffffffff; for (const byte of data) c = CRC_TABLE[(c ^ byte) & 0xff]! ^ (c >>> 8); return (c ^ 0xffffffff) >>> 0; }

export type ZipInput = { name: string; data?: string | Buffer; mode?: number; deflate?: boolean };

export function writeZip(entries: ZipInput[]): Buffer {
  const locals: Buffer[] = [], central: Buffer[] = []; let offset = 0;
  for (const entry of entries) {
    const name = Buffer.from(entry.name), raw = Buffer.from(entry.data ?? ""), crc = crc32(raw);
    const data = entry.deflate ? deflateRawSync(raw) : raw, method = entry.deflate ? 8 : 0;
    const local = Buffer.alloc(30); local.writeUInt32LE(0x04034b50, 0); local.writeUInt16LE(20, 4); local.writeUInt16LE(method, 8); local.writeUInt32LE(crc, 14); local.writeUInt32LE(data.length, 18); local.writeUInt32LE(raw.length, 22); local.writeUInt16LE(name.length, 26);
    locals.push(local, name, data);
    const cd = Buffer.alloc(46); cd.writeUInt32LE(0x02014b50, 0); cd.writeUInt16LE(0x0314, 4); cd.writeUInt16LE(20, 6); cd.writeUInt16LE(method, 10); cd.writeUInt32LE(crc, 16); cd.writeUInt32LE(data.length, 20); cd.writeUInt32LE(raw.length, 24); cd.writeUInt16LE(name.length, 28);
    cd.writeUInt32LE(((entry.mode ?? (entry.name.endsWith("/") ? 0o040755 : 0o100644)) << 16) >>> 0, 38); cd.writeUInt32LE(offset, 42);
    central.push(cd, name);
    offset += 30 + name.length + data.length;
  }
  const cdBytes = Buffer.concat(central);
  const end = Buffer.alloc(22); end.writeUInt32LE(0x06054b50, 0); end.writeUInt16LE(entries.length, 8); end.writeUInt16LE(entries.length, 10); end.writeUInt32LE(cdBytes.length, 12); end.writeUInt32LE(offset, 16);
  return Buffer.concat([...locals, cdBytes, end]);
}

export type ZipEntry = { path: string; bytes: number; compressedBytes: number; mode: number; data: () => Buffer };
export function readZip(zip: Buffer): ZipEntry[] {
  const end = zip.lastIndexOf(Buffer.from([0x50, 0x4b, 0x05, 0x06]));
  const count = zip.readUInt16LE(end + 10); let at = zip.readUInt32LE(end + 16);
  const out: ZipEntry[] = [];
  for (let i = 0; i < count; i++) {
    const method = zip.readUInt16LE(at + 10), compressed = zip.readUInt32LE(at + 20), size = zip.readUInt32LE(at + 24), nameLength = zip.readUInt16LE(at + 28), extra = zip.readUInt16LE(at + 30), comment = zip.readUInt16LE(at + 32);
    const mode = zip.readUInt32LE(at + 38) >>> 16, local = zip.readUInt32LE(at + 42), path = zip.subarray(at + 46, at + 46 + nameLength).toString("utf8");
    const start = local + 30 + zip.readUInt16LE(local + 26) + zip.readUInt16LE(local + 28);
    out.push({ path, bytes: size, compressedBytes: compressed, mode, data: () => { const raw = zip.subarray(start, start + compressed); return method === 8 ? inflateRawSync(raw) : Buffer.from(raw); } });
    at += 46 + nameLength + extra + comment;
  }
  return out;
}
