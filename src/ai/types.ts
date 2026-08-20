/**
 * The topic-analysis interface.
 *
 * The side panel talks only to a `TopicAnalyzer`. Adding a model provider
 * means writing one of these; it does not touch the UI, the conversation
 * model, or the validator.
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

export interface AnalyzeOptions {
  signal?: AbortSignal;
}

export interface TopicAnalyzer {
  readonly id: string;
  readonly label: string;
  /** The host the request goes to, shown to the user before they confirm. */
  readonly endpointOrigin: string;
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
