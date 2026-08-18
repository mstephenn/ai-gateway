import { describe, it, expect, vi } from "vitest";
import { createHash } from "node:crypto";
import Fastify from "fastify";
import { registerAdminDeploymentsRoute } from "../../../src/routes/admin/deployments";

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

function fakeDb(seed: {
  deployments?: any[];
  apiKey?: { id: string; keyHash: string; isActive: boolean; isAdmin?: boolean };
  providerCredentials?: { id: string; provider: string; name: string }[];
} = {}) {
  const deployments = seed.deployments ?? [];
  return {
    apiKey: {
      findUnique: vi.fn().mockResolvedValue(seed.apiKey ?? null),
    },
    providerCredential: {
      findUnique: vi.fn().mockImplementation((args: { where: { id: string } }) =>
        Promise.resolve((seed.providerCredentials ?? []).find((c) => c.id === args.where.id) ?? null),
      ),
    },
    deployment: {
      findMany: vi.fn().mockResolvedValue(deployments),
      create: vi.fn().mockImplementation((args: { data: any }) => {
        const created = { id: "dep-new", ...args.data };
        deployments.push(created);
        return Promise.resolve(created);
      }),
      findUnique: vi.fn().mockImplementation((args: { where: { id: string } }) => {
        const found = deployments.find((d) => d.id === args.where.id);
        return Promise.resolve(found ?? null);
      }),
      update: vi.fn().mockImplementation((args: { where: { id: string }; data: any }) => {
        const idx = deployments.findIndex((d) => d.id === args.where.id);
        if (idx !== -1) {deployments[idx] = { ...deployments[idx], ...args.data };}
        return Promise.resolve(deployments[idx] ?? null);
      }),
    },
  } as any;
}

function adminToken() {
  return createHash("sha256").update("sk-admin").digest("hex");
}

describe("GET /admin/deployments", () => {
  it("returns 401 without a bearer token", async () => {
    const app = Fastify();
    registerAdminDeploymentsRoute(app, { db: fakeDb(), redis: fakeRedis() });

    const res = await app.inject({ method: "GET", url: "/admin/deployments" });

    expect(res.statusCode).toBe(401);
  });

  it("lists deployments", async () => {
    const db = fakeDb({
      apiKey: { id: "key-1", keyHash: adminToken(), isActive: true, isAdmin: true },
      deployments: [{ id: "dep-1", modelName: "gpt-4o", provider: "openai", providerModelId: "gpt-4o", credentialsRef: "openai", weight: 1, isActive: true }],
    });
    const app = Fastify();
    registerAdminDeploymentsRoute(app, { db, redis: fakeRedis() });

    const res = await app.inject({
      method: "GET",
      url: "/admin/deployments",
      headers: { authorization: "Bearer sk-admin" },
    });

    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.data).toHaveLength(1);
    expect(body.data[0].modelName).toBe("gpt-4o");
  });

  it("marks a deployment healthy when not in cooldown", async () => {
    const db = fakeDb({
      apiKey: { id: "key-1", keyHash: adminToken(), isActive: true, isAdmin: true },
      deployments: [{ id: "dep-1", modelName: "gpt-4o", provider: "openai", providerModelId: "gpt-4o", credentialsRef: "openai", weight: 1, isActive: true }],
    });
    const app = Fastify();
    registerAdminDeploymentsRoute(app, { db, redis: fakeRedis() });

    const res = await app.inject({ method: "GET", url: "/admin/deployments", headers: { authorization: "Bearer sk-admin" } });
    expect(res.json().data[0].health).toBe("healthy");
  });

  it("marks a deployment in cooldown", async () => {
    const db = fakeDb({
      apiKey: { id: "key-1", keyHash: adminToken(), isActive: true, isAdmin: true },
      deployments: [{ id: "dep-1", modelName: "gpt-4o", provider: "openai", providerModelId: "gpt-4o", credentialsRef: "openai", weight: 1, isActive: true }],
    });
    const app = Fastify();
    registerAdminDeploymentsRoute(app, { db, redis: fakeRedis(["dep-1"]) });

    const res = await app.inject({ method: "GET", url: "/admin/deployments", headers: { authorization: "Bearer sk-admin" } });
    expect(res.json().data[0].health).toBe("cooldown");
  });

  it("returns 403 for a valid non-admin key", async () => {
    const db = fakeDb({ apiKey: { id: "key-1", keyHash: adminToken(), isActive: true } });
    const app = Fastify();
    registerAdminDeploymentsRoute(app, { db, redis: fakeRedis() });

    const res = await app.inject({
      method: "GET",
      url: "/admin/deployments",
      headers: { authorization: "Bearer sk-admin" },
    });

    expect(res.statusCode).toBe(403);
  });
});

