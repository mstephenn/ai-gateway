import { RateLimitError } from "../errors.js";
import type { RedisLike } from "../router/router.js";

export interface RateLimiter {
  checkAndRecord(apiKeyId: string, rpmLimit?: number): Promise<void>;
  checkTokens(
    apiKeyId: string,
    tokenCount: number,
    tpmLimit?: number,
  ): Promise<void>;
  recordTokens(apiKeyId: string, tokenCount: number): Promise<void>;
}

const WINDOW_SECONDS = 60;

function rpmKey(apiKeyId: string, minute: number): string {
  return `rate:rpm:${apiKeyId}:${minute}`;
}

function tpmKey(apiKeyId: string, minute: number): string {
  return `rate:tpm:${apiKeyId}:${minute}`;
}

function currentMinute(): number {
  return Math.floor(Date.now() / 1000 / WINDOW_SECONDS);
}

export function createRateLimiter(redis: RedisLike): RateLimiter {
  return {
    async checkAndRecord(apiKeyId: string, rpmLimit?: number): Promise<void> {
      if (!rpmLimit || rpmLimit <= 0) {
        return;
      }

      const minute = currentMinute();
      const key = rpmKey(apiKeyId, minute);
      const count = await redis.incr(key);

      if (count === 1) {
        await redis.set(key, "1", WINDOW_SECONDS);
      }

      if (count > rpmLimit) {
        throw new RateLimitError("rate_limit_exceeded");
      }
    },

    async checkTokens(
      apiKeyId: string,
      tokenCount: number,
      tpmLimit?: number,
    ): Promise<void> {
      if (!tpmLimit || tpmLimit <= 0) {
        return;
      }

      const minute = currentMinute();
      const key = tpmKey(apiKeyId, minute);
      const current = await redis.get(key);
      const currentCount = current ? parseInt(current, 10) : 0;

      if (currentCount + tokenCount > tpmLimit) {
        throw new RateLimitError("token_rate_limit_exceeded");
      }
    },

    async recordTokens(apiKeyId: string, tokenCount: number): Promise<void> {
      if (tokenCount <= 0) {
        return;
      }

      const minute = currentMinute();
      const key = tpmKey(apiKeyId, minute);
      const current = await redis.get(key);
      const next = (current ? parseInt(current, 10) : 0) + tokenCount;
      await redis.set(key, String(next), WINDOW_SECONDS);
    },
  };
}
