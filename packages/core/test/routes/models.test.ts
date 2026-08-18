import { describe, it, expect, vi } from "vitest";
import { createHash } from "node:crypto";
import Fastify from "fastify";
import { registerModelsRoute } from "../../src/routes/models";
import type { Provider } from "../../src/types/provider";

function fakeDb(deployments: { modelName: string; provider: string; isActive: boolean }[], apiKey?: { id: string; keyHash: string; isActive: boolean }) {
  return {
    apiKey: {
      findUnique: vi.fn().mockResolvedValue(apiKey ?? null),
    },
    deployment: {
      findMany: vi.fn().mockImplementation((query) => {
        let result = deployments;
        if (query?.where?.isActive !== undefined) {
          result = result.filter((d) => d.isActive === query.where.isActive);
        }
        if (query?.where?.provider?.in !== undefined) {
          result = result.filter((d) => (query.where.provider.in as string[]).includes(d.provider));
        }
        return Promise.resolve(result);
      }),
    },
  } as any;
}

function fakeProvider(): Provider {
  return {
    chatCompletion: vi.fn(),
    chatCompletionStream: vi.fn(),
  };
}

describe("GET /v1/models", () => {
  it("returns 401 when no bearer token is provided", async () => {
    const app = Fastify();
    registerModelsRoute(app, { db: fakeDb([]), providers: new Map() });

    const res = await app.inject({ method: "GET", url: "/v1/models" });

    expect(res.statusCode).toBe(401);
  });

  it("returns 401 for an invalid bearer token", async () => {
    const app = Fastify();
    registerModelsRoute(app, { db: fakeDb([]), providers: new Map() });

    const res = await app.inject({
      method: "GET",
      url: "/v1/models",
      headers: { authorization: "Bearer invalid" },
    });

    expect(res.statusCode).toBe(401);
  });

  it("returns active models in OpenAI list shape", async () => {
    const hash = createHash("sha256").update("sk-test").digest("hex");
    const db = fakeDb(
      [
        { modelName: "gpt-4o", provider: "openai", isActive: true },
        { modelName: "claude-sonnet-4-5", provider: "anthropic", isActive: true },
      ],
      { id: "key-1", keyHash: hash, isActive: true },
    );
    const app = Fastify();
    const providers = new Map<string, Provider>([
      ["openai", fakeProvider()],
      ["anthropic", fakeProvider()],
    ]);
    registerModelsRoute(app, { db, providers });

    const res = await app.inject({
      method: "GET",
      url: "/v1/models",
      headers: { authorization: "Bearer sk-test" },
    });

    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.object).toBe("list");
    expect(body.data).toEqual([
      { id: "gpt-4o", object: "model", created: 0, owned_by: "ai-gateway" },
      { id: "claude-sonnet-4-5", object: "model", created: 0, owned_by: "ai-gateway" },
    ]);
    expect(db.deployment.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          isActive: true,
          provider: { in: ["openai", "anthropic"] },
        },
        select: { modelName: true },
        distinct: ["modelName"],
      }),
    );
  });

  it("excludes inactive models", async () => {
    const hash = createHash("sha256").update("sk-test").digest("hex");
    const db = fakeDb(
      [
        { modelName: "gpt-4o", provider: "openai", isActive: true },
        { modelName: "deprecated-model", provider: "openai", isActive: false },
      ],
      { id: "key-1", keyHash: hash, isActive: true },
    );
    const app = Fastify();
    const providers = new Map<string, Provider>([["openai", fakeProvider()]]);
    registerModelsRoute(app, { db, providers });

    const res = await app.inject({
      method: "GET",
      url: "/v1/models",
      headers: { authorization: "Bearer sk-test" },
    });

    expect(res.statusCode).toBe(200);
    const ids = res.json().data.map((m: { id: string }) => m.id);
    expect(ids).toContain("gpt-4o");
    expect(ids).not.toContain("deprecated-model");
  });

  it("excludes models from providers without configured credentials", async () => {
    const hash = createHash("sha256").update("sk-test").digest("hex");
    const db = fakeDb(
      [
        { modelName: "gpt-4o", provider: "openai", isActive: true },
        { modelName: "claude-opus", provider: "anthropic", isActive: true },
      ],
      { id: "key-1", keyHash: hash, isActive: true },
    );
    const app = Fastify();
    const providers = new Map<string, Provider>([["openai", fakeProvider()]]);
    registerModelsRoute(app, { db, providers });

    const res = await app.inject({
      method: "GET",
      url: "/v1/models",
      headers: { authorization: "Bearer sk-test" },
    });

    expect(res.statusCode).toBe(200);
    const ids = res.json().data.map((m: { id: string }) => m.id);
    expect(ids).toContain("gpt-4o");
    expect(ids).not.toContain("claude-opus");
  });
});
