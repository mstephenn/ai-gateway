import { describe, it, expect } from "vitest";
import { createRateLimiter } from "../../src/rateLimiter/rateLimiter";
import { RateLimitError } from "../../src/errors";
import type { RedisLike } from "../../src/router/router";

function inMemoryRedis(): RedisLike {
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

describe("createRateLimiter", () => {
  it("allows requests when no limit is configured", async () => {
    const limiter = createRateLimiter(inMemoryRedis());
    await expect(limiter.checkAndRecord("key-1", undefined)).resolves.toBeUndefined();
  });

  it("allows requests up to the rpm limit", async () => {
    const limiter = createRateLimiter(inMemoryRedis());
    await limiter.checkAndRecord("key-1", 2);
    await limiter.checkAndRecord("key-1", 2);
  });

  it("throws RateLimitError when the limit is exceeded", async () => {
    const limiter = createRateLimiter(inMemoryRedis());
    await limiter.checkAndRecord("key-1", 1);
    await expect(limiter.checkAndRecord("key-1", 1)).rejects.toThrow(RateLimitError);
  });

  it("tracks different keys independently", async () => {
    const limiter = createRateLimiter(inMemoryRedis());
    await limiter.checkAndRecord("key-1", 1);
    await limiter.checkAndRecord("key-2", 1);
  });

  it("allows tokens up to the tpm limit", async () => {
    const limiter = createRateLimiter(inMemoryRedis());
    await limiter.checkTokens("key-1", 500, 1000);
    await limiter.recordTokens("key-1", 500);
    await limiter.checkTokens("key-1", 500, 1000);
  });

  it("throws RateLimitError when token count would exceed the tpm limit", async () => {
    const limiter = createRateLimiter(inMemoryRedis());
    await limiter.recordTokens("key-1", 600);
    await expect(limiter.checkTokens("key-1", 500, 1000)).rejects.toThrow(RateLimitError);
  });

  it("records tokens and reflects them in subsequent checks", async () => {
    const limiter = createRateLimiter(inMemoryRedis());
    await limiter.recordTokens("key-1", 100);
    await limiter.recordTokens("key-1", 200);
    await expect(limiter.checkTokens("key-1", 801, 1000)).rejects.toThrow(RateLimitError);
  });
});