describe("GET /admin/deployments/health", () => {
  it("returns health for every deployment without the full row shape", async () => {
    const db = fakeDb({
      apiKey: { id: "key-1", keyHash: adminToken(), isActive: true, isAdmin: true },
      deployments: [
        { id: "dep-1", modelName: "gpt-4o", provider: "openai", providerModelId: "gpt-4o", credentialsRef: "openai", weight: 1, isActive: true },
        { id: "dep-2", modelName: "claude", provider: "anthropic", providerModelId: "claude", credentialsRef: "anthropic", weight: 1, isActive: true },
      ],
    });
    const app = Fastify();
    registerAdminDeploymentsRoute(app, { db, redis: fakeRedis(["dep-2"]) });

    const res = await app.inject({ method: "GET", url: "/admin/deployments/health", headers: { authorization: "Bearer sk-admin" } });

    expect(res.statusCode).toBe(200);
    expect(res.json().data).toEqual([
      { id: "dep-1", health: "healthy" },
      { id: "dep-2", health: "cooldown" },
    ]);
  });
});

describe("POST /admin/deployments", () => {
  it("returns 400 when required fields are missing", async () => {
    const db = fakeDb({ apiKey: { id: "key-1", keyHash: adminToken(), isActive: true, isAdmin: true } });
    const app = Fastify();
    registerAdminDeploymentsRoute(app, { db, redis: fakeRedis() });

    const res = await app.inject({
      method: "POST",
      url: "/admin/deployments",
      headers: { authorization: "Bearer sk-admin" },
      payload: {},
    });

    expect(res.statusCode).toBe(400);
  });

  it("creates a deployment with default weight and isActive", async () => {
    const db = fakeDb({ apiKey: { id: "key-1", keyHash: adminToken(), isActive: true, isAdmin: true } });
    const app = Fastify();
    registerAdminDeploymentsRoute(app, { db, redis: fakeRedis() });

    const res = await app.inject({
      method: "POST",
      url: "/admin/deployments",
      headers: { authorization: "Bearer sk-admin" },
      payload: {
        modelName: "gpt-4o",
        provider: "openai",
        providerModelId: "gpt-4o",
        credentialsRef: "env:openai",
      },
    });

    expect(res.statusCode).toBe(201);
    const body = res.json();
    expect(body.modelName).toBe("gpt-4o");
    expect(body.weight).toBe(1);
    expect(body.isActive).toBe(true);
    expect(db.deployment.create).toHaveBeenCalled();
  });

  it("accepts an env:<provider> credentialsRef without a DB lookup", async () => {
    const db = fakeDb({ apiKey: { id: "key-1", keyHash: adminToken(), isActive: true, isAdmin: true } });
    const app = Fastify();
    registerAdminDeploymentsRoute(app, { db, redis: fakeRedis() });

    const res = await app.inject({
      method: "POST",
      url: "/admin/deployments",
      headers: { authorization: "Bearer sk-admin" },
      payload: { modelName: "gpt-4o", provider: "openai", providerModelId: "gpt-4o", credentialsRef: "env:openai" },
    });

    expect(res.statusCode).toBe(201);
  });

  it("rejects a credentialsRef that matches no known credential", async () => {
    const db = fakeDb({
      apiKey: { id: "key-1", keyHash: adminToken(), isActive: true, isAdmin: true },
      providerCredentials: [],
    });
    const app = Fastify();
    registerAdminDeploymentsRoute(app, { db, redis: fakeRedis() });

    const res = await app.inject({
      method: "POST",
      url: "/admin/deployments",
      headers: { authorization: "Bearer sk-admin" },
      payload: { modelName: "gpt-4o", provider: "openai", providerModelId: "gpt-4o", credentialsRef: "not-a-real-id" },
    });

    expect(res.statusCode).toBe(400);
  });

  it("accepts a credentialsRef matching a real ProviderCredential for that provider", async () => {
    const db = fakeDb({
      apiKey: { id: "key-1", keyHash: adminToken(), isActive: true, isAdmin: true },
      providerCredentials: [{ id: "cred-1", provider: "openai", name: "Prod" }],
    });
    const app = Fastify();
    registerAdminDeploymentsRoute(app, { db, redis: fakeRedis() });

    const res = await app.inject({
      method: "POST",
      url: "/admin/deployments",
      headers: { authorization: "Bearer sk-admin" },
      payload: { modelName: "gpt-4o", provider: "openai", providerModelId: "gpt-4o", credentialsRef: "cred-1" },
    });

    expect(res.statusCode).toBe(201);
  });
});

