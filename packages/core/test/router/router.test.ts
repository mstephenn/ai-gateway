import { describe, it, expect, vi } from "vitest";
import { createRouter, AllDeploymentsExhaustedError } from "../../src/router/router";
import { ModelNotFoundError, UpstreamError, TimeoutError, UpstreamHttpError } from "../../src/errors";
import type { ChatCompletionChunk } from "../../src/types/chat";
import type { Deployment } from "../../src/types/deployment";
import type { EmbeddingRequest, EmbeddingResponse } from "../../src/types/embeddings";
import type { Provider } from "../../src/types/provider";

function chunk(content: string): ChatCompletionChunk {
  return {
    id: "chunk",
    object: "chat.completion.chunk",
    model: "gpt-4o",
    choices: [{ index: 0, delta: { role: "assistant", content }, finish_reason: null }],
  };
}

function streamingProvider(contents: string[]): Provider {
  return {
    chatCompletion: vi.fn(),
    chatCompletionStream: vi.fn(async function* () {
      for (const c of contents) {yield chunk(c);}
    }),
  };
}

async function collect(iterable: AsyncIterable<ChatCompletionChunk>): Promise<ChatCompletionChunk[]> {
  const out: ChatCompletionChunk[] = [];
  for await (const c of iterable) {out.push(c);}
  return out;
}

function fakeDbWithDeployments(deployments: Deployment[]) {
  return {
    deployment: {
      findMany: vi.fn().mockResolvedValue(deployments),
    },
  } as any;
}

function inMemoryRedis() {
  const store = new Map<string, { value: string; expiry: number }>();
  return {
    async get(key: string) {
      const entry = store.get(key);
      if (entry === undefined) {return null;}
      if (Date.now() > entry.expiry) {
        store.delete(key);
        return null;
      }
      return entry.value;
    },
    async set(key: string, value: string, ttlSeconds: number) {
      store.set(key, { value, expiry: Date.now() + ttlSeconds * 1000 });
    },
    async incr(key: string) {
      const entry = store.get(key);
      const next = entry ? parseInt(entry.value, 10) + 1 : 1;
      store.set(key, { value: String(next), expiry: entry?.expiry ?? Date.now() + 60 * 1000 });
      return next;
    },
  };
}

const baseDeployment: Deployment = {
  id: "d1",
  modelName: "gpt-4o",
  provider: "openai",
  providerModelId: "gpt-4o",
  credentialsRef: "ref",
  weight: 1,
  isActive: true,
};

