/**
 * Generate the extension icons.
 *
 * The icons are drawn here rather than committed as binaries so the artwork is
 * reviewable in a diff and reproducible. The mark is three stacked threads of
 * different lengths on a rounded square — one conversation being separated
 * into several.
 *
 * Run with `npm run icons`.
 */

import { deflateSync } from 'node:zlib';
import { mkdir, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const OUT = resolve(
  dirname(fileURLToPath(import.meta.url)),
  '../public/icons',
);
const SIZES = [16, 32, 48, 128];

const BG = [47, 91, 215, 255]; // --accent
const BAR = [255, 255, 255, 255];

/** CRC-32, as PNG chunks require. */
const CRC_TABLE = (() => {
  const table = new Int32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    table[n] = c;
  }
  return table;
})();

function crc32(buf) {
  let c = -1;
  for (let i = 0; i < buf.length; i++) {
    c = CRC_TABLE[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
  }
  return (c ^ -1) >>> 0;
}

function chunk(type, data) {
  const length = Buffer.alloc(4);
  length.writeUInt32BE(data.length);
  const body = Buffer.concat([Buffer.from(type, 'ascii'), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(body));
  return Buffer.concat([length, body, crc]);
}

/** Encode an RGBA pixel buffer as a PNG. */
function encodePng(width, height, rgba) {
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 6; // colour type: RGBA
  ihdr[10] = 0; // deflate
  ihdr[11] = 0; // adaptive filtering
  ihdr[12] = 0; // no interlace

  // Each scanline is prefixed with its filter type; 0 means "none".
  const raw = Buffer.alloc(height * (width * 4 + 1));
  for (let y = 0; y < height; y++) {
    const rowStart = y * (width * 4 + 1);
    raw[rowStart] = 0;
    rgba.copy(raw, rowStart + 1, y * width * 4, (y + 1) * width * 4);
  }

  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr),
    chunk('IDAT', deflateSync(raw, { level: 9 })),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

/** Coverage of a pixel by a rounded rectangle, sampled for smooth edges. */
function roundedRectCoverage(x, y, w, h, radius, samples = 4) {
  let hits = 0;
  for (let sy = 0; sy < samples; sy++) {
    for (let sx = 0; sx < samples; sx++) {
      const px = x + (sx + 0.5) / samples;
      const py = y + (sy + 0.5) / samples;
      if (px < 0 || py < 0 || px > w || py > h) continue;
      // Distance into the nearest corner's rounding circle.
      const dx = Math.max(radius - px, px - (w - radius), 0);
      const dy = Math.max(radius - py, py - (h - radius), 0);
      if (dx * dx + dy * dy <= radius * radius) hits++;
    }
  }
  return hits / (samples * samples);
}

function blend(dst, offset, colour, alpha) {
  for (let c = 0; c < 3; c++) {
    dst[offset + c] = Math.round(
      dst[offset + c] * (1 - alpha) + colour[c] * alpha,
    );
  }
  dst[offset + 3] = Math.round(dst[offset + 3] * (1 - alpha) + 255 * alpha);
}

function drawIcon(size) {
  const rgba = Buffer.alloc(size * size * 4, 0);
  const radius = size * 0.22;

  // Background plate.
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const a = roundedRectCoverage(x, y, size, size, radius);
      if (a > 0) blend(rgba, (y * size + x) * 4, BG, a);
    }
  }

  // Three threads: full width, then two shorter ones offset to the right,
  // reading as one conversation separating into parts.
  const barHeight = Math.max(1, Math.round(size * 0.1));
  const gap = Math.max(1, Math.round(size * 0.11));
  const totalHeight = barHeight * 3 + gap * 2;
  const top = Math.round((size - totalHeight) / 2);
  const left = Math.round(size * 0.2);
  const fullWidth = Math.round(size * 0.6);
  const bars = [
    { y: top, x: left, w: fullWidth },
    { y: top + barHeight + gap, x: left + Math.round(size * 0.12), w: Math.round(fullWidth * 0.62) },
    { y: top + (barHeight + gap) * 2, x: left + Math.round(size * 0.06), w: Math.round(fullWidth * 0.8) },
  ];

  const barRadius = barHeight / 2;
  for (const bar of bars) {
    for (let y = 0; y < barHeight; y++) {
      for (let x = 0; x < bar.w; x++) {
        const px = bar.x + x;
        const py = bar.y + y;
        if (px < 0 || py < 0 || px >= size || py >= size) continue;
        const a = roundedRectCoverage(x, y, bar.w, barHeight, barRadius);
        if (a > 0) blend(rgba, (py * size + px) * 4, BAR, a);
      }
    }
  }

  return encodePng(size, size, rgba);
}

await mkdir(OUT, { recursive: true });
for (const size of SIZES) {
  const file = resolve(OUT, `icon-${size}.png`);
  await writeFile(file, drawIcon(size));
  console.log(`wrote ${file}`);
}
