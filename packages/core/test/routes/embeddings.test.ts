import { describe, it, expect, vi } from "vitest";
import { createHash } from "node:crypto";
import Fastify from "fastify";
import { registerEmbeddingsRoute } from "../../src/routes/embeddings";
import { AllDeploymentsExhaustedError } from "../../src/router/router";
import { BudgetExceededError, ModelAccessDeniedError, ModelNotFoundError, RateLimitError } from "../../src/errors";
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

const successResponse = {
  object: "list" as const,
  data: [{ object: "embedding" as const, embedding: [0.1, 0.2, 0.3], index: 0 }],
  model: "text-embedding-3-small",
  usage: { prompt_tokens: 2, total_tokens: 2 },
};

describe("POST /v1/embeddings", () => {
  it("returns 401 when no bearer token is provided", async () => {
    const app = Fastify();
    registerEmbeddingsRoute(app, { db: fakeDb(undefined), router: { executeEmbeddings: vi.fn() } as any, pluginRegistry: fakePluginRegistry() });

    const res = await app.inject({
      method: "POST",
      url: "/v1/embeddings",
      payload: { model: "text-embedding-3-small", input: "hello" },
    });

    expect(res.statusCode).toBe(401);
  });

  it("returns 503 when the router exhausts all deployments", async () => {
    const hash = createHash("sha256").update("sk-test").digest("hex");
    const db = fakeDb({ id: "key-1", keyHash: hash, isActive: true });
    const router = { executeEmbeddings: vi.fn().mockRejectedValue(new AllDeploymentsExhaustedError("text-embedding-3-small")) };
    const app = Fastify();
    registerEmbeddingsRoute(app, { db, router: router as any, pluginRegistry: fakePluginRegistry() });

    const res = await app.inject({
      method: "POST",
      url: "/v1/embeddings",
      headers: { authorization: "Bearer sk-test" },
      payload: { model: "text-embedding-3-small", input: "hello" },
    });

    expect(res.statusCode).toBe(503);
    expect(db.requestLog.create).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ apiKeyId: "key-1", status: 503 }) }),
    );
  });

  it("returns the provider's response on success and logs the request", async () => {
    const hash = createHash("sha256").update("sk-test").digest("hex");
    const db = fakeDb({ id: "key-1", keyHash: hash, isActive: true });
    const router = { executeEmbeddings: vi.fn().mockResolvedValue(successResponse) };
    const app = Fastify();
    registerEmbeddingsRoute(app, { db, router: router as any, pluginRegistry: fakePluginRegistry() });

    const res = await app.inject({
      method: "POST",
      url: "/v1/embeddings",
      headers: { authorization: "Bearer sk-test" },
      payload: { model: "text-embedding-3-small", input: "hello" },
    });

    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual(successResponse);
    expect(db.requestLog.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          apiKeyId: "key-1",
          modelName: "text-embedding-3-small",
          inputTokens: 2,
          outputTokens: 0,
          status: 200,
        }),
      }),
    );
  });

  it("records cacheHit: false and stream: false on every log write", async () => {
    const hash = createHash("sha256").update("sk-test").digest("hex");
    const db = fakeDb({ id: "key-1", keyHash: hash, isActive: true });
    const router = { executeEmbeddings: vi.fn().mockResolvedValue(successResponse) };
    const app = Fastify();
    registerEmbeddingsRoute(app, { db, router: router as any, pluginRegistry: fakePluginRegistry() });

    const res = await app.inject({
      method: "POST",
      url: "/v1/embeddings",
      headers: { authorization: "Bearer sk-test" },
      payload: { model: "text-embedding-3-small", input: "hello" },
    });

    expect(res.statusCode).toBe(200);
    expect(db.requestLog.create).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ cacheHit: false, stream: false }) }),
    );
  });

  it("returns 404 when the model is unknown", async () => {
    const hash = createHash("sha256").update("sk-test").digest("hex");
    const db = fakeDb({ id: "key-1", keyHash: hash, isActive: true });
    const router = { executeEmbeddings: vi.fn().mockRejectedValue(new ModelNotFoundError("no-such-model")) };
    const app = Fastify();
    registerEmbeddingsRoute(app, { db, router: router as any, pluginRegistry: fakePluginRegistry() });

    const res = await app.inject({
      method: "POST",
      url: "/v1/embeddings",
      headers: { authorization: "Bearer sk-test" },
      payload: { model: "no-such-model", input: "hello" },
    });

    expect(res.statusCode).toBe(404);
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
    registerEmbeddingsRoute(app, { db, router: { executeEmbeddings: vi.fn() } as any, rateLimiter, pluginRegistry: fakePluginRegistry() });

    const res = await app.inject({
      method: "POST",
      url: "/v1/embeddings",
      headers: { authorization: "Bearer sk-test" },
      payload: { model: "text-embedding-3-small", input: "hello" },
    });

    expect(res.statusCode).toBe(429);
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
    registerEmbeddingsRoute(app, { db, router: { executeEmbeddings: vi.fn() } as any, rateLimiter, pluginRegistry: fakePluginRegistry() });

    const res = await app.inject({
      method: "POST",
      url: "/v1/embeddings",
      headers: { authorization: "Bearer sk-test" },
      payload: { model: "text-embedding-3-small", input: "hello" },
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
      executeEmbeddings: vi.fn().mockResolvedValue(successResponse),
    };
    const app = Fastify();
    registerEmbeddingsRoute(app, { db, router: router as any, budgetChecker, pluginRegistry: fakePluginRegistry() });

    const res = await app.inject({
      method: "POST",
      url: "/v1/embeddings",
      headers: { authorization: "Bearer sk-test" },
      payload: { model: "text-embedding-3-small", input: "hello" },
    });

    expect(res.statusCode).toBe(403);
  });

  it("returns 403 when the model is not in the key's allowed list", async () => {
    const hash = createHash("sha256").update("sk-test").digest("hex");
    const db = fakeDb({ id: "key-1", keyHash: hash, isActive: true, allowedModels: ["text-embedding-ada-002"] });
    const app = Fastify();
    registerEmbeddingsRoute(app, { db, router: { executeEmbeddings: vi.fn() } as any, pluginRegistry: fakePluginRegistry() });

    const res = await app.inject({
      method: "POST",
      url: "/v1/embeddings",
      headers: { authorization: "Bearer sk-test" },
      payload: { model: "text-embedding-3-small", input: "hello" },
    });

    expect(res.statusCode).toBe(403);
  });

  it("supports batched input as an array of strings", async () => {
    const hash = createHash("sha256").update("sk-test").digest("hex");
    const db = fakeDb({ id: "key-1", keyHash: hash, isActive: true });
    const batchedResponse = {
      object: "list" as const,
      data: [
        { object: "embedding" as const, embedding: [0.1], index: 0 },
        { object: "embedding" as const, embedding: [0.2], index: 1 },
      ],
      model: "text-embedding-3-small",
      usage: { prompt_tokens: 4, total_tokens: 4 },
    };
    const router = { executeEmbeddings: vi.fn().mockResolvedValue(batchedResponse) };
    const app = Fastify();
    registerEmbeddingsRoute(app, { db, router: router as any, pluginRegistry: fakePluginRegistry() });

    const res = await app.inject({
      method: "POST",
      url: "/v1/embeddings",
      headers: { authorization: "Bearer sk-test" },
      payload: { model: "text-embedding-3-small", input: ["hello", "world"] },
    });

    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual(batchedResponse);
  });

  it("short-circuits when a middleware plugin returns a response", async () => {
    const hash = createHash("sha256").update("sk-test").digest("hex");
    const db = fakeDb({ id: "key-1", keyHash: hash, isActive: true });
    const registry = createPluginRegistry();
    registry.registerMiddleware({
      name: "blocker",
      onRequest: async () => ({ status: 418, body: { error: "i'm a teapot" } }),
    });
    const router = { executeEmbeddings: vi.fn() };
    const app = Fastify();
    registerEmbeddingsRoute(app, { db, router: router as any, pluginRegistry: registry });

    const res = await app.inject({
      method: "POST",
      url: "/v1/embeddings",
      headers: { authorization: "Bearer sk-test" },
      payload: { model: "text-embedding-3-small", input: "hello" },
    });

    expect(res.statusCode).toBe(418);
    expect(router.executeEmbeddings).not.toHaveBeenCalled();
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
    const router = { executeEmbeddings: vi.fn().mockResolvedValue(successResponse) };
    const app = Fastify();
    registerEmbeddingsRoute(app, { db, router: router as any, pluginRegistry: registry });

    const res = await app.inject({
      method: "POST",
      url: "/v1/embeddings",
      headers: { authorization: "Bearer sk-test" },
      payload: { model: "text-embedding-3-small", input: "hello" },
    });

    expect(res.statusCode).toBe(200);
    expect(res.json()).toMatchObject({ annotated: true });
  });
});
