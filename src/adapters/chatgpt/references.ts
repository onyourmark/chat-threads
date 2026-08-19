/**
 * ChatGPT inline reference markers.
 *
 * When ChatGPT points at a file you attached, it does not write the file name
 * into the message. It writes a private marker built out of Unicode
 * Private Use Area characters, and its own interface swaps that marker for a
 * readable chip before you ever see it. Anything that reads the conversation
 * data directly — as Chat Threads does — gets the raw marker.
 *
 * The grammar, per OpenAI's citation-formatting guide:
 *
 *   U+E200  start        U+E202  delimiter        U+E201  stop
 *   <start>cite<delim>turn0file0<stop>
 *   <start>cite<delim>turn0file0<delim>turn1file1<stop>     (several sources)
 *   <start>cite<delim>turn0file0<delim>L8-L13<stop>         (line range)
 *
 * A reference id is `turn<n><kind><m>`, where kind is `file`, `search`,
 * `news`, `image`, `video`, `block` or `url`. The keyword before the first
 * delimiter varies — `cite`, `filecite`, `videocite`, `navlist`.
 *
 * This module turns all of that into text a person can read and paste
 * somewhere else. It is pure and provider-specific: nothing above the adapter
 * needs to know these markers ever existed.
 *
 * This is undocumented provider behaviour and may change. See
 * docs/LIMITATIONS.md.
 */

import type { TurnReference } from '../../model/types';

/**
 * Built from character codes rather than written as literals so the source
 * file stays plain ASCII and the delimiters cannot be mangled by an editor,
 * a copy-paste, or a tool that normalizes unusual characters.
 */
const START = String.fromCharCode(0xe200);
const STOP = String.fromCharCode(0xe201);
const DELIM = String.fromCharCode(0xe202);

/** The private range ChatGPT draws these delimiters from. */
const PUA_FIRST = 0xe200;
const PUA_LAST = 0xe20f;

/** `<start> keyword <delim> body <stop>` — the whole marker. */
const MARKER = new RegExp(
  `${START}([a-zA-Z]*)${DELIM}([^${STOP}]*)${STOP}`,
  'g',
);

/** A marker that was opened but never closed, e.g. truncated mid-stream. */
const UNCLOSED_MARKER = new RegExp(`${START}[^${STOP}]*$`, 'g');

/** Any leftover delimiter character, matched one at a time. */
const STRAY_DELIMITER = new RegExp(
  `[${String.fromCharCode(PUA_FIRST)}-${String.fromCharCode(PUA_LAST)}]`,
  'g',
);

/** `turn0file3` -> kind `file`. Line locators like `L8-L13` are not ids. */
const REFERENCE_ID = /^turn\d+([a-z]+)\d+$/;

/**
 * The older bracket form, which carries the source name inline:
 * `[4:0+Pasted markdown.md]` using ideographic brackets and a dagger.
 */
const BRACKET_CITATION = new RegExp(
  `${String.fromCharCode(0x3010)}([^${String.fromCharCode(0x3011)}]*)${String.fromCharCode(0x3011)}`,
  'g',
);
const DAGGER = String.fromCharCode(0x2020);

/** Text used when a reference points at a file we can name. */
export function namedFileLabel(name: string): string {
  return `[Reference to attached file: ${name}]`;
}

/** Text used when we know a file was referenced but not which one. */
export const UNNAMED_FILE_LABEL =
  '[Reference to an attachment from the original conversation]';

/** Text used for a non-file reference whose title we recovered. */
export function namedOtherLabel(name: string): string {
  return `[Reference: ${name}]`;
}

/** Text used for a reference we recognized but cannot describe at all. */
export const UNNAMED_OTHER_LABEL =
  '[Reference from the original conversation]';

export interface NormalizeReferencesResult {
  text: string;
  references: TurnReference[];
}

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

/**
 * Clean a name that came from provider metadata before it is put in front of
 * a user. Provider data is untrusted input like any other.
 */
