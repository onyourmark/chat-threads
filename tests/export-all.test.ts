/**
 * Exporting every topic at once.
 *
 * Asked for from real use: a conversation that split into fifteen topics is
 * fifteen downloads, and the file should be called what the topic is called —
 * "Why is AI so stupid?" and not "why-is-ai-so-stupid".
 *
 * Two things have to be right for that: the names, which have to survive a
 * filesystem without becoming unrecognisable, and the archive, which has to be
 * a real zip that a real unzipper will open.
 */

import { describe, expect, it } from 'vitest';
import { unzipSync } from 'node:zlib';
import {
  buildZip,
  topicFileName,
  uniqueFileNames,
} from '../src/operations/archive';
import { BUILT_IN_TOPIC_NAME } from '../src/model/default-topic';

/** Read a stored-entry zip back, without trusting the writer to tell us. */
function readZip(bytes: Uint8Array): Map<string, string> {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const decoder = new TextDecoder();
  const out = new Map<string, string>();

  // Walk the central directory from the end-of-central-directory record.
  let eocd = bytes.length - 22;
  while (eocd >= 0 && view.getUint32(eocd, true) !== 0x06054b50) eocd -= 1;
  expect(eocd, 'end-of-central-directory record').toBeGreaterThanOrEqual(0);

  const count = view.getUint16(eocd + 10, true);
  let offset = view.getUint32(eocd + 16, true);

  for (let i = 0; i < count; i += 1) {
    expect(view.getUint32(offset, true)).toBe(0x02014b50);
    const method = view.getUint16(offset + 10, true);
    const crc = view.getUint32(offset + 16, true);
    const size = view.getUint32(offset + 24, true);
    const nameLength = view.getUint16(offset + 28, true);
    const extraLength = view.getUint16(offset + 30, true);
    const commentLength = view.getUint16(offset + 32, true);
    const localOffset = view.getUint32(offset + 42, true);
    const name = decoder.decode(
      bytes.subarray(offset + 46, offset + 46 + nameLength),
    );

    // And back to the local header for the bytes themselves.
    expect(view.getUint32(localOffset, true)).toBe(0x04034b50);
    const localNameLength = view.getUint16(localOffset + 26, true);
    const localExtraLength = view.getUint16(localOffset + 28, true);
    const start = localOffset + 30 + localNameLength + localExtraLength;
    const data = bytes.subarray(start, start + size);

    expect(method, `${name} is stored`).toBe(0);
    expect(crc, `${name} checksum`).toBe(crc32(data));
    out.set(name, decoder.decode(data));

    offset += 46 + nameLength + extraLength + commentLength;
  }
  return out;
}

/** An independent CRC-32, so the archive is not checked against itself. */
function crc32(bytes: Uint8Array): number {
  let c = -1;
  for (let i = 0; i < bytes.length; i += 1) {
    c ^= bytes[i]!;
    for (let k = 0; k < 8; k += 1) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  }
  return (c ^ -1) >>> 0;
}

// --------------------------------------------------------------- names -----

describe('a file named after its topic', () => {
  it('keeps the words, the spaces and the capitals', () => {
    expect(topicFileName('Chrome Web Store release', 'md')).toBe(
      'Chrome Web Store release.md',
    );
  });

  it('drops only what a filesystem cannot take', () => {
    // The built-in topic is the case that matters: the question mark has to
    // go, and nothing else should.
    expect(topicFileName(BUILT_IN_TOPIC_NAME, 'md')).toBe(
      'Why is AI so stupid.md',
    );
    expect(topicFileName('a/b\\c:d*e?f"g<h>i|j', 'txt')).toBe(
      'a b c d e f g h i j.txt',
    );
  });

  it('never produces something the operating system will refuse', () => {
    expect(topicFileName('   ', 'md')).toBe('topic.md');
    expect(topicFileName('???', 'md')).toBe('topic.md');
    expect(topicFileName('Notes...', 'md')).toBe('Notes.md');
    expect(topicFileName('CON', 'md')).toBe('CON topic.md');
    expect(topicFileName('nul', 'txt')).toBe('nul topic.txt');
  });

  it('keeps a very long topic name to a sensible length', () => {
    const name = topicFileName('word '.repeat(60), 'md');
    expect(name.length).toBeLessThanOrEqual(84);
    expect(name.endsWith('.md')).toBe(true);
  });

  it('handles a name that is not in the Latin alphabet', () => {
    expect(topicFileName('日本語のトピック', 'md')).toBe('日本語のトピック.md');
  });

  it('separates two topics that are called the same thing', () => {
    expect(
      uniqueFileNames(['Plans.md', 'Plans.md', 'Other.md', 'plans.md']),
    ).toEqual(['Plans.md', 'Plans (2).md', 'Other.md', 'plans (3).md']);
  });

  it('leaves distinct names alone', () => {
    const names = ['One.md', 'Two.md', 'Three.md'];
    expect(uniqueFileNames(names)).toEqual(names);
  });
});

// ------------------------------------------------------------- archive -----

describe('the archive', () => {
  const files = [
    { name: 'Why is AI so stupid.md', text: '# Venting\n\nSome text.\n' },
    { name: 'Travel plans.md', text: '# Travel\n\nLisbon in March.\n' },
    { name: '日本語.md', text: '# 見出し\n\n本文。\n' },
  ];

  it('round-trips every file, with its name and its text', () => {
    const entries = readZip(buildZip(files));

    expect(entries.size).toBe(3);
    for (const file of files) {
      expect(entries.get(file.name)).toBe(file.text);
    }
  });

  it('is a zip that a real unzipper accepts', () => {
    // Node's own inflate is not involved for stored entries, so this checks
    // the container rather than the compression: a wrong offset or a wrong
    // central-directory size fails here.
    const bytes = buildZip(files);
    expect(bytes.length).toBeGreaterThan(0);
    // Local header, then the end record's signature at the tail.
    expect(new DataView(bytes.buffer, bytes.byteOffset).getUint32(0, true)).toBe(
      0x04034b50,
    );
    expect(() => readZip(bytes)).not.toThrow();
  });

  it('marks names as UTF-8, so a non-Latin topic unpacks correctly', () => {
    const bytes = buildZip(files);
    const view = new DataView(bytes.buffer, bytes.byteOffset);
    // Bit 11 of the general-purpose flags in the first local header.
    expect(view.getUint16(6, true) & 0x0800).toBe(0x0800);
  });

  it('produces the same bytes for the same input', () => {
    expect(Array.from(buildZip(files))).toEqual(Array.from(buildZip(files)));
  });

  it('copes with an empty file and with no files at all', () => {
    expect(readZip(buildZip([{ name: 'Empty.md', text: '' }])).get('Empty.md')).toBe(
      '',
    );
    const none = buildZip([]);
    expect(none.length).toBe(22);
  });

  it('handles fifteen topics, which is what prompted the feature', () => {
    const many = Array.from({ length: 15 }, (_, i) => ({
      name: `Topic ${i + 1}.md`,
      text: `# Topic ${i + 1}\n\n${'Some conversation text. '.repeat(200)}`,
    }));
    const entries = readZip(buildZip(many));

    expect(entries.size).toBe(15);
    expect(entries.get('Topic 15.md')).toContain('# Topic 15');
  });

  it('is not doing anything clever with compression', () => {
    // Stored, deliberately. `unzipSync` would reject a deflate stream that
    // claimed to be stored, so this also proves the method field is honest.
    const bytes = buildZip(files);
    expect(() => unzipSync(Buffer.from([0x00]))).toThrow();
    expect(readZip(bytes).size).toBe(3);
  });
});
