import type { DbClient } from "../db/client.js";
import {
  AllDeploymentsExhaustedError,
  ModelNotFoundError,
  TimeoutError,
  UpstreamError,
  UpstreamHttpError,
} from "../errors.js";
import { cooldownKey } from "./deploymentHealth.js";
import type {
  ChatCompletionChunk,
  ChatCompletionRequest,
  ChatCompletionResponse,
} from "../types/chat.js";
import type { Deployment } from "../types/deployment.js";
import type {
  EmbeddingRequest,
  EmbeddingResponse,
} from "../types/embeddings.js";
import type { Provider } from "../types/provider.js";

const MAX_ATTEMPTS = 3;
const COOLDOWN_SECONDS = 30;

export { AllDeploymentsExhaustedError } from "../errors.js";

export interface RedisLike {
  get(key: string): Promise<string | null>;
  set(key: string, value: string, ttlSeconds: number): Promise<void>;
  incr(key: string): Promise<number>;
}

export interface ResilienceDefaults {
  timeoutMs: number;
  maxRetries: number;
  backoffMs: number;
}

function weightedRandomPick(candidates: Deployment[]): Deployment {
  const totalWeight = candidates.reduce((sum, d) => sum + d.weight, 0);
  let roll = Math.random() * totalWeight;
  for (const candidate of candidates) {
    roll -= candidate.weight;
    if (roll <= 0) {
      return candidate;
    }
  }
  return candidates[candidates.length - 1];
}

function resolveResilience(
  deployment: Deployment,
  defaults: ResilienceDefaults,
): ResilienceDefaults {
  return {
    timeoutMs: deployment.timeoutMs ?? defaults.timeoutMs,
    maxRetries: deployment.maxRetries ?? defaults.maxRetries,
    backoffMs: deployment.retryBackoffMs ?? defaults.backoffMs,
  };
}

function isRetryable(err: unknown): boolean {
  if (err instanceof UpstreamHttpError) {
    return err.status >= 500 || err.status === 429;
  }
  return true;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function withTimeout<T>(
  fn: () => Promise<T>,
  timeoutMs: number,
): Promise<T> {
  let timer!: ReturnType<typeof setTimeout>;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(
      () =>
        reject(
          new TimeoutError(`Deployment attempt timed out after ${timeoutMs}ms`),
        ),
      timeoutMs,
    );
  });
  try {
    return await Promise.race([fn(), timeout]);
  } finally {
    clearTimeout(timer);
  }
}

async function attemptWithRetry<T>(
  fn: () => Promise<T>,
  config: ResilienceDefaults,
): Promise<T> {
  let lastError: unknown;
  for (let attempt = 0; attempt <= config.maxRetries; attempt++) {
    try {
      return await withTimeout(fn, config.timeoutMs);
    } catch (err) {
      lastError = err;
      if (attempt === config.maxRetries || !isRetryable(err)) {
        break;
      }
      await sleep(config.backoffMs * 2 ** attempt);
    }
  }
  throw lastError;
}

export interface Router {
  execute(req: ChatCompletionRequest): Promise<ChatCompletionResponse>;
  executeStream(req: ChatCompletionRequest): AsyncIterable<ChatCompletionChunk>;
  executeEmbeddings(req: EmbeddingRequest): Promise<EmbeddingResponse>;
}

type AttemptFn<T> = (provider: Provider, deployment: Deployment) => Promise<T>;

interface ModelRequest {
  model: string;
}

export function createRouter(
  db: DbClient,
  redis: RedisLike,
  providers: Map<string, Provider>,
  resilienceDefaults: ResilienceDefaults = {
    timeoutMs: 60000,
    maxRetries: 2,
    backoffMs: 1000,
  },
): Router {
  async function withFallback<T>(
    req: ModelRequest,
    attemptFn: AttemptFn<T>,
  ): Promise<T> {
    const allDeployments: Deployment[] = await db.deployment.findMany({
      where: { modelName: req.model, isActive: true },
    });

    if (allDeployments.length === 0) {
      throw new ModelNotFoundError(req.model);
    }

    const tried = new Set<string>();
    let lastError: unknown;

    for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt++) {
      const eligible: Deployment[] = [];
      for (const d of allDeployments) {
        if (tried.has(d.id)) {
          continue;
        }
        const cooling = await redis.get(cooldownKey(d.id));
        if (cooling) {
          continue;
        }
        eligible.push(d);
      }

      if (eligible.length === 0) {
        throw new AllDeploymentsExhaustedError(req.model);
      }

      const deployment = weightedRandomPick(eligible);
      tried.add(deployment.id);

      const provider = providers.get(deployment.credentialsRef);
      if (!provider) {
        lastError = new Error(
          `No provider registered for credential "${deployment.credentialsRef}"`,
        );
        await redis.set(cooldownKey(deployment.id), "1", COOLDOWN_SECONDS);
        continue;
      }

      try {
        const resilience = resolveResilience(deployment, resilienceDefaults);
        return await attemptWithRetry(
          () => attemptFn(provider, deployment),
          resilience,
        );
      } catch (err) {
        if (err instanceof TimeoutError) {
          throw err;
        }
        lastError = err;
        await redis.set(cooldownKey(deployment.id), "1", COOLDOWN_SECONDS);
      }
    }

    if (
      lastError instanceof TimeoutError ||
      lastError instanceof AllDeploymentsExhaustedError
    ) {
      throw lastError;
    }

    throw lastError instanceof Error
      ? new UpstreamError(lastError.message, { cause: lastError })
      : new AllDeploymentsExhaustedError(req.model);
  }

  return {
    execute(req: ChatCompletionRequest): Promise<ChatCompletionResponse> {
      return withFallback(req, (provider, deployment) =>
        provider.chatCompletion(req, deployment),
      );
    },

    executeEmbeddings(req: EmbeddingRequest): Promise<EmbeddingResponse> {
      return withFallback(req, (provider, deployment) => {
        if (!provider.embeddings) {
          throw new UpstreamError(
            `Provider "${deployment.provider}" does not support embeddings`,
          );
        }
        return provider.embeddings(req, deployment);
      });
    },

    async *executeStream(
      req: ChatCompletionRequest,
    ): AsyncIterable<ChatCompletionChunk> {
      const started = await withFallback(req, async (provider, deployment) => {
        const iterator = provider
          .chatCompletionStream(req, deployment)
          [Symbol.asyncIterator]();
        const first = await iterator.next();
        return { iterator, first };
      });

      if (started.first.done) {
        return;
      }
      yield started.first.value;

      while (true) {
        const next = await started.iterator.next();
        if (next.done) {
          return;
        }
        yield next.value;
      }
    },
  };
}