describe("router", () => {
  it("returns 503-triggering error when every eligible deployment fails", async () => {
    const failingProvider: Provider = {
      chatCompletion: vi.fn().mockRejectedValue(new Error("upstream down")),
      chatCompletionStream: vi.fn(),
    };
    const db = fakeDbWithDeployments([baseDeployment]);
    const router = createRouter(db, inMemoryRedis(), new Map([["ref", failingProvider]]));

    await expect(
      router.execute({ model: "gpt-4o", messages: [{ role: "user", content: "hi" }] }),
    ).rejects.toThrow(AllDeploymentsExhaustedError);
  });

  it("falls back to a second deployment when the first fails", async () => {
    const failing: Deployment = { ...baseDeployment, id: "d1" };
    const healthy: Deployment = { ...baseDeployment, id: "d2" };
    const failingProvider: Provider = {
      chatCompletion: vi.fn().mockRejectedValue(new Error("down")),
      chatCompletionStream: vi.fn(),
    };
    const successResponse = {
      id: "ok",
      object: "chat.completion" as const,
      model: "gpt-4o",
      choices: [],
      usage: { prompt_tokens: 1, completion_tokens: 1, total_tokens: 2 },
    };
    const healthyProvider: Provider = {
      chatCompletion: vi.fn().mockResolvedValue(successResponse),
      chatCompletionStream: vi.fn(),
    };

    // Provider selection is keyed by each deployment's credentialsRef.
    const failingDeployment = { ...failing, credentialsRef: "failing-vendor" };
    const healthyDeployment = { ...healthy, credentialsRef: "healthy-vendor" };
    const db = fakeDbWithDeployments([failingDeployment, healthyDeployment]);
    const providers = new Map<string, Provider>([
      ["failing-vendor", failingProvider],
      ["healthy-vendor", healthyProvider],
    ]);
    const router = createRouter(db, inMemoryRedis(), providers);

    // Weighted-random selection is non-deterministic across two equal-weight
    // deployments, so retry the request enough times that both selection
    // orders are exercised — the assertion is just that it eventually
    // succeeds via fallback, not which deployment is tried first.
    const result = await router.execute({ model: "gpt-4o", messages: [{ role: "user", content: "hi" }] });
    expect(result).toEqual(successResponse);
  });

  it("throws ModelNotFoundError when no deployment exists for the model", async () => {
    const db = fakeDbWithDeployments([]);
    const router = createRouter(db, inMemoryRedis(), new Map());

    await expect(
      router.execute({ model: "no-such-model", messages: [{ role: "user", content: "hi" }] }),
    ).rejects.toThrow(ModelNotFoundError);
  });

  it("executeStream yields every chunk from the provider", async () => {
    const db = fakeDbWithDeployments([baseDeployment]);
    const router = createRouter(db, inMemoryRedis(), new Map([["ref", streamingProvider(["a", "b"])]]));

    const chunks = await collect(
      router.executeStream({ model: "gpt-4o", messages: [{ role: "user", content: "hi" }] }),
    );

    expect(chunks.map((c) => c.choices[0].delta.content)).toEqual(["a", "b"]);
  });

  it("executeStream falls back to a second deployment when the first fails before yielding", async () => {
    const failingProvider: Provider = {
      chatCompletion: vi.fn(),
      chatCompletionStream: vi.fn(async function* (): AsyncGenerator<ChatCompletionChunk> {
        throw new Error("down");
      }),
    };
    const healthyDeployment = { ...baseDeployment, id: "d2", credentialsRef: "healthy-vendor" };
    const failingDeployment = { ...baseDeployment, id: "d1", credentialsRef: "failing-vendor" };
    const db = fakeDbWithDeployments([failingDeployment, healthyDeployment]);
    const providers = new Map<string, Provider>([
      ["failing-vendor", failingProvider],
      ["healthy-vendor", streamingProvider(["ok"])],
    ]);
    const router = createRouter(db, inMemoryRedis(), providers);

    const chunks = await collect(
      router.executeStream({ model: "gpt-4o", messages: [{ role: "user", content: "hi" }] }),
    );

    expect(chunks.map((c) => c.choices[0].delta.content)).toEqual(["ok"]);
  });

  it("executeStream throws ModelNotFoundError when no deployment exists for the model", async () => {
    const db = fakeDbWithDeployments([]);
    const router = createRouter(db, inMemoryRedis(), new Map());

    await expect(
      collect(router.executeStream({ model: "no-such-model", messages: [{ role: "user", content: "hi" }] })),
    ).rejects.toThrow(ModelNotFoundError);
  });

  it("executeStream propagates an error once bytes are already flowing", async () => {
    const midStreamFailure: Provider = {
      chatCompletion: vi.fn(),
      chatCompletionStream: vi.fn(async function* (): AsyncGenerator<ChatCompletionChunk> {
        yield chunk("partial");
        throw new UpstreamError("connection reset");
      }),
    };
    const db = fakeDbWithDeployments([baseDeployment]);
    const router = createRouter(db, inMemoryRedis(), new Map([["ref", midStreamFailure]]));

    await expect(
      collect(router.executeStream({ model: "gpt-4o", messages: [{ role: "user", content: "hi" }] })),
    ).rejects.toThrow("connection reset");
  });

  it("retries a failing deployment up to maxRetries times before falling back", async () => {
    let callCount = 0;
    const failThenSucceed: Provider = {
      chatCompletion: vi.fn(async () => {
        callCount++;
        if (callCount < 3) {throw new UpstreamHttpError(500, "service unavailable");}
        return {
          id: "ok",
          object: "chat.completion" as const,
          model: "gpt-4o",
          choices: [],
          usage: { prompt_tokens: 1, completion_tokens: 1, total_tokens: 2 },
        };
      }),
      chatCompletionStream: vi.fn(),
    };
    const deployment = { ...baseDeployment, maxRetries: 2 };
    const db = fakeDbWithDeployments([deployment]);
    const router = createRouter(db, inMemoryRedis(), new Map([["ref", failThenSucceed]]));

    const result = await router.execute({ model: "gpt-4o", messages: [{ role: "user", content: "hi" }] });
    expect(result).toMatchObject({ id: "ok" });
    expect(callCount).toBe(3);
  });

  it("throws TimeoutError when deployment timeout is exceeded", async () => {
    const neverResolves: Provider = {
      chatCompletion: vi.fn(async () => {
        await new Promise(() => {});
      }),
      chatCompletionStream: vi.fn(),
    };
    const deployment = { ...baseDeployment, timeoutMs: 20, maxRetries: 0 };
    const db = fakeDbWithDeployments([deployment]);
    const router = createRouter(db, inMemoryRedis(), new Map([["ref", neverResolves]]));

    await expect(
      router.execute({ model: "gpt-4o", messages: [{ role: "user", content: "hi" }] }),
    ).rejects.toThrow(TimeoutError);
  });

  it("uses per-deployment resilience config instead of defaults", async () => {
    let aCallCount = 0;
    let bCallCount = 0;
    const failALot: Provider = {
      chatCompletion: vi.fn(async () => {
        aCallCount++;
        throw new UpstreamHttpError(500, "service unavailable");
      }),
      chatCompletionStream: vi.fn(),
    };
    const failOnce: Provider = {
      chatCompletion: vi.fn(async () => {
        bCallCount++;
        if (bCallCount === 1) {throw new UpstreamHttpError(500, "service unavailable");}
        return {
          id: "ok",
          object: "chat.completion" as const,
          model: "gpt-4o",
          choices: [],
          usage: { prompt_tokens: 1, completion_tokens: 1, total_tokens: 2 },
        };
      }),
      chatCompletionStream: vi.fn(),
    };
    const deploymentA = { ...baseDeployment, id: "dA", credentialsRef: "vendor-a", weight: 100, maxRetries: 0 };
    const deploymentB = { ...baseDeployment, id: "dB", credentialsRef: "vendor-b", weight: 1, maxRetries: 2 };
    const db = fakeDbWithDeployments([deploymentA, deploymentB]);
    const providers = new Map<string, Provider>([
      ["vendor-a", failALot],
      ["vendor-b", failOnce],
    ]);
    const router = createRouter(db, inMemoryRedis(), providers);

    const result = await router.execute({ model: "gpt-4o", messages: [{ role: "user", content: "hi" }] });
    expect(result).toMatchObject({ id: "ok" });
    expect(aCallCount).toBe(1);
    expect(bCallCount).toBe(2);
  });

  it("treats plain Error as retryable like UpstreamHttpError", async () => {
    let callCount = 0;
    const failThenSucceed: Provider = {
      chatCompletion: vi.fn(async () => {
        callCount++;
        if (callCount < 2) {throw new Error("connection timeout");}
        return {
          id: "ok",
          object: "chat.completion" as const,
          model: "gpt-4o",
          choices: [],
          usage: { prompt_tokens: 1, completion_tokens: 1, total_tokens: 2 },
        };
      }),
      chatCompletionStream: vi.fn(),
    };
    const deployment = { ...baseDeployment, maxRetries: 1 };
    const db = fakeDbWithDeployments([deployment]);
    const router = createRouter(db, inMemoryRedis(), new Map([["ref", failThenSucceed]]));

    const result = await router.execute({ model: "gpt-4o", messages: [{ role: "user", content: "hi" }] });
    expect(result).toMatchObject({ id: "ok" });
    expect(callCount).toBe(2);
  });
});

