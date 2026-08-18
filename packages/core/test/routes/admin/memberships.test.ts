import { describe, it, expect, vi } from "vitest";
import { createHash } from "node:crypto";
import Fastify from "fastify";
import { registerAdminMembershipsRoute } from "../../../src/routes/admin/memberships";

function fakeDb(seed: {
  users?: any[];
  orgUnits?: any[];
  roles?: any[];
  memberships?: any[];
  apiKey?: { id: string; keyHash: string; isActive: boolean; isAdmin?: boolean };
} = {}) {
  const memberships = seed.memberships ?? [];

  return {
    apiKey: {
      findUnique: vi.fn().mockResolvedValue(seed.apiKey ?? null),
    },
    user: {
      findUnique: vi.fn().mockImplementation((args: { where: { id: string } }) => {
        return Promise.resolve((seed.users ?? []).find((u) => u.id === args.where.id) ?? null);
      }),
    },
    orgUnit: {
      findUnique: vi.fn().mockImplementation((args: { where: { id: string } }) => {
        return Promise.resolve((seed.orgUnits ?? []).find((u) => u.id === args.where.id) ?? null);
      }),
    },
    role: {
      findUnique: vi.fn().mockImplementation((args: { where: { id: string } }) => {
        return Promise.resolve((seed.roles ?? []).find((r) => r.id === args.where.id) ?? null);
      }),
    },
    membership: {
      findMany: vi.fn().mockResolvedValue(memberships),
      findUnique: vi.fn().mockImplementation((args: { where: { id?: string; userId_orgUnitId?: { userId: string; orgUnitId: string } } }) => {
        if (args.where.id) {
          return Promise.resolve(memberships.find((m) => m.id === args.where.id) ?? null);
        }
        if (args.where.userId_orgUnitId) {
          return Promise.resolve(
            memberships.find(
              (m) => m.userId === args.where!.userId_orgUnitId!.userId && m.orgUnitId === args.where!.userId_orgUnitId!.orgUnitId,
            ) ?? null,
          );
        }
        return Promise.resolve(null);
      }),
      create: vi.fn().mockImplementation((args: { data: any }) => {
        const created = { id: "mem-new", ...args.data, createdAt: new Date().toISOString(), updatedAt: new Date().toISOString() };
        memberships.push(created);
        return Promise.resolve(created);
      }),
      delete: vi.fn().mockImplementation((args: { where: { id: string } }) => {
        const idx = memberships.findIndex((m) => m.id === args.where.id);
        if (idx !== -1) {memberships.splice(idx, 1);}
        return Promise.resolve(null);
      }),
    },
  } as any;
}

function adminToken() {
  return createHash("sha256").update("sk-admin").digest("hex");
}

describe("GET /admin/memberships", () => {
  it("returns 401 without a bearer token", async () => {
    const app = Fastify();
    registerAdminMembershipsRoute(app, { db: fakeDb() });

    const res = await app.inject({ method: "GET", url: "/admin/memberships" });
    expect(res.statusCode).toBe(401);
  });

  it("lists memberships", async () => {
    const db = fakeDb({
      apiKey: { id: "key-1", keyHash: adminToken(), isActive: true, isAdmin: true },
      memberships: [{ id: "mem-1", userId: "user-1", orgUnitId: "unit-1", roleId: "role-1" }],
    });
    const app = Fastify();
    registerAdminMembershipsRoute(app, { db });

    const res = await app.inject({
      method: "GET",
      url: "/admin/memberships",
      headers: { authorization: "Bearer sk-admin" },
    });

    expect(res.statusCode).toBe(200);
    expect(res.json().data).toHaveLength(1);
  });

  it("returns 403 for a valid non-admin key", async () => {
    const db = fakeDb({ apiKey: { id: "key-1", keyHash: adminToken(), isActive: true } });
    const app = Fastify();
    registerAdminMembershipsRoute(app, { db });

    const res = await app.inject({
      method: "GET",
      url: "/admin/memberships",
      headers: { authorization: "Bearer sk-admin" },
    });

    expect(res.statusCode).toBe(403);
  });
});

describe("POST /admin/memberships", () => {
  it("returns 400 when fields are missing", async () => {
    const db = fakeDb({ apiKey: { id: "key-1", keyHash: adminToken(), isActive: true, isAdmin: true } });
    const app = Fastify();
    registerAdminMembershipsRoute(app, { db });

    const res = await app.inject({
      method: "POST",
      url: "/admin/memberships",
      headers: { authorization: "Bearer sk-admin" },
      payload: {},
    });

    expect(res.statusCode).toBe(400);
  });

  it("creates a membership", async () => {
    const db = fakeDb({
      apiKey: { id: "key-1", keyHash: adminToken(), isActive: true, isAdmin: true },
      users: [{ id: "user-1" }],
      orgUnits: [{ id: "unit-1" }],
      roles: [{ id: "role-1" }],
    });
    const app = Fastify();
    registerAdminMembershipsRoute(app, { db });

    const res = await app.inject({
      method: "POST",
      url: "/admin/memberships",
      headers: { authorization: "Bearer sk-admin" },
      payload: { userId: "user-1", orgUnitId: "unit-1", roleId: "role-1" },
    });

    expect(res.statusCode).toBe(201);
    expect(res.json().userId).toBe("user-1");
  });

  it("returns 409 for duplicate membership", async () => {
    const db = fakeDb({
      apiKey: { id: "key-1", keyHash: adminToken(), isActive: true, isAdmin: true },
      users: [{ id: "user-1" }],
      orgUnits: [{ id: "unit-1" }],
      roles: [{ id: "role-1" }],
      memberships: [{ id: "mem-1", userId: "user-1", orgUnitId: "unit-1", roleId: "role-1" }],
    });
    const app = Fastify();
    registerAdminMembershipsRoute(app, { db });

    const res = await app.inject({
      method: "POST",
      url: "/admin/memberships",
      headers: { authorization: "Bearer sk-admin" },
      payload: { userId: "user-1", orgUnitId: "unit-1", roleId: "role-1" },
    });

    expect(res.statusCode).toBe(409);
  });
});

describe("DELETE /admin/memberships/:id", () => {
  it("deletes a membership", async () => {
    const db = fakeDb({
      apiKey: { id: "key-1", keyHash: adminToken(), isActive: true, isAdmin: true },
      memberships: [{ id: "mem-1", userId: "user-1", orgUnitId: "unit-1", roleId: "role-1" }],
    });
    const app = Fastify();
    registerAdminMembershipsRoute(app, { db });

    const res = await app.inject({
      method: "DELETE",
      url: "/admin/memberships/mem-1",
      headers: { authorization: "Bearer sk-admin" },
    });

    expect(res.statusCode).toBe(204);
  });
});
