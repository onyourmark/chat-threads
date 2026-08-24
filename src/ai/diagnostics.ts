/**
 * Saying what shape a model reply had, without saying what was in it.
 *
 * When a stage rejects a reply the useful question is structural — "what did
 * it call the list?" — and answering it should never require printing the
 * conversation. A topic name is something the user wrote about; a property
 * name is not.
 *
 * So everything here is limited to structure: the kind of the value, its
 * top-level property names, and whether the property the stage needed was
 * present and an array. Values are never read, never counted by content and
 * never included. That makes a diagnostic safe to put in a message the user
 * can see and paste into a bug report.
 */

/** What the stage was owed, and what turned up instead. */
export interface ShapeReport {
  /** `object`, `array`, `string`, `number`, `boolean`, `null`, `nothing`. */
  kind: string;
  /** Top-level property names, when it was an object. Capped. */
  keys: string[];
  /** True when the expected property was there and was an array. */
  expectedPresent: boolean;
}

const MAX_KEYS = 12;
const MAX_KEY_LENGTH = 40;

/** A property name is structural, but it still came from outside. Clamp it. */
function safeKey(key: string): string {
  // eslint-disable-next-line no-control-regex
  const cleaned = key.replace(/[\u0000-\u001f\u007f]/g, ' ').trim();
  return cleaned.length > MAX_KEY_LENGTH
    ? `${cleaned.slice(0, MAX_KEY_LENGTH)}…`
    : cleaned;
}

/** Describe a parsed reply against the property the stage required. */
export function describeShape(raw: unknown, expected: string): ShapeReport {
  if (raw === undefined) {
    return { kind: 'nothing', keys: [], expectedPresent: false };
  }
  if (raw === null) return { kind: 'null', keys: [], expectedPresent: false };
  if (Array.isArray(raw)) {
    return { kind: 'array', keys: [], expectedPresent: false };
  }
  if (typeof raw !== 'object') {
    return { kind: typeof raw, keys: [], expectedPresent: false };
  }

  const record = raw as Record<string, unknown>;
  const all = Object.keys(record);
  const keys = all.slice(0, MAX_KEYS).map(safeKey);
  if (all.length > MAX_KEYS) keys.push(`…${all.length - MAX_KEYS} more`);

  return {
    kind: 'object',
    keys,
    expectedPresent: Array.isArray(record[expected]),
  };
}

/**
 * One short sentence naming the mismatch.
 *
 * Written to be shown: it is what turns "the reply had no topics list" into
 * something that says which key the model used instead.
 */
export function shapeSummary(report: ShapeReport, expected: string): string {
  if (report.kind !== 'object') {
    return `the reply was ${report.kind === 'nothing' ? 'empty' : `a JSON ${report.kind}`}, not an object with "${expected}"`;
  }
  if (report.expectedPresent) {
    return `"${expected}" was present but its contents did not fit`;
  }
  if (report.keys.length === 0) {
    return `the reply was an empty object, with no "${expected}"`;
  }
  return `the reply used ${report.keys.map((k) => `"${k}"`).join(', ')} instead of "${expected}"`;
}

/** Where a failure happened, for a message the user might report. */
export interface StageLocation {
  stage: string;
  /** 1-based, when the stage runs per section. */
  section?: number;
  sections?: number;
}

export function locationSummary(where: StageLocation): string {
  return where.section !== undefined && where.sections !== undefined
    ? `${where.stage} step, section ${where.section} of ${where.sections}`
    : `${where.stage} step`;
}
