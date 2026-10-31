import {
  MEMORY_CHANGE_TYPES,
  MemoryDecisionError,
  type MemoryChangeJudge,
  type MemoryChangeJudgeInput,
  type MemoryChangeJudgment,
  type MemoryChangeType,
} from '../../domain/memory/decision';

const DEFAULT_ENDPOINT = 'https://openrouter.ai/api/alpha/decisions';
const DEFAULT_MODEL = 'typesafe/jev-1.14';
const DEFAULT_TIMEOUT_MS = 3000;
const DEFAULT_MAX_STATE_CHARS = 30_000;
const MAX_CURRENT_BODY_CHARS = 12_000;
const MAX_CHANGE_CHARS = 4_000;

export interface JevMemoryChangeJudgeOptions {
  apiKey?: string;
  endpoint?: string;
  model?: string;
  timeoutMs?: number;
  maxStateChars?: number;
  fetcher?: typeof fetch;
}

function clip(value: string, limit: number): string {
  return value.length <= limit ? value : value.slice(0, limit);
}

function isChangeType(value: unknown): value is MemoryChangeType {
  return typeof value === 'string' && (MEMORY_CHANGE_TYPES as readonly string[]).includes(value);
}

function probabilities(value: unknown): Readonly<Record<string, number>> | undefined {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return undefined;
  const entries = Object.entries(value).filter(
    (entry): entry is [string, number] => typeof entry[1] === 'number' && Number.isFinite(entry[1])
  );
  return entries.length ? Object.fromEntries(entries) : undefined;
}

/**
 * Calls TypeSafe Jev through OpenRouter's Decisions API.
 *
 * Jev returns typed judgments, never generated prose. The caller owns the
 * action taken from a judgment. This adapter deliberately does not retry:
 * callers must persist an unknown outcome instead of replaying a request.
 */
export class JevMemoryChangeJudge implements MemoryChangeJudge {
  readonly model: string;
  private readonly endpoint: string;
  private readonly timeoutMs: number;
  private readonly maxStateChars: number;
  private readonly fetcher: typeof fetch;
  readonly #apiKey: string;

  constructor(options: JevMemoryChangeJudgeOptions = {}) {
    const apiKey = options.apiKey ?? process.env.OPENROUTER_API_KEY ?? process.env.TYPESAFE_API_KEY;
    if (typeof apiKey !== 'string' || !apiKey.trim())
      throw new TypeError('An OpenRouter or TypeSafe API key is required.');
    const endpoint = options.endpoint ?? DEFAULT_ENDPOINT;
    const url = new URL(endpoint);
    if (url.protocol !== 'https:') throw new TypeError('The Jev endpoint must use HTTPS.');
    const model = options.model ?? DEFAULT_MODEL;
    if (typeof model !== 'string' || !model.trim()) throw new TypeError('A Jev model is required.');
    const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
    if (!Number.isSafeInteger(timeoutMs) || timeoutMs < 100 || timeoutMs > 60_000)
      throw new TypeError('Invalid Jev timeout.');
    const maxStateChars = options.maxStateChars ?? DEFAULT_MAX_STATE_CHARS;
    if (!Number.isSafeInteger(maxStateChars) || maxStateChars < 100)
      throw new TypeError('Invalid Jev state limit.');

    this.endpoint = endpoint.replace(/\/$/, '');
    this.model = model;
    this.timeoutMs = timeoutMs;
    this.maxStateChars = maxStateChars;
    this.fetcher = options.fetcher ?? globalThis.fetch.bind(globalThis);
    this.#apiKey = apiKey;
  }

  async judge(input: MemoryChangeJudgeInput): Promise<readonly MemoryChangeJudgment[]> {
    if (!input || !Array.isArray(input.changes) || !input.changes.length) return [];
    const state = {
      current: {
        title: input.current.title,
        summary: input.current.summary,
        body: clip(input.current.body, MAX_CURRENT_BODY_CHARS),
        updated_at: input.current.updatedAt,
      },
      changes: input.changes.map((change) => ({
        content: clip(change.content, MAX_CHANGE_CHARS),
        observed_at: change.createdAt,
      })),
    };
    const questions = Object.fromEntries(
      input.changes.map((_, index) => [
        `change_${index}`,
        {
          type: 'choice',
          instructions: `Which label best describes how changes[${index}] relates to current?`,
          criteria: {
            replacement:
              'changes[i] states a newer value or conclusion that replaces a fact still asserted by current.',
            addition:
              'changes[i] adds compatible durable information without replacing a fact in current.',
            reinforcement:
              'changes[i] supports or restates current without changing the asserted fact.',
            conflict:
              'changes[i] contradicts current, but the newer or valid value cannot be determined.',
            none: 'changes[i] has no durable relation to current.',
          },
        },
      ])
    );
    const request = JSON.stringify({ model: this.model, state, questions });
    if (request.length > this.maxStateChars)
      throw new MemoryDecisionError(
        'JEV_INPUT_TOO_LARGE',
        'failed',
        'The Jev decision input exceeds the configured limit.'
      );

    let response: Response;
    try {
      response = await this.fetcher(this.endpoint, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${this.#apiKey}`,
          'Content-Type': 'application/json',
        },
        body: request,
        signal: AbortSignal.timeout(this.timeoutMs),
      });
    } catch (cause) {
      throw new MemoryDecisionError(
        'JEV_REQUEST_FAILED',
        'unknown',
        'The Jev request may have run before failing.',
        { cause }
      );
    }

    if (!response.ok) {
      const text = await response.text().catch(() => '');
      throw new MemoryDecisionError(
        'JEV_HTTP_ERROR',
        response.status >= 500 ? 'unknown' : 'failed',
        `Jev returned HTTP ${response.status}: ${text.slice(0, 200)}`
      );
    }

    let body: unknown;
    try {
      body = await response.json();
    } catch (cause) {
      throw new MemoryDecisionError('JEV_OUTPUT_INVALID', 'failed', 'Jev returned invalid JSON.', {
        cause,
      });
    }
    if (!body || typeof body !== 'object' || Array.isArray(body))
      throw new MemoryDecisionError(
        'JEV_OUTPUT_INVALID',
        'failed',
        'Jev returned an invalid body.'
      );
    const answers = (body as { answers?: unknown }).answers;
    if (!answers || typeof answers !== 'object' || Array.isArray(answers))
      throw new MemoryDecisionError('JEV_OUTPUT_INVALID', 'failed', 'Jev returned no answers.');

    return input.changes.map((change, index) => {
      const raw = (answers as Record<string, unknown>)[`change_${index}`];
      if (!raw || typeof raw !== 'object' || Array.isArray(raw))
        throw new MemoryDecisionError('JEV_OUTPUT_INVALID', 'failed', 'A Jev answer is missing.');
      const answer = raw as Record<string, unknown>;
      if (!isChangeType(answer.choice))
        throw new MemoryDecisionError('JEV_OUTPUT_INVALID', 'failed', 'A Jev choice is invalid.');
      const confidence = answer.confidence;
      if (
        confidence !== undefined &&
        (typeof confidence !== 'number' ||
          !Number.isFinite(confidence) ||
          confidence < 0 ||
          confidence > 1)
      )
        throw new MemoryDecisionError(
          'JEV_OUTPUT_INVALID',
          'failed',
          'A Jev confidence is invalid.'
        );
      const result: MemoryChangeJudgment = {
        changedL1Id: change.id,
        type: answer.choice,
      };
      const probability = probabilities(answer.probabilities);
      if (probability) result.probabilities = probability;
      if (typeof confidence === 'number') result.confidence = confidence;
      return result;
    });
  }
}
