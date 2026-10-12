/**
 * Read-only access to selected entries of a zip archive, without extracting
 * it. The archive is opened with the "r" flag and never written. Only entries
 * below `prefix` are indexed; every other path in the archive is skipped
 * unread, so nothing outside the media folder is ever inspected.
 */
import fs from 'node:fs';
import zlib from 'node:zlib';

interface Entry { method: number; compressedSize: number; size: number; offset: number }

export class ZipReader {
  private readonly fd: number;
  readonly entries = new Map<string, Entry>();

  constructor(file: string, prefix: string) {
    this.fd = fs.openSync(file, 'r');
    const fileSize = fs.fstatSync(this.fd).size;
    const tail = this.bytes(Math.max(0, fileSize - 66000), Math.min(66000, fileSize));
    const eocd = tail.lastIndexOf(Buffer.from([0x50, 0x4b, 0x05, 0x06]));
    if (eocd === -1) throw new Error('Not a zip archive (no end-of-central-directory record).');
    const total = tail.readUInt16LE(eocd + 10);
    const size = tail.readUInt32LE(eocd + 12);
    const start = tail.readUInt32LE(eocd + 16);
    if (total === 0xffff || size === 0xffffffff || start === 0xffffffff) throw new Error('Zip64 archives are not supported by this reader.');
    const dir = this.bytes(start, size);
    for (let p = 0, i = 0; i < total; i++) {
      if (dir.readUInt32LE(p) !== 0x02014b50) throw new Error('Corrupt zip central directory.');
      const nameLength = dir.readUInt16LE(p + 28);
      const name = dir.toString('utf8', p + 46, p + 46 + nameLength);
      if (name.startsWith(prefix) && !name.endsWith('/')) {
        this.entries.set(name, { method: dir.readUInt16LE(p + 10), compressedSize: dir.readUInt32LE(p + 20), size: dir.readUInt32LE(p + 24), offset: dir.readUInt32LE(p + 42) });
      }
      p += 46 + nameLength + dir.readUInt16LE(p + 30) + dir.readUInt16LE(p + 32);
    }
  }

  private bytes(position: number, length: number): Buffer {
    const buffer = Buffer.alloc(length);
    fs.readSync(this.fd, buffer, 0, length, position);
    return buffer;
  }

  has(name: string) { return this.entries.has(name); }
  sizeOf(name: string) { return this.entries.get(name)?.size ?? 0; }

  /** The entry's bytes, held in memory only. */
  read(name: string): Buffer {
    const entry = this.entries.get(name);
    if (!entry) throw new Error(`No such entry: ${name}`);
    const header = this.bytes(entry.offset, 30);
    if (header.readUInt32LE(0) !== 0x04034b50) throw new Error(`Corrupt zip entry: ${name}`);
    const data = this.bytes(entry.offset + 30 + header.readUInt16LE(26) + header.readUInt16LE(28), entry.compressedSize);
    if (entry.method === 0) return data;
    if (entry.method === 8) return zlib.inflateRawSync(data);
    throw new Error(`Unsupported zip compression method ${entry.method}: ${name}`);
  }

  close() { fs.closeSync(this.fd); }
}
