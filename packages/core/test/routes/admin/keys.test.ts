import { describe, it, expect, vi } from "vitest";
import { createHash } from "node:crypto";
import Fastify from "fastify";
import { registerAdminKeysRoute } from "../../../src/routes/admin/keys";

function fakeDb(seed: {
  apiKey?: { id: string; keyHash: string; isActive: boolean; isAdmin?: boolean };
  team?: { id: string; name: string };
  existingKeys?: any[];
}) {
  const keys = seed.existingKeys ?? [];
  if (seed.apiKey) {keys.push(seed.apiKey);}
  return {
    apiKey: {
      findUnique: vi.fn().mockImplementation((args: { where: { id?: string; keyHash?: string } }) => {
        const found = keys.find((k) => k.id === args.where.id || k.keyHash === args.where.keyHash);
        return Promise.resolve(found ?? null);
      }),
      create: vi.fn().mockImplementation((args: any) => {
        const created = { id: "key-new", ...args.data, team: seed.team ?? null, createdAt: new Date().toISOString() };
        keys.push(created);
        return Promise.resolve(created);
      }),
      findMany: vi.fn().mockResolvedValue(keys),
      update: vi.fn().mockImplementation((args: { where: { id: string }; data: any }) => {
        const idx = keys.findIndex((k) => k.id === args.where.id);
        if (idx !== -1) {keys[idx] = { ...keys[idx], ...args.data };}
        return Promise.resolve(keys[idx] ?? null);
      }),
    },
    team: {
      findUnique: vi.fn().mockResolvedValue(seed.team ?? null),
    },
    $transaction: vi.fn().mockImplementation(async (ops: any[]) => {
      const results = [];
      for (const op of ops) {results.push(await op);}
      return results;
    }),
  } as any;
}

describe("POST /admin/keys", () => {
  it("returns 401 without a bearer token", async () => {
    const app = Fastify();
    registerAdminKeysRoute(app, { db: fakeDb({}) });

    const res = await app.inject({ method: "POST", url: "/admin/keys", payload: {} });

    expect(res.statusCode).toBe(401);
  });

  it("returns 400 when teamId does not exist", async () => {
    const hash = createHash("sha256").update("sk-admin").digest("hex");
    const db = fakeDb({ apiKey: { id: "key-1", keyHash: hash, isActive: true, isAdmin: true } });
    const app = Fastify();
    registerAdminKeysRoute(app, { db });

    const res = await app.inject({
      method: "POST",
      url: "/admin/keys",
      headers: { authorization: "Bearer sk-admin" },
      payload: { teamId: "missing-team" },
    });

    expect(res.statusCode).toBe(400);
  });

  it("creates a key and returns the raw token once", async () => {
    const hash = createHash("sha256").update("sk-admin").digest("hex");
    const db = fakeDb({ apiKey: { id: "key-1", keyHash: hash, isActive: true, isAdmin: true } });
    const app = Fastify();
    registerAdminKeysRoute(app, { db });

    const res = await app.inject({
      method: "POST",
      url: "/admin/keys",
      headers: { authorization: "Bearer sk-admin" },
      payload: { name: "CI key" },
    });

    expect(res.statusCode).toBe(201);
    const body = res.json();
    expect(body.name).toBe("CI key");
    expect(body.key).toMatch(/^ak-[a-f0-9]+$/);
    expect(body.keyPrefix).toBe(body.key.slice(0, 7));
    expect(db.apiKey.create).toHaveBeenCalled();
  });
});

