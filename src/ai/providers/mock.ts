/**
 * An analyzer that returns a canned reply instead of calling anything.
 *
 * Used by the tests to drive the whole Find Topics path — request building,
 * sectioning, validation, review, correction — without credentials or a
 * network. It is not registered in the side panel; nothing ships a fake
 * proposal to users.
 *
 * Two shapes, because the tests need two. A single string answers every
 * request, which is all a short conversation needs. A script answers each
 * stage separately, which is how a long conversation's three passes are
 * exercised: the script is handed the request, so a test can read the turn
 * numbers out of the prompt and reply about exactly those turns — the same
 * thing a real model would have to do.
 */

import { BaseAnalyzer } from '../analyzer';
import type {
  AnalysisStage,
  AnalyzeOptions,
  ModelRequest,
  ModelResult,
} from '../types';

/** A reply, or a failure, for one call of one stage. */
export type MockStageReply = (
  request: ModelRequest,
  /** 0-based, counted per stage. */
  call: number,
) => string | ModelResult;

export type MockScript = Partial<Record<AnalysisStage, MockStageReply>>;

export class MockAnalyzer extends BaseAnalyzer {
  readonly id = 'mock';
  readonly label = 'Mock analyzer';
  readonly endpointOrigin = 'none';

  /** Every request this analyzer was given, for assertions about what is sent. */
  readonly calls: ModelRequest[] = [];

  readonly #reply: string | MockScript;
  readonly #counts = new Map<AnalysisStage, number>();

  constructor(reply: string | MockScript) {
    super();
    this.#reply = reply;
  }

  /** How many calls each stage received. */
  countOf(stage: AnalysisStage): number {
    return this.#counts.get(stage) ?? 0;
  }

  async complete(
    request: ModelRequest,
    _options: AnalyzeOptions = {},
  ): Promise<ModelResult> {
    this.calls.push(request);
    const call = this.countOf(request.stage);
    this.#counts.set(request.stage, call + 1);

    if (typeof this.#reply === 'string') {
      return { ok: true, text: this.#reply };
    }

    const handler = this.#reply[request.stage];
    if (!handler) {
      return {
        ok: false,
        errors: [`The mock analyzer has no reply for the ${request.stage} stage.`],
      };
    }

    const answer = handler(request, call);
    return typeof answer === 'string' ? { ok: true, text: answer } : answer;
  }
}
