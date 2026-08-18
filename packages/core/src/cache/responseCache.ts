import { createHash } from "node:crypto";

import type { RedisLike } from "../router/router.js";
import type {
  ChatCompletionRequest,
  ChatCompletionResponse,
} from "../types/chat.js";

export interface ResponseCache {
  get(req: ChatCompletionRequest): Promise<ChatCompletionResponse | undefined>;
  set(
    req: ChatCompletionRequest,
    response: ChatCompletionResponse,
  ): Promise<void>;
}

function cacheKey(req: ChatCompletionRequest): string {
  const payload = JSON.stringify({
    model: req.model,
    messages: req.messages,
    temperature: req.temperature,
    max_tokens: req.max_tokens,
  });
  const hash = createHash("sha256").update(payload).digest("hex");
  return `prompt-cache:${hash}`;
}

export function createResponseCache(
  redis: RedisLike,
  ttlSeconds: number,
): ResponseCache {
  return {
    async get(
      req: ChatCompletionRequest,
    ): Promise<ChatCompletionResponse | undefined> {
      const cached = await redis.get(cacheKey(req));
      if (!cached) {
        return undefined;
      }
      return JSON.parse(cached) as ChatCompletionResponse;
    },

    async set(
      req: ChatCompletionRequest,
      response: ChatCompletionResponse,
    ): Promise<void> {
      await redis.set(cacheKey(req), JSON.stringify(response), ttlSeconds);
    },
  };
}