describe("GET /admin/deployments/:id", () => {
  it("returns 404 for a missing deployment", async () => {
    const db = fakeDb({ apiKey: { id: "key-1", keyHash: adminToken(), isActive: true, isAdmin: true } });
    const app = Fastify();
    registerAdminDeploymentsRoute(app, { db, redis: fakeRedis() });

    const res = await app.inject({
      method: "GET",
      url: "/admin/deployments/missing",
      headers: { authorization: "Bearer sk-admin" },
    });

    expect(res.statusCode).toBe(404);
  });

  it("returns a deployment by id", async () => {
    const db = fakeDb({
      apiKey: { id: "key-1", keyHash: adminToken(), isActive: true, isAdmin: true },
      deployments: [{ id: "dep-1", modelName: "gpt-4o", provider: "openai", providerModelId: "gpt-4o", credentialsRef: "openai", weight: 1, isActive: true }],
    });
    const app = Fastify();
    registerAdminDeploymentsRoute(app, { db, redis: fakeRedis() });

    const res = await app.inject({
      method: "GET",
      url: "/admin/deployments/dep-1",
      headers: { authorization: "Bearer sk-admin" },
    });

    expect(res.statusCode).toBe(200);
    expect(res.json().id).toBe("dep-1");
  });
});

describe("PATCH /admin/deployments/:id", () => {
  it("returns 404 for a missing deployment", async () => {
    const db = fakeDb({ apiKey: { id: "key-1", keyHash: adminToken(), isActive: true, isAdmin: true } });
    const app = Fastify();
    registerAdminDeploymentsRoute(app, { db, redis: fakeRedis() });

    const res = await app.inject({
      method: "PATCH",
      url: "/admin/deployments/missing",
      headers: { authorization: "Bearer sk-admin" },
      payload: { weight: 2 },
    });

    expect(res.statusCode).toBe(404);
  });

  it("updates the specified fields", async () => {
    const db = fakeDb({
      apiKey: { id: "key-1", keyHash: adminToken(), isActive: true, isAdmin: true },
      deployments: [{ id: "dep-1", modelName: "gpt-4o", provider: "openai", providerModelId: "gpt-4o", credentialsRef: "openai", weight: 1, isActive: true }],
    });
    const app = Fastify();
    registerAdminDeploymentsRoute(app, { db, redis: fakeRedis() });

    const res = await app.inject({
      method: "PATCH",
      url: "/admin/deployments/dep-1",
      headers: { authorization: "Bearer sk-admin" },
      payload: { weight: 3, isActive: false },
    });

    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.weight).toBe(3);
    expect(body.isActive).toBe(false);
  });
});

describe("DELETE /admin/deployments/:id", () => {
  it("returns 404 for a missing deployment", async () => {
    const db = fakeDb({ apiKey: { id: "key-1", keyHash: adminToken(), isActive: true, isAdmin: true } });
    const app = Fastify();
    registerAdminDeploymentsRoute(app, { db, redis: fakeRedis() });

    const res = await app.inject({
      method: "DELETE",
      url: "/admin/deployments/missing",
      headers: { authorization: "Bearer sk-admin" },
    });

    expect(res.statusCode).toBe(404);
  });

  it("soft-deletes a deployment", async () => {
    const db = fakeDb({
      apiKey: { id: "key-1", keyHash: adminToken(), isActive: true, isAdmin: true },
      deployments: [{ id: "dep-1", modelName: "gpt-4o", provider: "openai", providerModelId: "gpt-4o", credentialsRef: "openai", weight: 1, isActive: true }],
    });
    const app = Fastify();
    registerAdminDeploymentsRoute(app, { db, redis: fakeRedis() });

    const res = await app.inject({
      method: "DELETE",
      url: "/admin/deployments/dep-1",
      headers: { authorization: "Bearer sk-admin" },
    });

    expect(res.statusCode).toBe(204);
    expect(db.deployment.update).toHaveBeenCalledWith(
      expect.objectContaining({ data: { isActive: false } }),
    );
  });
});
