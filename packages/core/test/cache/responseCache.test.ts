import { describe, it, expect } from "vitest";
import { createResponseCache } from "../../src/cache/responseCache";
import type { ChatCompletionResponse } from "../../src/types/chat";
import type { RedisLike } from "../../src/router/router";

function inMemoryRedis(): RedisLike {
  const store = new Map<string, string>();
  return {
    async get(key: string) {
      return store.get(key) ?? null;
    },
    async set(key: string, value: string, _ttlSeconds: number) {
      store.set(key, value);
    },
    async incr(key: string) {
      const next = (store.has(key) ? parseInt(store.get(key)!, 10) : 0) + 1;
      store.set(key, String(next));
      return next;
    },
  };
}

const baseRequest = {
  model: "gpt-4o",
  messages: [{ role: "user" as const, content: "hello" }],
};

const baseResponse: ChatCompletionResponse = {
  id: "chatcmpl-1",
  object: "chat.completion",
  model: "gpt-4o",
  choices: [{ index: 0, message: { role: "assistant" as const, content: "hi" }, finish_reason: "stop" }],
  usage: { prompt_tokens: 1, completion_tokens: 1, total_tokens: 2 },
};

describe("createResponseCache", () => {
  it("returns undefined when the key is absent", async () => {
    const cache = createResponseCache(inMemoryRedis(), 60);
    const result = await cache.get(baseRequest);
    expect(result).toBeUndefined();
  });

  it("stores and retrieves a response", async () => {
    const cache = createResponseCache(inMemoryRedis(), 60);
    await cache.set(baseRequest, baseResponse);
    const result = await cache.get(baseRequest);
    expect(result).toEqual(baseResponse);
  });

  it("uses different keys for different request shapes", async () => {
    const cache = createResponseCache(inMemoryRedis(), 60);
    await cache.set(baseRequest, baseResponse);

    const otherRequest = { ...baseRequest, temperature: 0.5 };
    const result = await cache.get(otherRequest);
    expect(result).toBeUndefined();
  });
});
