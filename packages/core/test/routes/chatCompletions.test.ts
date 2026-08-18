import { describe, it, expect, vi } from "vitest";
import { createHash } from "node:crypto";
import Fastify from "fastify";
import { registerChatCompletionsRoute } from "../../src/routes/chatCompletions";
import { AllDeploymentsExhaustedError } from "../../src/router/router";
import { BudgetExceededError, ModelAccessDeniedError, ModelNotFoundError, RateLimitError } from "../../src/errors";
import type { ResponseCache } from "../../src/cache/responseCache";
import type { RateLimiter } from "../../src/rateLimiter/rateLimiter";
import type { BudgetChecker } from "../../src/budget/budget";
import type { PluginRegistry } from "../../src/plugins/registry";
import { createPluginRegistry } from "../../src/plugins/registry";
import { Decimal } from "../../src/db/generated/client";

function fakeDb(row: { id: string; keyHash: string; isActive: boolean; tpmLimit?: number; budgetLimit?: Decimal; allowedModels?: string[] } | undefined) {
  return {
    apiKey: {
      findUnique: vi.fn().mockResolvedValue(row ?? null),
    },
    requestLog: {
      create: vi.fn().mockResolvedValue(undefined),
    },
  } as any;
}

function fakePluginRegistry(): PluginRegistry {
  return createPluginRegistry();
}