function cleanName(value: unknown): string | undefined {
  if (typeof value !== 'string') return undefined;
  const cleaned = value
    .replace(STRAY_DELIMITER, '')
    // eslint-disable-next-line no-control-regex
    .replace(/[\u0000-\u001f\u007f]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 120);
  return cleaned || undefined;
}

/** Field names ChatGPT has used for the human-readable name of a source. */
const NAME_FIELDS = ['file_name', 'filename', 'name', 'title', 'alt'];
/** Fields that hold the individual sources behind a grouped reference. */
const NESTED_FIELDS = ['items', 'sources', 'refs', 'files', 'attachments'];

/** Pull the best available display name out of one content reference. */
function nameFrom(entry: Record<string, unknown>): string | undefined {
  for (const field of NAME_FIELDS) {
    const name = cleanName(entry[field]);
    if (name) return name;
  }
  for (const field of NESTED_FIELDS) {
    const nested = entry[field];
    if (!Array.isArray(nested)) continue;
    for (const item of nested) {
      if (!isRecord(item)) continue;
      const name = nameFrom(item);
      if (name) return name;
    }
  }
  return undefined;
}

/** The reference ids named inside a marker body. */
function idsIn(body: string): string[] {
  return body
    .split(DELIM)
    .map((part) => part.trim())
    .filter((part) => REFERENCE_ID.test(part));
}

/** `file` when every id in the marker points at a file. */
function kindOf(body: string): TurnReference['kind'] {
  const kinds = idsIn(body).map((id) => REFERENCE_ID.exec(id)?.[1]);
  return kinds.length > 0 && kinds.every((k) => k === 'file') ? 'file' : 'other';
}

interface Replacement {
  label: string;
  reference: TurnReference | null;
}

function labelFor(
  kind: TurnReference['kind'],
  name: string | undefined,
): string {
  if (kind === 'file') {
    return name ? namedFileLabel(name) : UNNAMED_FILE_LABEL;
  }
  return name ? namedOtherLabel(name) : UNNAMED_OTHER_LABEL;
}

/**
 * Insert the replacement without gluing it to the preceding word.
 *
 * Markers usually sit flush against the end of a sentence, so a bare
 * substitution reads as `...as shown[Reference to...]`.
 */
