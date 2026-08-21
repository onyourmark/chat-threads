/**
 * Build the Chrome Web Store package.
 *
 * Produces `chat-threads-<version>.zip` containing exactly what the store
 * needs and nothing else: no source maps, no tests, no source, no git, no
 * node_modules. It refuses to write the archive if anything unexpected turns
 * up in `dist/`, because the failure mode this guards against — shipping a
 * stray file to a few thousand people — is not one you notice afterwards.
 *
 * The zip is written by hand rather than shelling out, so packaging works the
 * same on any machine and adds no dependency. Timestamps are fixed, so the
 * same commit produces a byte-identical archive and a release can be checked
 * against the source it claims to come from.
 *
 * Run with: npm run package
 */

import { execFileSync } from 'node:child_process';
import { deflateRawSync } from 'node:zlib';
import { readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const dist = resolve(root, 'dist');

/**
 * Every file allowed in the package. A pattern that matches nothing, or a file
 * matching nothing, stops the build — both mean the package is not what this
 * script thinks it is.
 */
const ALLOWED = [
  /^manifest\.json$/,
  /^sidepanel\.html$/,
  /^background\.js$/,
  /^content\.js$/,
  /^assets\/index\.js$/,
  /^assets\/index\.css$/,
  /^icons\/icon-(16|32|48|128)\.png$/,
];

/** Things that must never reach the store, checked explicitly by name. */
const FORBIDDEN = [
  /\.map$/,
  /\.ts$/,
  /\.tsx$/,
  /\.pem$/,
  /\.p12$/,
  /\.crx$/,
  /\.env/,
  /(^|\/)\.git/,
  /node_modules/,
  /(^|\/)tests?\//,
];

function listFiles(dir) {
  const out = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) out.push(...listFiles(full));
    else out.push(relative(dist, full).split('\\').join('/'));
  }
  return out.sort();
}

// ---------------------------------------------------------------- zip ------

const CRC_TABLE = (() => {
  const t = new Int32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c;
  }
  return t;
})();

function crc32(buf) {
  let c = -1;
  for (let i = 0; i < buf.length; i++) c = CRC_TABLE[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
  return (c ^ -1) >>> 0;
}

// Fixed timestamp so the archive is reproducible: 2026-01-01 00:00:00.
const DOS_TIME = 0;
const DOS_DATE = ((2026 - 1980) << 9) | (1 << 5) | 1;

/** Minimal ZIP writer: local headers, central directory, end record. */
function makeZip(entries) {
  const locals = [];
  const central = [];
  let offset = 0;

  for (const { name, data } of entries) {
    const nameBuf = Buffer.from(name, 'utf8');
    const crc = crc32(data);
    const deflated = deflateRawSync(data, { level: 9 });
    // Storing is smaller than deflating for already-compressed PNGs.
    const useDeflate = deflated.length < data.length;
    const body = useDeflate ? deflated : data;
    const method = useDeflate ? 8 : 0;

    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0);
    local.writeUInt16LE(20, 4); // version needed
    local.writeUInt16LE(0, 6); // flags
    local.writeUInt16LE(method, 8);
    local.writeUInt16LE(DOS_TIME, 10);
    local.writeUInt16LE(DOS_DATE, 12);
    local.writeUInt32LE(crc, 14);
    local.writeUInt32LE(body.length, 18);
    local.writeUInt32LE(data.length, 22);
    local.writeUInt16LE(nameBuf.length, 26);
    local.writeUInt16LE(0, 28);
    locals.push(local, nameBuf, body);

    const dirEntry = Buffer.alloc(46);
    dirEntry.writeUInt32LE(0x02014b50, 0);
    dirEntry.writeUInt16LE(20, 4); // version made by
    dirEntry.writeUInt16LE(20, 6); // version needed
    dirEntry.writeUInt16LE(0, 8);
    dirEntry.writeUInt16LE(method, 10);
    dirEntry.writeUInt16LE(DOS_TIME, 12);
    dirEntry.writeUInt16LE(DOS_DATE, 14);
    dirEntry.writeUInt32LE(crc, 16);
    dirEntry.writeUInt32LE(body.length, 20);
    dirEntry.writeUInt32LE(data.length, 24);
    dirEntry.writeUInt16LE(nameBuf.length, 28);
    dirEntry.writeUInt16LE(0, 30); // extra
    dirEntry.writeUInt16LE(0, 32); // comment
    dirEntry.writeUInt16LE(0, 34); // disk
    dirEntry.writeUInt16LE(0, 36); // internal attrs
    dirEntry.writeUInt32LE(0, 38); // external attrs
    dirEntry.writeUInt32LE(offset, 42);
    central.push(dirEntry, nameBuf);

    offset += local.length + nameBuf.length + body.length;
  }

  const centralBuf = Buffer.concat(central);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0);
  end.writeUInt16LE(0, 4);
  end.writeUInt16LE(0, 6);
  end.writeUInt16LE(entries.length, 8);
  end.writeUInt16LE(entries.length, 10);
  end.writeUInt32LE(centralBuf.length, 12);
  end.writeUInt32LE(offset, 16);
  end.writeUInt16LE(0, 20);

  return Buffer.concat([...locals, centralBuf, end]);
}

// --------------------------------------------------------------- main ------

console.log('Building without source maps...');
execFileSync(process.execPath, [resolve(root, 'scripts/build.mjs')], {
  cwd: root,
  env: { ...process.env, CT_SOURCEMAPS: '0' },
  stdio: 'inherit',
});

const files = listFiles(dist);
const problems = [];

for (const file of files) {
  if (FORBIDDEN.some((re) => re.test(file))) {
    problems.push(`must not be published: ${file}`);
  } else if (!ALLOWED.some((re) => re.test(file))) {
    problems.push(`not on the allowed list: ${file}`);
  }
}
for (const pattern of ALLOWED) {
  if (!files.some((f) => pattern.test(f))) {
    problems.push(`expected a file matching ${pattern} and found none`);
  }
}

if (problems.length > 0) {
  console.error('\nRefusing to package:');
  for (const p of problems) console.error('  - ' + p);
  process.exit(1);
}

const manifest = JSON.parse(readFileSync(join(dist, 'manifest.json'), 'utf8'));
const entries = files.map((name) => ({
  name,
  data: readFileSync(join(dist, name)),
}));

const zip = makeZip(entries);
const out = resolve(root, `chat-threads-${manifest.version}.zip`);
writeFileSync(out, zip);

console.log(`\nPackaged ${entries.length} files for the Chrome Web Store:\n`);
for (const { name, data } of entries) {
  console.log(`  ${String(data.length).padStart(8)}  ${name}`);
}
const total = entries.reduce((n, e) => n + e.data.length, 0);
console.log(`\n  uncompressed : ${total} bytes`);
console.log(`  archive      : ${zip.length} bytes (${(zip.length / 1024).toFixed(0)} KB)`);
console.log(`  version      : ${manifest.version}`);
console.log(`\n  ${out}`);
console.log('\nUpload that file. Do not rename it — the store reads the version');
console.log('from manifest.json inside, not from the file name.');
