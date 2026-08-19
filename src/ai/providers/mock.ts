/**
 * An analyzer that returns a canned reply instead of calling anything.
 *
 * Used by the tests to drive the whole Find Topics path — request building,
 * validation, review, correction — without credentials or a network. It is
 * not registered in the side panel; nothing ships a fake proposal to users.
 */

import { parseModelJson, validateTopicProposal } from '../schema';
import type {
  AnalysisInput,
  AnalyzeOptions,
  AnalyzerResult,
  TopicAnalyzer,
} from '../types';

export class MockAnalyzer implements TopicAnalyzer {
  readonly id = 'mock';
  readonly label = 'Mock analyzer';
  readonly endpointOrigin = 'none';

  /** Every input this analyzer was given, for assertions about what is sent. */
  readonly calls: AnalysisInput[] = [];

  constructor(private readonly reply: string) {}

  async analyze(
    input: AnalysisInput,
    _options: AnalyzeOptions = {},
  ): Promise<AnalyzerResult> {
    this.calls.push(input);
    const parsed = parseModelJson(this.reply);
    if (parsed === null) {
      return { ok: false, errors: ['The model did not return usable JSON.'] };
    }
    return validateTopicProposal(
      parsed,
      input.turns.map((t) => t.number),
    );
  }
}
