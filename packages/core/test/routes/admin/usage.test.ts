import { describe, it, expect, vi } from "vitest";
import { createHash } from "node:crypto";
import Fastify from "fastify";
import { registerAdminUsageRoute } from "../../../src/routes/admin/usage";

function adminToken() {
  return createHash("sha256").update("sk-admin").digest("hex");
}

function fakeDb(seed: {
  apiKey?: { id: string; keyHash: string; isActive: boolean; isAdmin?: boolean };
  logs?: any[];
  pricing?: any[];
} = {}) {
  return {
    apiKey: {
      findUnique: vi.fn().mockResolvedValue(seed.apiKey ?? null),
      findMany: vi.fn().mockImplementation((args: { where: { id: { in: string[] } } }) => {
        const ids = args?.where?.id?.in ?? [];
        const keys = (seed.logs ?? [])
          .map((log) => log.apiKey)
          .filter(Boolean)
          .filter((key: any, index: number, self: any[]) => index === self.findIndex((k) => k.id === key.id));
        return Promise.resolve(keys.filter((key: any) => ids.includes(key.id)));
      }),
    },
    requestLog: {
      findMany: vi.fn().mockResolvedValue(seed.logs ?? []),
    },
    modelPricing: {
      findMany: vi.fn().mockResolvedValue(seed.pricing ?? []),
    },
  } as any;
}

function logEntry(overrides: Partial<{
  id: string;
  apiKeyId: string;
  modelName: string;
  inputTokens: number;
  outputTokens: number;
  createdAt: Date;
  apiKey: any;
}> = {}) {
  return {
    id: "log-1",
    apiKeyId: "key-1",
    modelName: "gpt-4o",
    deploymentId: null,
    latencyMs: 100,
    inputTokens: 1,
    outputTokens: 1,
    status: 200,
    createdAt: new Date("2026-08-01T12:00:00Z"),
    apiKey: {
      id: "key-1",
      name: "CI key",
      keyPrefix: "ak-abc12",
      teamId: "team-1",
      team: { id: "team-1", name: "Engineering" },
    },
    ...overrides,
  };
}

describe("GET /admin/usage", () => {
  it("returns 401 without a bearer token", async () => {
    const app = Fastify();
    registerAdminUsageRoute(app, { db: fakeDb() });

    const res = await app.inject({ method: "GET", url: "/admin/usage?groupBy=key" });

    expect(res.statusCode).toBe(401);
  });

  it("returns 403 for a valid non-admin key", async () => {
    const db = fakeDb({ apiKey: { id: "key-1", keyHash: adminToken(), isActive: true } });
    const app = Fastify();
    registerAdminUsageRoute(app, { db });

    const res = await app.inject({
      method: "GET",
      url: "/admin/usage?groupBy=key",
      headers: { authorization: "Bearer sk-admin" },
    });

    expect(res.statusCode).toBe(403);
  });

  it("returns 400 for an invalid groupBy", async () => {
    const db = fakeDb({ apiKey: { id: "key-1", keyHash: adminToken(), isActive: true, isAdmin: true } });
    const app = Fastify();
    registerAdminUsageRoute(app, { db });

    const res = await app.inject({
      method: "GET",
      url: "/admin/usage?groupBy=invalid",
      headers: { authorization: "Bearer sk-admin" },
    });

    expect(res.statusCode).toBe(400);
  });

  it("aggregates usage by api key and calculates cost", async () => {
    const db = fakeDb({
      apiKey: { id: "key-1", keyHash: adminToken(), isActive: true, isAdmin: true },
      logs: [
        logEntry({ id: "log-1", apiKeyId: "key-1", inputTokens: 10, outputTokens: 5 }),
        logEntry({ id: "log-2", apiKeyId: "key-2", inputTokens: 3, outputTokens: 2, apiKey: { id: "key-2", name: "Prod key", keyPrefix: "ak-prod", teamId: "team-1", team: { id: "team-1", name: "Engineering" } } }),
      ],
      pricing: [{ modelName: "gpt-4o", inputTokenPrice: 0.000005, outputTokenPrice: 0.000015 }],
    });
    const app = Fastify();
    registerAdminUsageRoute(app, { db });

    const res = await app.inject({
      method: "GET",
      url: "/admin/usage?groupBy=key&start=2026-08-01T00:00:00Z&end=2026-08-02T00:00:00Z",
      headers: { authorization: "Bearer sk-admin" },
    });

    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.groupBy).toBe("key");
    expect(body.data).toHaveLength(2);

    const key1 = body.data.find((d: any) => d.groupValue === "key-1");
    expect(key1.requestCount).toBe(1);
    expect(key1.inputTokens).toBe(10);
    expect(key1.outputTokens).toBe(5);
    expect(key1.totalTokens).toBe(15);
    expect(key1.estimatedCost).toBe(10 * 0.000005 + 5 * 0.000015);
  });

  it("aggregates usage by team", async () => {
    const db = fakeDb({
      apiKey: { id: "key-1", keyHash: adminToken(), isActive: true, isAdmin: true },
      logs: [
        logEntry({ apiKeyId: "key-1", apiKey: { id: "key-1", name: "k1", keyPrefix: "ak-1", teamId: "team-1", team: { id: "team-1", name: "Engineering" } } }),
        logEntry({ apiKeyId: "key-2", apiKey: { id: "key-2", name: "k2", keyPrefix: "ak-2", teamId: "team-2", team: { id: "team-2", name: "Research" } } }),
      ],
      pricing: [],
    });
    const app = Fastify();
    registerAdminUsageRoute(app, { db });

    const res = await app.inject({
      method: "GET",
      url: "/admin/usage?groupBy=team&start=2026-08-01T00:00:00Z&end=2026-08-02T00:00:00Z",
      headers: { authorization: "Bearer sk-admin" },
    });

    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.data).toHaveLength(2);
    expect(body.data.map((d: any) => d.label).sort()).toEqual(["Engineering", "Research"]);
  });

  it("aggregates usage by model", async () => {
    const db = fakeDb({
      apiKey: { id: "key-1", keyHash: adminToken(), isActive: true, isAdmin: true },
      logs: [
        logEntry({ modelName: "gpt-4o" }),
        logEntry({ modelName: "claude-3-opus" }),
      ],
      pricing: [],
    });
    const app = Fastify();
    registerAdminUsageRoute(app, { db });

    const res = await app.inject({
      method: "GET",
      url: "/admin/usage?groupBy=model&start=2026-08-01T00:00:00Z&end=2026-08-02T00:00:00Z",
      headers: { authorization: "Bearer sk-admin" },
    });

    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.data).toHaveLength(2);
    expect(body.data.map((d: any) => d.groupValue).sort()).toEqual(["claude-3-opus", "gpt-4o"]);
  });
});