describe("POST /v1/chat/completions", () => {
  it("returns 401 when no bearer token is provided", async () => {
    const app = Fastify();
    registerChatCompletionsRoute(app, { db: fakeDb(undefined), router: { execute: vi.fn() }, pluginRegistry: fakePluginRegistry() });

    const res = await app.inject({
      method: "POST",
      url: "/v1/chat/completions",
      payload: { model: "gpt-4o", messages: [] },
    });

    expect(res.statusCode).toBe(401);
  });

  it("returns 503 when the router exhausts all deployments", async () => {
    const hash = createHash("sha256").update("sk-test").digest("hex");
    const db = fakeDb({ id: "key-1", keyHash: hash, isActive: true });
    const router = { execute: vi.fn().mockRejectedValue(new AllDeploymentsExhaustedError("gpt-4o")) };
    const app = Fastify();
    registerChatCompletionsRoute(app, { db, router, pluginRegistry: fakePluginRegistry() });

    const res = await app.inject({
      method: "POST",
      url: "/v1/chat/completions",
      headers: { authorization: "Bearer sk-test" },
      payload: { model: "gpt-4o", messages: [{ role: "user", content: "hi" }] },
    });

    expect(res.statusCode).toBe(503);
    expect(db.requestLog.create).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ apiKeyId: "key-1", status: 503 }) }),
    );
  });

  it("returns the provider's response on success and logs the request", async () => {
    const hash = createHash("sha256").update("sk-test").digest("hex");
    const db = fakeDb({ id: "key-1", keyHash: hash, isActive: true });
    const successResponse = {
      id: "ok",
      object: "chat.completion",
      model: "gpt-4o",
      choices: [{ index: 0, message: { role: "assistant", content: "hi" }, finish_reason: "stop" }],
      usage: { prompt_tokens: 1, completion_tokens: 1, total_tokens: 2 },
    };
    const router = { execute: vi.fn().mockResolvedValue(successResponse) };
    const app = Fastify();
    registerChatCompletionsRoute(app, { db, router, pluginRegistry: fakePluginRegistry() });

    const res = await app.inject({
      method: "POST",
      url: "/v1/chat/completions",
      headers: { authorization: "Bearer sk-test" },
      payload: { model: "gpt-4o", messages: [{ role: "user", content: "hi" }] },
    });

    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual(successResponse);
    expect(db.requestLog.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          apiKeyId: "key-1",
          modelName: "gpt-4o",
          inputTokens: 1,
          outputTokens: 1,
          status: 200,
        }),
      }),
    );
  });

  it("returns 404 when the model is unknown", async () => {
    const hash = createHash("sha256").update("sk-test").digest("hex");
    const db = fakeDb({ id: "key-1", keyHash: hash, isActive: true });
    const router = { execute: vi.fn().mockRejectedValue(new ModelNotFoundError("no-such-model")) };
    const app = Fastify();
    registerChatCompletionsRoute(app, { db, router, pluginRegistry: fakePluginRegistry() });

    const res = await app.inject({
      method: "POST",
      url: "/v1/chat/completions",
      headers: { authorization: "Bearer sk-test" },
      payload: { model: "no-such-model", messages: [{ role: "user", content: "hi" }] },
    });

    expect(res.statusCode).toBe(404);
  });

  it("streams SSE chunks and a [DONE] sentinel when stream: true", async () => {
    const hash = createHash("sha256").update("sk-test").digest("hex");
    const db = fakeDb({ id: "key-1", keyHash: hash, isActive: true });
    const chunks = [
      { id: "c1", object: "chat.completion.chunk", model: "gpt-4o", choices: [{ index: 0, delta: { content: "a" }, finish_reason: null }] },
      { id: "c2", object: "chat.completion.chunk", model: "gpt-4o", choices: [{ index: 0, delta: { content: "b" }, finish_reason: "stop" }] },
    ];
    const router = {
      execute: vi.fn(),
      executeStream: vi.fn(async function* () {
        for (const c of chunks) {yield c;}
      }),
    };
    const app = Fastify();
    registerChatCompletionsRoute(app, { db, router, pluginRegistry: fakePluginRegistry() });

    const res = await app.inject({
      method: "POST",
      url: "/v1/chat/completions",
      headers: { authorization: "Bearer sk-test" },
      payload: { model: "gpt-4o", messages: [{ role: "user", content: "hi" }], stream: true },
    });

    expect(res.statusCode).toBe(200);
    expect(res.headers["content-type"]).toContain("text/event-stream");
    expect(res.body).toBe(
      `data: ${JSON.stringify(chunks[0])}\n\ndata: ${JSON.stringify(chunks[1])}\n\ndata: [DONE]\n\n`,
    );
    expect(db.requestLog.create).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ apiKeyId: "key-1", status: 200 }) }),
    );
  });

  it("falls back to a JSON error response when the stream fails before its first chunk", async () => {
    const hash = createHash("sha256").update("sk-test").digest("hex");
    const db = fakeDb({ id: "key-1", keyHash: hash, isActive: true });
    const router = {
      execute: vi.fn(),
      executeStream: vi.fn(async function* () {
        throw new AllDeploymentsExhaustedError("gpt-4o");
      }),
    };
    const app = Fastify();
    registerChatCompletionsRoute(app, { db, router, pluginRegistry: fakePluginRegistry() });

    const res = await app.inject({
      method: "POST",
      url: "/v1/chat/completions",
      headers: { authorization: "Bearer sk-test" },
      payload: { model: "gpt-4o", messages: [{ role: "user", content: "hi" }], stream: true },
    });

    expect(res.statusCode).toBe(503);
    expect(res.headers["content-type"]).not.toContain("text/event-stream");
  });

  it("returns a cached response without calling the router", async () => {
    const hash = createHash("sha256").update("sk-test").digest("hex");
    const db = fakeDb({ id: "key-1", keyHash: hash, isActive: true });
    const cachedResponse = {
      id: "cached",
      object: "chat.completion",
      model: "gpt-4o",
      choices: [{ index: 0, message: { role: "assistant", content: "cached" }, finish_reason: "stop" }],
      usage: { prompt_tokens: 1, completion_tokens: 1, total_tokens: 2 },
    };
    const cache: ResponseCache = {
      get: vi.fn().mockResolvedValue(cachedResponse),
      set: vi.fn(),
    };
    const router = { execute: vi.fn() };
    const app = Fastify();
    registerChatCompletionsRoute(app, { db, router, cache, pluginRegistry: fakePluginRegistry() });

    const res = await app.inject({
      method: "POST",
      url: "/v1/chat/completions",
      headers: { authorization: "Bearer sk-test" },
      payload: { model: "gpt-4o", messages: [{ role: "user", content: "hi" }] },
    });

    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual(cachedResponse);
    expect(router.execute).not.toHaveBeenCalled();
    expect(cache.set).not.toHaveBeenCalled();
  });

  it("stores the response in the cache on a miss", async () => {
    const hash = createHash("sha256").update("sk-test").digest("hex");
    const db = fakeDb({ id: "key-1", keyHash: hash, isActive: true });
    const successResponse = {
      id: "ok",
      object: "chat.completion",
      model: "gpt-4o",
      choices: [{ index: 0, message: { role: "assistant", content: "hi" }, finish_reason: "stop" }],
      usage: { prompt_tokens: 1, completion_tokens: 1, total_tokens: 2 },
    };
    const cache: ResponseCache = {
      get: vi.fn().mockResolvedValue(undefined),
      set: vi.fn().mockResolvedValue(undefined),
    };
    const router = { execute: vi.fn().mockResolvedValue(successResponse) };
    const app = Fastify();
    registerChatCompletionsRoute(app, { db, router, cache, pluginRegistry: fakePluginRegistry() });

    const res = await app.inject({
      method: "POST",
      url: "/v1/chat/completions",
      headers: { authorization: "Bearer sk-test" },
      payload: { model: "gpt-4o", messages: [{ role: "user", content: "hi" }] },
    });

    expect(res.statusCode).toBe(200);
    expect(router.execute).toHaveBeenCalledTimes(1);
    expect(cache.set).toHaveBeenCalledTimes(1);
  });

  it("returns 429 when the rate limiter rejects the request", async () => {
    const hash = createHash("sha256").update("sk-test").digest("hex");
    const db = fakeDb({ id: "key-1", keyHash: hash, isActive: true });
    const rateLimiter: RateLimiter = {
      checkAndRecord: vi.fn().mockRejectedValue(new RateLimitError("rate_limit_exceeded")),
      checkTokens: vi.fn().mockResolvedValue(undefined),
      recordTokens: vi.fn().mockResolvedValue(undefined),
    };
    const app = Fastify();
    registerChatCompletionsRoute(app, { db, router: { execute: vi.fn() }, rateLimiter, pluginRegistry: fakePluginRegistry() });

    const res = await app.inject({
      method: "POST",
      url: "/v1/chat/completions",
      headers: { authorization: "Bearer sk-test" },
      payload: { model: "gpt-4o", messages: [{ role: "user", content: "hi" }] },
    });

    expect(res.statusCode).toBe(429);
    expect(db.requestLog.create).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ apiKeyId: "key-1", status: 429 }) }),
    );
  });

  it("returns 429 when the tpm check fails", async () => {
    const hash = createHash("sha256").update("sk-test").digest("hex");
    const db = fakeDb({ id: "key-1", keyHash: hash, isActive: true, tpmLimit: 10 });
    const rateLimiter: RateLimiter = {
      checkAndRecord: vi.fn().mockResolvedValue(undefined),
      checkTokens: vi.fn().mockRejectedValue(new RateLimitError("token_rate_limit_exceeded")),
      recordTokens: vi.fn().mockResolvedValue(undefined),
    };
    const app = Fastify();
    registerChatCompletionsRoute(app, { db, router: { execute: vi.fn() }, rateLimiter, pluginRegistry: fakePluginRegistry() });

    const res = await app.inject({
      method: "POST",
      url: "/v1/chat/completions",
      headers: { authorization: "Bearer sk-test" },
      payload: { model: "gpt-4o", messages: [{ role: "user", content: "hi" }] },
    });

    expect(res.statusCode).toBe(429);
  });

  it("returns 403 when the budget checker rejects the request", async () => {
    const hash = createHash("sha256").update("sk-test").digest("hex");
    const db = fakeDb({ id: "key-1", keyHash: hash, isActive: true, budgetLimit: new Decimal(1) });
    const budgetChecker: BudgetChecker = {
      checkAndSpend: vi.fn().mockRejectedValue(new BudgetExceededError("budget_exceeded")),
    };
    const router = {
      execute: vi.fn().mockResolvedValue({
        id: "ok",
        object: "chat.completion",
        model: "gpt-4o",
        choices: [],
        usage: { prompt_tokens: 10, completion_tokens: 5, total_tokens: 15 },
      }),
    };
    const app = Fastify();
    registerChatCompletionsRoute(app, { db, router, budgetChecker, pluginRegistry: fakePluginRegistry() });

    const res = await app.inject({
      method: "POST",
      url: "/v1/chat/completions",
      headers: { authorization: "Bearer sk-test" },
      payload: { model: "gpt-4o", messages: [{ role: "user", content: "hi" }] },
    });

    expect(res.statusCode).toBe(403);
  });

  it("returns 403 when the model is not in the key's allowed list", async () => {
    const hash = createHash("sha256").update("sk-test").digest("hex");
    const db = fakeDb({ id: "key-1", keyHash: hash, isActive: true, allowedModels: ["gpt-3.5-turbo"] });
    const app = Fastify();
    registerChatCompletionsRoute(app, { db, router: { execute: vi.fn() }, pluginRegistry: fakePluginRegistry() });

    const res = await app.inject({
      method: "POST",
      url: "/v1/chat/completions",
      headers: { authorization: "Bearer sk-test" },
      payload: { model: "gpt-4o", messages: [{ role: "user", content: "hi" }] },
    });

    expect(res.statusCode).toBe(403);
  });

  it("short-circuits when a middleware plugin returns a response", async () => {
    const hash = createHash("sha256").update("sk-test").digest("hex");
    const db = fakeDb({ id: "key-1", keyHash: hash, isActive: true });
    const registry = createPluginRegistry();
    registry.registerMiddleware({
      name: "blocker",
      onRequest: async () => ({ status: 418, body: { error: "i'm a teapot" } }),
    });
    const router = { execute: vi.fn() };
    const app = Fastify();
    registerChatCompletionsRoute(app, { db, router, pluginRegistry: registry });

    const res = await app.inject({
      method: "POST",
      url: "/v1/chat/completions",
      headers: { authorization: "Bearer sk-test" },
      payload: { model: "gpt-4o", messages: [{ role: "user", content: "hi" }] },
    });

    expect(res.statusCode).toBe(418);
    expect(router.execute).not.toHaveBeenCalled();
  });

  it("applies onResponse middleware transformations to the returned body", async () => {
    const hash = createHash("sha256").update("sk-test").digest("hex");
    const db = fakeDb({ id: "key-1", keyHash: hash, isActive: true });
    const registry = createPluginRegistry();
    registry.registerMiddleware({
      name: "annotator",
      onResponse: async (_ctx, response) => ({
        status: response.status,
        body: { ...(response.body as object), annotated: true },
      }),
    });
    const router = {
      execute: vi.fn().mockResolvedValue({
        id: "ok",
        object: "chat.completion",
        model: "gpt-4o",
        choices: [],
        usage: { prompt_tokens: 1, completion_tokens: 1, total_tokens: 2 },
      }),
    };
    const app = Fastify();
    registerChatCompletionsRoute(app, { db, router, pluginRegistry: registry });

    const res = await app.inject({
      method: "POST",
      url: "/v1/chat/completions",
      headers: { authorization: "Bearer sk-test" },
      payload: { model: "gpt-4o", messages: [{ role: "user", content: "hi" }] },
    });

    expect(res.statusCode).toBe(200);
    expect(res.json()).toMatchObject({ annotated: true });
  });

  it("records cacheHit: true and stream: false on a cache hit", async () => {
    const hash = createHash("sha256").update("sk-test").digest("hex");
    const db = fakeDb({ id: "key-1", keyHash: hash, isActive: true });
    const cachedResponse = {
      id: "cached",
      object: "chat.completion",
      model: "gpt-4o",
      choices: [{ index: 0, message: { role: "assistant", content: "cached" }, finish_reason: "stop" }],
      usage: { prompt_tokens: 1, completion_tokens: 1, total_tokens: 2 },
    };
    const cache: ResponseCache = {
      get: vi.fn().mockResolvedValue(cachedResponse),
      set: vi.fn(),
    };
    const router = { execute: vi.fn() };
    const app = Fastify();
    registerChatCompletionsRoute(app, { db, router, cache, pluginRegistry: fakePluginRegistry() });

    const res = await app.inject({
      method: "POST",
      url: "/v1/chat/completions",
      headers: { authorization: "Bearer sk-test" },
      payload: { model: "gpt-4o", messages: [{ role: "user", content: "hi" }] },
    });

    expect(res.statusCode).toBe(200);
    expect(db.requestLog.create).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ cacheHit: true, stream: false }) }),
    );
  });

  it("records cacheHit: false and stream: true on a streaming response", async () => {
    const hash = createHash("sha256").update("sk-test").digest("hex");
    const db = fakeDb({ id: "key-1", keyHash: hash, isActive: true });
    const chunks = [
      { id: "c1", object: "chat.completion.chunk", model: "gpt-4o", choices: [{ index: 0, delta: { content: "a" }, finish_reason: "stop" }] },
    ];
    const router = {
      execute: vi.fn(),
      executeStream: vi.fn(async function* () {
        for (const c of chunks) {yield c;}
      }),
    };
    const app = Fastify();
    registerChatCompletionsRoute(app, { db, router, pluginRegistry: fakePluginRegistry() });

    const res = await app.inject({
      method: "POST",
      url: "/v1/chat/completions",
      headers: { authorization: "Bearer sk-test" },
      payload: { model: "gpt-4o", messages: [{ role: "user", content: "hi" }], stream: true },
    });

    expect(res.statusCode).toBe(200);
    expect(db.requestLog.create).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ cacheHit: false, stream: true }) }),
    );
  });

  it("records cacheHit: false and stream: false on a non-streaming, non-cached response", async () => {
    const hash = createHash("sha256").update("sk-test").digest("hex");
    const db = fakeDb({ id: "key-1", keyHash: hash, isActive: true });
    const successResponse = {
      id: "ok",
      object: "chat.completion",
      model: "gpt-4o",
      choices: [{ index: 0, message: { role: "assistant", content: "hi" }, finish_reason: "stop" }],
      usage: { prompt_tokens: 1, completion_tokens: 1, total_tokens: 2 },
    };
    const router = { execute: vi.fn().mockResolvedValue(successResponse) };
    const app = Fastify();
    registerChatCompletionsRoute(app, { db, router, pluginRegistry: fakePluginRegistry() });

    const res = await app.inject({
      method: "POST",
      url: "/v1/chat/completions",
      headers: { authorization: "Bearer sk-test" },
      payload: { model: "gpt-4o", messages: [{ role: "user", content: "hi" }] },
    });

    expect(res.statusCode).toBe(200);
    expect(db.requestLog.create).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ cacheHit: false, stream: false }) }),
    );
  });
});
