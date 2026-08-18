import { describe, it, expect, vi } from "vitest";
import { createHash } from "node:crypto";
import Fastify from "fastify";
import { registerAdminOverviewRoute } from "../../../src/routes/admin/overview";

function adminToken() {
  return createHash("sha256").update("sk-admin").digest("hex");
}

function fakeDb(opts: {
  logs?: any[];
  apiKeys?: any[];
  teams?: any[];
  deployments?: { id: string }[];
}) {
  return {
    apiKey: {
      findUnique: vi.fn().mockResolvedValue({ id: "key-1", keyHash: adminToken(), isActive: true, isAdmin: true }),
      findMany: vi.fn().mockResolvedValue(opts.apiKeys ?? []),
    },
    team: {
      findMany: vi.fn().mockResolvedValue(opts.teams ?? []),
    },
    deployment: {
      findMany: vi.fn().mockResolvedValue(opts.deployments ?? []),
    },
    requestLog: {
      findMany: vi.fn().mockResolvedValue(opts.logs ?? []),
    },
  } as any;
}

function fakeRedis(cooldownIds: string[] = []) {
  return {
    get: vi.fn().mockImplementation((key: string) => {
      const id = key.replace("deployment:cooldown:", "");
      return Promise.resolve(cooldownIds.includes(id) ? "1" : null);
    }),
    set: vi.fn(),
    incr: vi.fn(),
  };
}

describe("GET /admin/overview", () => {
  it("returns 401 without a bearer token", async () => {
    const app = Fastify();
    registerAdminOverviewRoute(app, { db: fakeDb({}), redis: fakeRedis() });

    const res = await app.inject({ method: "GET", url: "/admin/overview" });
    expect(res.statusCode).toBe(401);
  });

  it("returns zeroed aggregates for an empty window", async () => {
    const app = Fastify();
    registerAdminOverviewRoute(app, { db: fakeDb({}), redis: fakeRedis() });

    const res = await app.inject({ method: "GET", url: "/admin/overview", headers: { authorization: "Bearer sk-admin" } });

    expect(res.statusCode).toBe(200);
    expect(res.json()).toMatchObject({
      requestCount: 0,
      errorRate: 0,
      p50LatencyMs: 0,
      p95LatencyMs: 0,
      cacheHitRate: 0,
      topModels: [],
      topTeams: [],
      unhealthyDeploymentIds: [],
      budgetPressure: [],
      rateLimitPressure: null,
    });
  });

  it("computes error rate, latency percentiles, and cache hit rate", async () => {
    const logs = [
      { modelName: "gpt-4o", apiKeyId: "key-a", status: 200, latencyMs: 100, inputTokens: 10, outputTokens: 5, cacheHit: true, stream: false },
      { modelName: "gpt-4o", apiKeyId: "key-a", status: 200, latencyMs: 200, inputTokens: 10, outputTokens: 5, cacheHit: false, stream: false },
      { modelName: "gpt-4o", apiKeyId: "key-a", status: 500, latencyMs: 300, inputTokens: 10, outputTokens: 0, cacheHit: false, stream: false },
      { modelName: "gpt-4o", apiKeyId: "key-a", status: 200, latencyMs: 50, inputTokens: 10, outputTokens: 5, cacheHit: false, stream: true },
    ];
    const app = Fastify();
    registerAdminOverviewRoute(app, { db: fakeDb({ logs }), redis: fakeRedis() });

    const res = await app.inject({ method: "GET", url: "/admin/overview", headers: { authorization: "Bearer sk-admin" } });
    const body = res.json();

    expect(body.requestCount).toBe(4);
    expect(body.errorRate).toBe(0.25);
    // cacheHitRate is over the 3 non-streaming requests only: 1 hit / 3 = 0.333...
    expect(body.cacheHitRate).toBeCloseTo(1 / 3, 5);
    expect(body.topModels).toEqual([{ key: "gpt-4o", label: "gpt-4o", requestCount: 4 }]);
  });

  it("lists unhealthy deployments from the cooldown helper", async () => {
    const app = Fastify();
    registerAdminOverviewRoute(app, {
      db: fakeDb({ deployments: [{ id: "dep-1" }, { id: "dep-2" }] }),
      redis: fakeRedis(["dep-2"]),
    });

    const res = await app.inject({ method: "GET", url: "/admin/overview", headers: { authorization: "Bearer sk-admin" } });
    expect(res.json().unhealthyDeploymentIds).toEqual(["dep-2"]);
  });

  it("flags budget pressure at 80% or more of a key's budget", async () => {
    const app = Fastify();
    registerAdminOverviewRoute(app, {
      db: fakeDb({
        apiKeys: [{ id: "key-1", name: "prod-key", budgetLimit: "100", spent: "85" }],
      }),
      redis: fakeRedis(),
    });

    const res = await app.inject({ method: "GET", url: "/admin/overview", headers: { authorization: "Bearer sk-admin" } });
    expect(res.json().budgetPressure).toEqual([
      { scope: "key", id: "key-1", label: "prod-key", spent: "85", budgetLimit: "100" },
    ]);
  });
});