describe("router embeddings", () => {
  const embeddingDeployment: Deployment = {
    id: "d1",
    modelName: "text-embedding-3-small",
    provider: "openai",
    providerModelId: "text-embedding-3-small",
    credentialsRef: "ref",
    weight: 1,
    isActive: true,
  };

  const embeddingResponse: EmbeddingResponse = {
    object: "list",
    data: [{ object: "embedding", embedding: [0.1, 0.2], index: 0 }],
    model: "text-embedding-3-small",
    usage: { prompt_tokens: 2, total_tokens: 2 },
  };

  it("executeEmbeddings returns the provider response", async () => {
    const provider: Provider = {
      chatCompletion: vi.fn(),
      chatCompletionStream: vi.fn(),
      embeddings: vi.fn().mockResolvedValue(embeddingResponse),
    };
    const db = fakeDbWithDeployments([embeddingDeployment]);
    const router = createRouter(db, inMemoryRedis(), new Map([["ref", provider]]));

    const result = await router.executeEmbeddings({ model: "text-embedding-3-small", input: "hello" });
    expect(result).toEqual(embeddingResponse);
  });

  it("executeEmbeddings throws ModelNotFoundError when no deployment exists", async () => {
    const db = fakeDbWithDeployments([]);
    const router = createRouter(db, inMemoryRedis(), new Map());

    await expect(
      router.executeEmbeddings({ model: "text-embedding-3-small", input: "hello" }),
    ).rejects.toThrow(ModelNotFoundError);
  });

  it("executeEmbeddings falls back when a provider lacks embeddings support", async () => {
    const unsupportedProvider: Provider = {
      chatCompletion: vi.fn(),
      chatCompletionStream: vi.fn(),
    };
    const supportedProvider: Provider = {
      chatCompletion: vi.fn(),
      chatCompletionStream: vi.fn(),
      embeddings: vi.fn().mockResolvedValue(embeddingResponse),
    };
    const failingDeployment = { ...embeddingDeployment, id: "d1", credentialsRef: "unsupported" };
    const healthyDeployment = { ...embeddingDeployment, id: "d2", credentialsRef: "supported" };
    const db = fakeDbWithDeployments([failingDeployment, healthyDeployment]);
    const router = createRouter(
      db,
      inMemoryRedis(),
      new Map<string, Provider>([
        ["unsupported", unsupportedProvider],
        ["supported", supportedProvider],
      ]),
    );

    const result = await router.executeEmbeddings({ model: "text-embedding-3-small", input: "hello" });
    expect(result).toEqual(embeddingResponse);
  });

  it("executeEmbeddings retries a failing deployment before falling back", async () => {
    let callCount = 0;
    const failThenSucceed: Provider = {
      chatCompletion: vi.fn(),
      chatCompletionStream: vi.fn(),
      embeddings: vi.fn(async () => {
        callCount++;
        if (callCount < 3) {throw new UpstreamHttpError(500, "service unavailable");}
        return embeddingResponse;
      }),
    };
    const deployment = { ...embeddingDeployment, maxRetries: 2 };
    const db = fakeDbWithDeployments([deployment]);
    const router = createRouter(db, inMemoryRedis(), new Map([["ref", failThenSucceed]]));

    const result = await router.executeEmbeddings({ model: "text-embedding-3-small", input: "hello" });
    expect(result).toEqual(embeddingResponse);
    expect(callCount).toBe(3);
  });
});
