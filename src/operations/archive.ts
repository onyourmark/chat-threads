/**
 * Packing several transcripts into one download.
 *
 * A conversation that split into fifteen topics is fifteen files, and clicking
 * Download fifteen times is not a workflow. Chrome will also refuse, or
 * interrogate the user about, a burst of downloads from one gesture — so the
 * archive is the sensible default and separate files are the option.
 *
 * Written by hand for the same reason `scripts/package-store.mjs` is: a ZIP
 * writer is about eighty lines, and a dependency that runs over the user's
 * conversation text is a dependency that has to be trusted with it. Nothing
 * here leaves the machine; the archive is built in memory and handed to the
 * browser as a blob.
 *
 * Entries are stored uncompressed. Deflate would need `CompressionStream`,
 * which is asynchronous and would buy a few hundred kilobytes on text that is
 * about to be unzipped anyway — not worth the extra failure mode.
 */

/** One file in the archive. */
export interface ArchiveFile {
  /** Already made safe by `topicFileName`. */
  name: string;
  text: string;
}

const CRC_TABLE = (() => {
  const table = new Int32Array(256);
  for (let n = 0; n < 256; n += 1) {
    let c = n;
    for (let k = 0; k < 8; k += 1) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    table[n] = c;
  }
  return table;
})();

function crc32(bytes: Uint8Array): number {
  let c = -1;
  for (let i = 0; i < bytes.length; i += 1) {
    c = CRC_TABLE[(c ^ bytes[i]!) & 0xff]! ^ (c >>> 8);
  }
  return (c ^ -1) >>> 0;
}

/**
 * Characters a file name cannot contain on Windows, macOS or Linux, plus the
 * control range. Replaced rather than dropped, so "Why is AI so stupid?"
 * stays readable instead of becoming "Why is AI so stupid".
 */
// eslint-disable-next-line no-control-regex
const UNSAFE = /[\u0000-\u001f\u007f<>:"/\\|?*]/g;

/** Names Windows refuses whatever the extension. */
const RESERVED_NAMES = new Set([
  'con', 'prn', 'aux', 'nul',
  'com1', 'com2', 'com3', 'com4', 'com5', 'com6', 'com7', 'com8', 'com9',
  'lpt1', 'lpt2', 'lpt3', 'lpt4', 'lpt5', 'lpt6', 'lpt7', 'lpt8', 'lpt9',
]);

const MAX_BASE = 80;

/**
 * A file name built from a topic's own name.
 *
 * The user asked for the topic name, so the topic name is what they get —
 * spaces, capitals and all. Only what a filesystem genuinely cannot take is
 * changed, which for the built-in topic means "Why is AI so stupid?" becomes
 * "Why is AI so stupid.md" rather than something slugified beyond recognition.
 */
export function topicFileName(title: string, extension: string): string {
  let base = title
    .replace(UNSAFE, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    // Windows drops trailing dots and spaces silently; do it visibly instead.
    .replace(/[. ]+$/, '');

  if (base.length > MAX_BASE) base = base.slice(0, MAX_BASE).trim();
  if (!base) base = 'topic';
  if (RESERVED_NAMES.has(base.toLowerCase())) base = `${base} topic`;

  return `${base}.${extension}`;
}

/**
 * Make every name in a list unique, keeping the order given.
 *
 * Two topics can perfectly well be called the same thing, and a zip with two
 * identical entries unpacks to one file. The second becomes "Name (2).md".
 */
export function uniqueFileNames(names: readonly string[]): string[] {
  const used = new Map<string, number>();
  return names.map((name) => {
    const key = name.toLowerCase();
    const seen = used.get(key) ?? 0;
    used.set(key, seen + 1);
    if (seen === 0) return name;

    const dot = name.lastIndexOf('.');
    const base = dot > 0 ? name.slice(0, dot) : name;
    const ext = dot > 0 ? name.slice(dot) : '';
    return `${base} (${seen + 1})${ext}`;
  });
}

function u32(value: number): Uint8Array {
  return new Uint8Array([
    value & 0xff,
    (value >>> 8) & 0xff,
    (value >>> 16) & 0xff,
    (value >>> 24) & 0xff,
  ]);
}

function u16(value: number): Uint8Array {
  return new Uint8Array([value & 0xff, (value >>> 8) & 0xff]);
}

function concat(parts: Uint8Array[]): Uint8Array {
  const total = parts.reduce((n, p) => n + p.length, 0);
  const out = new Uint8Array(total);
  let offset = 0;
  for (const part of parts) {
    out.set(part, offset);
    offset += part.length;
  }
  return out;
}

/**
 * Build a ZIP archive.
 *
 * Fixed timestamps, so the same conversation and the same choices produce the
 * same bytes. Names and text are both UTF-8, with the language-encoding flag
 * set so that a topic named in any script unpacks correctly.
 */
export function buildZip(files: readonly ArchiveFile[]): Uint8Array {
  const encoder = new TextEncoder();
  const locals: Uint8Array[] = [];
  const central: Uint8Array[] = [];
  let offset = 0;

  // 1980-01-01, the earliest a DOS timestamp can express.
  const time = 0;
  const date = (1 << 5) | 1;
  // Bit 11: names and comments are UTF-8.
  const flags = 0x0800;

  for (const file of files) {
    const name = encoder.encode(file.name);
    const data = encoder.encode(file.text);
    const crc = crc32(data);

    const local = concat([
      u32(0x04034b50),
      u16(20),
      u16(flags),
      u16(0), // stored
      u16(time),
      u16(date),
      u32(crc),
      u32(data.length),
      u32(data.length),
      u16(name.length),
      u16(0),
    ]);
    locals.push(local, name, data);

    central.push(
      concat([
        u32(0x02014b50),
        u16(20),
        u16(20),
        u16(flags),
        u16(0),
        u16(time),
        u16(date),
        u32(crc),
        u32(data.length),
        u32(data.length),
        u16(name.length),
        u16(0), // extra
        u16(0), // comment
        u16(0), // disk
        u16(0), // internal attrs
        u32(0), // external attrs
        u32(offset),
      ]),
      name,
    );

    offset += local.length + name.length + data.length;
  }

  const centralBytes = concat(central);
  const end = concat([
    u32(0x06054b50),
    u16(0),
    u16(0),
    u16(files.length),
    u16(files.length),
    u32(centralBytes.length),
    u32(offset),
    u16(0),
  ]);

  return concat([concat(locals), centralBytes, end]);
}
