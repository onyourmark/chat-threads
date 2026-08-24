/**
 * The topic-analysis interface.
 *
 * The side panel talks only to a `TopicAnalyzer`. Adding a model provider
 * means writing one of these; it does not touch the UI, the conversation
 * model, or the validator.
 *
 * A provider implements exactly one thing: `complete`, which sends one prompt
 * and returns the reply as text. Everything above that — what to ask, how many
 * times to ask it, how to read the answer — lives in `run.ts`, so that a long
 * conversation is handled identically whichever provider the user picked.
 *
 * Nothing in this layer runs unless the user presses Find Topics, and the
 * input it receives is built explicitly in `buildAnalysisInput` — no code path
 * hands a whole conversation object to a provider.
 */

import type { Role } from '../model/types';
import type { TopicProposal } from './schema';

/** One turn as the model sees it. */
export interface AnalysisTurn {
  /** The turn's sequence number, which the model must echo back. */
  number: number;
  role: Role;
  /** Turn text, possibly shortened — see `AnalysisOptions.maxCharsPerTurn`. */
  text: string;
  /** True when `text` was shortened before sending. */
  truncated: boolean;
}

/** A topic that already exists, as the model is told about it. */
export interface AnalysisTopic {
  /** The id the model must use in its assignments. */
  id: string;
  name: string;
  description?: string;
}

export interface AnalysisInput {
  turns: AnalysisTurn[];
  /** The conversation title, when the provider gave one. */
  title?: string;
  /**
   * Topics that already exist and must be kept rather than re-invented. The
   * model may assign turns to these ids without proposing them.
   */
  existingTopics: AnalysisTopic[];
}

export type AnalyzerResult =
  | { ok: true; proposal: TopicProposal }
  | { ok: false; errors: string[] };

/**
 * Which step of a run a request belongs to.
 *
 * Providers do not need this — it never reaches the wire — but it makes a
 * request self-describing, which the tests rely on and which lets a provider
 * size a reply to the step if it ever needs to.
 */
export type AnalysisStage = 'single' | 'discover' | 'merge' | 'classify';

/** One model call, as the orchestrator describes it to a provider. */
export interface ModelRequest {
  stage: AnalysisStage;
  system: string;
  user: string;
  /** JSON Schema for structured output, where the provider supports it. */
  schema?: unknown;
  /**
   * A stable name for that schema.
   *
   * OpenAI's Chat Completions API requires one alongside the schema, and it
   * must match `[a-zA-Z0-9_-]{1,64}`. Set here rather than derived inside the
   * provider so the name belongs to the stage it describes.
   */
  schemaName?: string;
  /** Upper bound on the reply, for providers that require one. */
  maxOutputTokens: number;
}

/** The raw reply, or why there wasn't one. Never parsed by the provider. */
export type ModelResult =
  | { ok: true; text: string }
  | { ok: false; errors: string[] };

/**
 * What the run is doing right now, for the progress line in the panel.
 *
 * Sections are numbered from 1 and counted for the user, not for the code:
 * "section 3 of 15" is something a person can watch advance.
 */
export type AnalysisProgress =
  | { phase: 'single' }
  | { phase: 'discover'; section: number; sections: number }
  | { phase: 'merge' }
  | { phase: 'classify'; section: number; sections: number }
  /**
   * A reply came back in the wrong shape and is being asked for again. Rare,
   * bounded, and worth showing rather than looking like a stall.
   */
  | { phase: 'repair'; where: string };

export interface AnalyzeOptions {
  signal?: AbortSignal;
  onProgress?: (progress: AnalysisProgress) => void;
}

export interface TopicAnalyzer {
  readonly id: string;
  readonly label: string;
  /** The host the request goes to, shown to the user before they confirm. */
  readonly endpointOrigin: string;
  /** One model call. This is the only thing a provider implements. */
  complete(
    request: ModelRequest,
    options?: AnalyzeOptions,
  ): Promise<ModelResult>;
  /** A whole Find Topics run: one request, or many for a long conversation. */
  analyze(
    input: AnalysisInput,
    options?: AnalyzeOptions,
  ): Promise<AnalyzerResult>;
}

/** Settings the user controls for a live analyzer. */
export interface AnalyzerConfig {
  providerId: 'openai' | 'anthropic';
  apiKey: string;
  model: string;
}

export const DEFAULT_MODELS: Record<AnalyzerConfig['providerId'], string> = {
  anthropic: 'claude-opus-5',
  openai: 'gpt-4o-mini',
};

export const PROVIDER_ORIGINS: Record<AnalyzerConfig['providerId'], string> = {
  anthropic: 'https://api.anthropic.com',
  openai: 'https://api.openai.com',
};
