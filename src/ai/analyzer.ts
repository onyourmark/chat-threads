/**
 * The half of an analyzer that is the same for every provider.
 *
 * A provider subclass supplies its name, its endpoint, and `complete` — one
 * prompt in, one reply out. It does not know how many requests a run takes,
 * what a topic proposal looks like, or how a long conversation is divided,
 * because none of that differs between OpenAI and Anthropic and duplicating it
 * would mean fixing every bug twice.
 */

import { runTopicAnalysis } from './run';
import type {
  AnalysisInput,
  AnalyzeOptions,
  AnalyzerResult,
  ModelRequest,
  ModelResult,
  TopicAnalyzer,
} from './types';

export abstract class BaseAnalyzer implements TopicAnalyzer {
  abstract readonly id: string;
  abstract readonly label: string;
  abstract readonly endpointOrigin: string;

  /** One model call. The only thing a provider has to write. */
  abstract complete(
    request: ModelRequest,
    options?: AnalyzeOptions,
  ): Promise<ModelResult>;

  /** A whole run: one request for most conversations, several for a long one. */
  analyze(
    input: AnalysisInput,
    options: AnalyzeOptions = {},
  ): Promise<AnalyzerResult> {
    return runTopicAnalysis(this, input, options);
  }
}