function spaced(before: string, label: string): string {
  if (!label) return label;
  const previous = before.slice(-1);
  const needsSpace = previous !== '' && !/[\s([{"'“]/.test(previous);
  return needsSpace ? ` ${label}` : label;
}

/**
 * Index `metadata.content_references`, which is ChatGPT's own mapping from a
 * raw marker to what its interface displays in that marker's place.
 *
 * This is the authoritative source of a file name; everything else in this
 * module is a fallback for when it is absent.
 */
function indexContentReferences(contentReferences: unknown): {
  byMatchedText: Map<string, Replacement>;
  byId: Map<string, string>;
} {
  const byMatchedText = new Map<string, Replacement>();
  const byId = new Map<string, string>();
  if (!Array.isArray(contentReferences)) return { byMatchedText, byId };

  for (const entry of contentReferences) {
    if (!isRecord(entry)) continue;
    const matched = typeof entry.matched_text === 'string' ? entry.matched_text : '';
    const type = typeof entry.type === 'string' ? entry.type : '';
    const name = nameFrom(entry);

    // Some references are markers ChatGPT deletes rather than renders. Adding
    // a visible label where the user saw nothing would be its own bug.
    if (type.includes('hidden')) {
      if (matched) byMatchedText.set(matched, { label: '', reference: null });
      continue;
    }

    const kind: TurnReference['kind'] =
      type.includes('file') || (matched && kindOf(bodyOf(matched)) === 'file')
        ? 'file'
        : 'other';

    if (name) {
      for (const id of idsIn(bodyOf(matched))) byId.set(id, name);
    }
    if (matched) {
      byMatchedText.set(matched, {
        label: labelFor(kind, name),
        reference: { kind, name, raw: matched },
      });
    }
  }

  return { byMatchedText, byId };
}

/** The part of a marker between the first delimiter and the stop character. */
function bodyOf(marker: string): string {
  const start = marker.indexOf(DELIM);
  if (start < 0) return '';
  const end = marker.indexOf(STOP, start);
  return marker.slice(start + 1, end < 0 ? undefined : end);
}

export interface ReferenceOptions {
  /** `message.metadata.content_references`, when the payload had it. */
  contentReferences?: unknown;
}

/**
 * Replace every recognizable ChatGPT reference marker in `text` with readable
 * text, and report what was replaced.
 *
 * A name is used only when the provider supplied one. When it did not, the
 * replacement says that a reference existed without inventing a file name,
 * and the surrounding sentence is left alone.
 */
export function normalizeChatGptReferences(
  text: string,
  options: ReferenceOptions = {},
): NormalizeReferencesResult {
  const references: TurnReference[] = [];
  if (!text) return { text, references };

  const { byMatchedText, byId } = indexContentReferences(
    options.contentReferences,
  );

  // Nothing to do, and nothing that looks like a marker: leave the text alone
  // rather than running it through the replacement machinery.
  if (byMatchedText.size === 0 && !containsMarkerCharacters(text)) {
    return { text, references };
  }

  let out = text;

  // 1. Exact replacements ChatGPT itself told us about. Longest first, so a
  //    marker that contains another marker's text cannot be half-replaced.
  const exact = [...byMatchedText.entries()].sort(
    (a, b) => b[0].length - a[0].length,
  );
  for (const [matched, replacement] of exact) {
    if (!out.includes(matched)) continue;
    out = replaceAll(out, matched, replacement.label);
    if (replacement.reference) references.push(replacement.reference);
  }

  // 2. Anything left that still matches the marker grammar. The name can only
  //    come from an id we learned about above; it is never guessed.
  out = out.replace(MARKER, (marker, _keyword: string, body: string, offset: number, whole: string) => {
    const kind = kindOf(body);
    const name = idsIn(body)
      .map((id) => byId.get(id))
      .find((value): value is string => Boolean(value));
    references.push({ kind, name, raw: marker });
    return spaced(whole.slice(0, offset), labelFor(kind, name));
  });

  // 3. The older bracket form, which carries its source name inline.
  out = out.replace(BRACKET_CITATION, (marker, body: string) => {
    const name = cleanName(body.split(DAGGER).slice(1).join(DAGGER));
    // Only treat it as a citation when it looks like one; ideographic
    // brackets are ordinary punctuation in Chinese and Japanese text.
    if (!/^\d+:\d+/.test(body.trim())) return marker;
    references.push({ kind: 'file', name, raw: marker });
    return labelFor('file', name);
  });

  // 4. Truncated or stray delimiters, which would otherwise show as invisible
  //    but very much present characters.
  out = out.replace(UNCLOSED_MARKER, '').replace(STRAY_DELIMITER, '');

  // 5. Tidy the spacing the removals left behind.
  out = out.replace(/[ \t]{2,}/g, ' ').replace(/[ \t]+(\n|$)/g, '$1');

  return { text: out, references };
}

/** Cheap check for whether the marker machinery needs to run at all. */
function containsMarkerCharacters(text: string): boolean {
  for (let i = 0; i < text.length; i++) {
    const code = text.charCodeAt(i);
    if (code >= PUA_FIRST && code <= PUA_LAST) return true;
    if (code === 0x3010) return true;
  }
  return false;
}

/** Literal replacement, with no regex interpretation of the needle. */
function replaceAll(haystack: string, needle: string, value: string): string {
  if (!needle) return haystack;
  const parts = haystack.split(needle);
  if (parts.length === 1) return haystack;
  let out = parts[0] as string;
  for (let i = 1; i < parts.length; i++) {
    out += spaced(out, value) + (parts[i] as string);
  }
  return out;
}