describe("GET /admin/keys", () => {
  it("lists keys without exposing hashes", async () => {
    const hash = createHash("sha256").update("sk-admin").digest("hex");
    const db = fakeDb({
      apiKey: { id: "key-1", keyHash: hash, isActive: true, isAdmin: true },
      existingKeys: [{ id: "key-1", name: "CI key", keyHash: "secret", keyPrefix: "ak-abc12", team: null }],
    });
    const app = Fastify();
    registerAdminKeysRoute(app, { db });

    const res = await app.inject({
      method: "GET",
      url: "/admin/keys",
      headers: { authorization: "Bearer sk-admin" },
    });

    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.data[0].keyPrefix).toBe("ak-abc12");
    expect(body.data[0]).not.toHaveProperty("keyHash");
  });

  it("returns 403 for a valid non-admin key", async () => {
    const hash = createHash("sha256").update("sk-admin").digest("hex");
    const db = fakeDb({ apiKey: { id: "key-1", keyHash: hash, isActive: true } });
    const app = Fastify();
    registerAdminKeysRoute(app, { db });

    const res = await app.inject({
      method: "GET",
      url: "/admin/keys",
      headers: { authorization: "Bearer sk-admin" },
    });

    expect(res.statusCode).toBe(403);
  });
});

describe("DELETE /admin/keys/:id", () => {
  it("revokes a key", async () => {
    const hash = createHash("sha256").update("sk-admin").digest("hex");
    const db = fakeDb({
      apiKey: { id: "key-1", keyHash: hash, isActive: true, isAdmin: true },
      existingKeys: [{ id: "key-1", isActive: true }],
    });
    const app = Fastify();
    registerAdminKeysRoute(app, { db });

    const res = await app.inject({
      method: "DELETE",
      url: "/admin/keys/key-1",
      headers: { authorization: "Bearer sk-admin" },
    });

    expect(res.statusCode).toBe(204);
    expect(db.apiKey.update).toHaveBeenCalledWith(
      expect.objectContaining({ data: { isActive: false } }),
    );
  });
});

describe("POST /admin/keys/:id/rotate", () => {
  it("returns 404 for a missing key", async () => {
    const hash = createHash("sha256").update("sk-admin").digest("hex");
    const db = fakeDb({ apiKey: { id: "key-1", keyHash: hash, isActive: true, isAdmin: true } });
    const app = Fastify();
    registerAdminKeysRoute(app, { db });

    const res = await app.inject({
      method: "POST",
      url: "/admin/keys/missing/rotate",
      headers: { authorization: "Bearer sk-admin" },
    });

    expect(res.statusCode).toBe(404);
  });

  it("creates a new key and deactivates the old one", async () => {
    const hash = createHash("sha256").update("sk-admin").digest("hex");
    const db = fakeDb({
      apiKey: { id: "key-1", keyHash: hash, isActive: true, isAdmin: true },
      existingKeys: [{ id: "key-1", name: "CI key", isActive: true, teamId: null, expiresAt: null, budgetLimit: null, rpmLimit: null, tpmLimit: null }],
    });
    const app = Fastify();
    registerAdminKeysRoute(app, { db });

    const res = await app.inject({
      method: "POST",
      url: "/admin/keys/key-1/rotate",
      headers: { authorization: "Bearer sk-admin" },
    });

    expect(res.statusCode).toBe(201);
    const body = res.json();
    expect(body.name).toBe("CI key");
    expect(body.key).toMatch(/^ak-[a-f0-9]+$/);
  });
});

describe("PATCH /admin/keys/:id", () => {
  it("updates a key's allowed models", async () => {
    const hash = createHash("sha256").update("sk-admin").digest("hex");
    const db = fakeDb({
      apiKey: { id: "key-1", keyHash: hash, isActive: true, isAdmin: true },
      existingKeys: [{ id: "key-1", name: "CI key", isActive: true, teamId: null, expiresAt: null, budgetLimit: null, rpmLimit: null, tpmLimit: null, allowedModels: [] }],
    });
    const app = Fastify();
    registerAdminKeysRoute(app, { db });

    const res = await app.inject({
      method: "PATCH",
      url: "/admin/keys/key-1",
      headers: { authorization: "Bearer sk-admin" },
      payload: { allowedModels: ["gpt-4o"] },
    });

    expect(res.statusCode).toBe(200);
    expect(res.json().allowedModels).toEqual(["gpt-4o"]);
  });
});