describe("GET /admin/usage/export", () => {
  it("returns a CSV export", async () => {
    const db = fakeDb({
      apiKey: { id: "key-1", keyHash: adminToken(), isActive: true, isAdmin: true },
      logs: [logEntry({ apiKeyId: "key-1", createdAt: new Date("2026-08-01T10:00:00Z"), inputTokens: 2, outputTokens: 1 })],
      pricing: [],
    });
    const app = Fastify();
    registerAdminUsageRoute(app, { db });

    const res = await app.inject({
      method: "GET",
      url: "/admin/usage/export?format=csv&start=2026-08-01T00:00:00Z&end=2026-08-02T00:00:00Z",
      headers: { authorization: "Bearer sk-admin" },
    });

    expect(res.statusCode).toBe(200);
    expect(res.headers["content-type"]).toContain("text/csv");
    expect(res.body).toContain('"apiKeyId"');
    expect(res.body).toContain('"modelName"');
    expect(res.body).toContain('"key-1"');
  });
});

describe("GET /admin/usage/keys/:id", () => {
  it("returns time-bucketed usage for a key", async () => {
    const db = fakeDb({
      apiKey: { id: "key-1", keyHash: adminToken(), isActive: true, isAdmin: true },
      logs: [
        logEntry({ apiKeyId: "key-1", createdAt: new Date("2026-08-01T10:00:00Z"), inputTokens: 2, outputTokens: 1 }),
        logEntry({ apiKeyId: "key-1", createdAt: new Date("2026-08-01T11:00:00Z"), inputTokens: 4, outputTokens: 2 }),
        logEntry({ apiKeyId: "key-1", createdAt: new Date("2026-08-02T10:00:00Z"), inputTokens: 1, outputTokens: 1 }),
      ],
      pricing: [{ modelName: "gpt-4o", inputTokenPrice: 0.000001, outputTokenPrice: 0.000002 }],
    });
    const app = Fastify();
    registerAdminUsageRoute(app, { db });

    const res = await app.inject({
      method: "GET",
      url: "/admin/usage/keys/key-1?start=2026-08-01T00:00:00Z&end=2026-08-03T00:00:00Z&bucket=day",
      headers: { authorization: "Bearer sk-admin" },
    });

    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.bucket).toBe("day");
    expect(body.data).toHaveLength(2);
    expect(body.data[0].bucketStart).toBe("2026-08-01");
    expect(body.data[0].requestCount).toBe(2);
    expect(body.data[1].bucketStart).toBe("2026-08-02");
  });
});
