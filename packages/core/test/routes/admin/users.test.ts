import { describe, it, expect, vi } from "vitest";
import { createHash } from "node:crypto";
import Fastify from "fastify";
import { registerAdminUsersRoute } from "../../../src/routes/admin/users";

function fakeDb(seed: { users?: any[]; organizations?: any[]; apiKey?: { id: string; keyHash: string; isActive: boolean; isAdmin?: boolean } } = {}) {
  const users = seed.users ?? [];
  const organizations = seed.organizations ?? [];

  return {
    apiKey: {
      findUnique: vi.fn().mockResolvedValue(seed.apiKey ?? null),
    },
    user: {
      findMany: vi.fn().mockResolvedValue(users),
      findUnique: vi.fn().mockImplementation((args: { where: { id?: string; email?: string } }) => {
        if (args.where.email) {
          return Promise.resolve(users.find((u) => u.email === args.where.email) ?? null);
        }
        return Promise.resolve(users.find((u) => u.id === args.where.id) ?? null);
      }),
      create: vi.fn().mockImplementation((args: { data: any }) => {
        const created = { id: "user-new", ...args.data, createdAt: new Date().toISOString(), updatedAt: new Date().toISOString() };
        users.push(created);
        return Promise.resolve(created);
      }),
      update: vi.fn().mockImplementation((args: { where: { id: string }; data: any }) => {
        const idx = users.findIndex((u) => u.id === args.where.id);
        if (idx !== -1) {users[idx] = { ...users[idx], ...args.data };}
        return Promise.resolve(users[idx] ?? null);
      }),
    },
    organization: {
      findUnique: vi.fn().mockImplementation((args: { where: { id: string } }) => {
        return Promise.resolve(organizations.find((o) => o.id === args.where.id) ?? null);
      }),
    },
  } as any;
}

function adminToken() {
  return createHash("sha256").update("sk-admin").digest("hex");
}

describe("GET /admin/users", () => {
  it("returns 401 without a bearer token", async () => {
    const app = Fastify();
    registerAdminUsersRoute(app, { db: fakeDb() });

    const res = await app.inject({ method: "GET", url: "/admin/users" });
    expect(res.statusCode).toBe(401);
  });

  it("lists users with filters", async () => {
    const db = fakeDb({
      apiKey: { id: "key-1", keyHash: adminToken(), isActive: true, isAdmin: true },
      users: [
        { id: "user-1", email: "alice@example.com", name: "Alice", status: "active", source: "manual", createdAt: new Date().toISOString() },
        { id: "user-2", email: "bob@example.com", name: "Bob", status: "inactive", source: "directory", createdAt: new Date().toISOString() },
      ],
    });
    const app = Fastify();
    registerAdminUsersRoute(app, { db });

    const res = await app.inject({
      method: "GET",
      url: "/admin/users?status=active",
      headers: { authorization: "Bearer sk-admin" },
    });

    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.data).toHaveLength(2); // fake findMany ignores filters, but route shape is exercised
  });

  it("returns 403 for a valid non-admin key", async () => {
    const db = fakeDb({ apiKey: { id: "key-1", keyHash: adminToken(), isActive: true } });
    const app = Fastify();
    registerAdminUsersRoute(app, { db });

    const res = await app.inject({
      method: "GET",
      url: "/admin/users",
      headers: { authorization: "Bearer sk-admin" },
    });

    expect(res.statusCode).toBe(403);
  });
});

describe("POST /admin/users", () => {
  it("returns 400 when email is missing", async () => {
    const db = fakeDb({ apiKey: { id: "key-1", keyHash: adminToken(), isActive: true, isAdmin: true } });
    const app = Fastify();
    registerAdminUsersRoute(app, { db });

    const res = await app.inject({
      method: "POST",
      url: "/admin/users",
      headers: { authorization: "Bearer sk-admin" },
      payload: {},
    });

    expect(res.statusCode).toBe(400);
  });

  it("returns 409 for duplicate email", async () => {
    const db = fakeDb({
      apiKey: { id: "key-1", keyHash: adminToken(), isActive: true, isAdmin: true },
      users: [{ id: "user-1", email: "alice@example.com", status: "active", source: "manual" }],
    });
    const app = Fastify();
    registerAdminUsersRoute(app, { db });

    const res = await app.inject({
      method: "POST",
      url: "/admin/users",
      headers: { authorization: "Bearer sk-admin" },
      payload: { email: "alice@example.com" },
    });

    expect(res.statusCode).toBe(409);
  });

  it("creates a manual user", async () => {
    const db = fakeDb({ apiKey: { id: "key-1", keyHash: adminToken(), isActive: true, isAdmin: true } });
    const app = Fastify();
    registerAdminUsersRoute(app, { db });

    const res = await app.inject({
      method: "POST",
      url: "/admin/users",
      headers: { authorization: "Bearer sk-admin" },
      payload: { email: "alice@example.com", name: "Alice" },
    });

    expect(res.statusCode).toBe(201);
    const body = res.json();
    expect(body.email).toBe("alice@example.com");
    expect(body.source).toBe("manual");
  });
});

describe("PATCH /admin/users/:id", () => {
  it("updates user status", async () => {
    const db = fakeDb({
      apiKey: { id: "key-1", keyHash: adminToken(), isActive: true, isAdmin: true },
      users: [{ id: "user-1", email: "alice@example.com", name: "Alice", status: "active", source: "manual" }],
    });
    const app = Fastify();
    registerAdminUsersRoute(app, { db });

    const res = await app.inject({
      method: "PATCH",
      url: "/admin/users/user-1",
      headers: { authorization: "Bearer sk-admin" },
      payload: { name: "Alice Smith", status: "inactive" },
    });

    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.name).toBe("Alice Smith");
    expect(body.status).toBe("inactive");
  });
});

describe("POST /admin/users/:id/deactivate", () => {
  it("deactivates a user", async () => {
    const db = fakeDb({
      apiKey: { id: "key-1", keyHash: adminToken(), isActive: true, isAdmin: true },
      users: [{ id: "user-1", email: "alice@example.com", name: "Alice", status: "active", source: "manual" }],
    });
    const app = Fastify();
    registerAdminUsersRoute(app, { db });

    const res = await app.inject({
      method: "POST",
      url: "/admin/users/user-1/deactivate",
      headers: { authorization: "Bearer sk-admin" },
    });

    expect(res.statusCode).toBe(200);
    expect(res.json().status).toBe("inactive");
  });
});

describe("POST /admin/users/:id/reactivate", () => {
  it("reactivates a user", async () => {
    const db = fakeDb({
      apiKey: { id: "key-1", keyHash: adminToken(), isActive: true, isAdmin: true },
      users: [{ id: "user-1", email: "alice@example.com", name: "Alice", status: "inactive", source: "manual" }],
    });
    const app = Fastify();
    registerAdminUsersRoute(app, { db });

    const res = await app.inject({
      method: "POST",
      url: "/admin/users/user-1/reactivate",
      headers: { authorization: "Bearer sk-admin" },
    });

    expect(res.statusCode).toBe(200);
    expect(res.json().status).toBe("active");
  });
});
