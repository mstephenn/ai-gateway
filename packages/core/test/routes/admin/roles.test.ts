import { describe, it, expect, vi } from "vitest";
import { createHash } from "node:crypto";
import Fastify from "fastify";
import { registerAdminRolesRoute } from "../../../src/routes/admin/roles";

function fakeDb(seed: { roles?: any[]; apiKey?: { id: string; keyHash: string; isActive: boolean; isAdmin?: boolean } } = {}) {
  return {
    apiKey: {
      findUnique: vi.fn().mockResolvedValue(seed.apiKey ?? null),
    },
    role: {
      findMany: vi.fn().mockResolvedValue(seed.roles ?? []),
    },
  } as any;
}

function adminToken() {
  return createHash("sha256").update("sk-admin").digest("hex");
}

describe("GET /admin/roles", () => {
  it("returns 401 without a bearer token", async () => {
    const app = Fastify();
    registerAdminRolesRoute(app, { db: fakeDb() });

    const res = await app.inject({ method: "GET", url: "/admin/roles" });
    expect(res.statusCode).toBe(401);
  });

  it("lists roles", async () => {
    const db = fakeDb({
      apiKey: { id: "key-1", keyHash: adminToken(), isActive: true, isAdmin: true },
      roles: [
        { id: "role-1", name: "platform_admin", description: "Full admin" },
        { id: "role-2", name: "end_user", description: "Standard user" },
      ],
    });
    const app = Fastify();
    registerAdminRolesRoute(app, { db });

    const res = await app.inject({
      method: "GET",
      url: "/admin/roles",
      headers: { authorization: "Bearer sk-admin" },
    });

    expect(res.statusCode).toBe(200);
    expect(res.json().data).toHaveLength(2);
  });

  it("returns 403 for a valid non-admin key", async () => {
    const db = fakeDb({ apiKey: { id: "key-1", keyHash: adminToken(), isActive: true } });
    const app = Fastify();
    registerAdminRolesRoute(app, { db });

    const res = await app.inject({
      method: "GET",
      url: "/admin/roles",
      headers: { authorization: "Bearer sk-admin" },
    });

    expect(res.statusCode).toBe(403);
  });
});
