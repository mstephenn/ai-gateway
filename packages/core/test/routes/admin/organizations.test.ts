import { describe, it, expect, vi } from "vitest";
import { createHash } from "node:crypto";
import Fastify from "fastify";
import { registerAdminOrganizationsRoute } from "../../../src/routes/admin/organizations";

function fakeDb(seed: { organizations?: any[]; apiKey?: { id: string; keyHash: string; isActive: boolean; isAdmin?: boolean } } = {}) {
  const organizations = seed.organizations ?? [];
  return {
    apiKey: {
      findUnique: vi.fn().mockResolvedValue(seed.apiKey ?? null),
    },
    organization: {
      findFirst: vi.fn().mockImplementation(() => Promise.resolve(organizations[0] ?? null)),
      create: vi.fn().mockImplementation((args: { data: any }) => {
        const created = { id: "org-1", ...args.data };
        organizations.push(created);
        return Promise.resolve(created);
      }),
      update: vi.fn().mockImplementation((args: { where: { id: string }; data: any }) => {
        const idx = organizations.findIndex((o) => o.id === args.where.id);
        if (idx !== -1) {organizations[idx] = { ...organizations[idx], ...args.data };}
        return Promise.resolve(organizations[idx] ?? null);
      }),
    },
  } as any;
}

function adminToken() {
  return createHash("sha256").update("sk-admin").digest("hex");
}

describe("GET /admin/organization", () => {
  it("returns 401 without a bearer token", async () => {
    const app = Fastify();
    registerAdminOrganizationsRoute(app, { db: fakeDb() });

    const res = await app.inject({ method: "GET", url: "/admin/organization" });
    expect(res.statusCode).toBe(401);
  });

  it("returns 404 when no organization exists", async () => {
    const db = fakeDb({ apiKey: { id: "key-1", keyHash: adminToken(), isActive: true, isAdmin: true } });
    const app = Fastify();
    registerAdminOrganizationsRoute(app, { db });

    const res = await app.inject({
      method: "GET",
      url: "/admin/organization",
      headers: { authorization: "Bearer sk-admin" },
    });

    expect(res.statusCode).toBe(404);
  });

  it("returns the organization", async () => {
    const db = fakeDb({
      apiKey: { id: "key-1", keyHash: adminToken(), isActive: true, isAdmin: true },
      organizations: [{ id: "org-1", name: "Acme", domain: "acme.example" }],
    });
    const app = Fastify();
    registerAdminOrganizationsRoute(app, { db });

    const res = await app.inject({
      method: "GET",
      url: "/admin/organization",
      headers: { authorization: "Bearer sk-admin" },
    });

    expect(res.statusCode).toBe(200);
    expect(res.json().name).toBe("Acme");
  });

  it("returns 403 for a valid non-admin key", async () => {
    const db = fakeDb({ apiKey: { id: "key-1", keyHash: adminToken(), isActive: true } });
    const app = Fastify();
    registerAdminOrganizationsRoute(app, { db });

    const res = await app.inject({
      method: "GET",
      url: "/admin/organization",
      headers: { authorization: "Bearer sk-admin" },
    });

    expect(res.statusCode).toBe(403);
  });
});

describe("POST /admin/organization", () => {
  it("returns 400 when name is missing", async () => {
    const db = fakeDb({ apiKey: { id: "key-1", keyHash: adminToken(), isActive: true, isAdmin: true } });
    const app = Fastify();
    registerAdminOrganizationsRoute(app, { db });

    const res = await app.inject({
      method: "POST",
      url: "/admin/organization",
      headers: { authorization: "Bearer sk-admin" },
      payload: {},
    });

    expect(res.statusCode).toBe(400);
  });

  it("returns 409 when an organization already exists", async () => {
    const db = fakeDb({
      apiKey: { id: "key-1", keyHash: adminToken(), isActive: true, isAdmin: true },
      organizations: [{ id: "org-1", name: "Acme" }],
    });
    const app = Fastify();
    registerAdminOrganizationsRoute(app, { db });

    const res = await app.inject({
      method: "POST",
      url: "/admin/organization",
      headers: { authorization: "Bearer sk-admin" },
      payload: { name: "New" },
    });

    expect(res.statusCode).toBe(409);
  });

  it("creates an organization", async () => {
    const db = fakeDb({ apiKey: { id: "key-1", keyHash: adminToken(), isActive: true, isAdmin: true } });
    const app = Fastify();
    registerAdminOrganizationsRoute(app, { db });

    const res = await app.inject({
      method: "POST",
      url: "/admin/organization",
      headers: { authorization: "Bearer sk-admin" },
      payload: { name: "Acme", domain: "acme.example" },
    });

    expect(res.statusCode).toBe(201);
    const body = res.json();
    expect(body.name).toBe("Acme");
    expect(body.domain).toBe("acme.example");
  });
});

describe("PATCH /admin/organization", () => {
  it("updates the organization", async () => {
    const db = fakeDb({
      apiKey: { id: "key-1", keyHash: adminToken(), isActive: true, isAdmin: true },
      organizations: [{ id: "org-1", name: "Acme", domain: "acme.example" }],
    });
    const app = Fastify();
    registerAdminOrganizationsRoute(app, { db });

    const res = await app.inject({
      method: "PATCH",
      url: "/admin/organization",
      headers: { authorization: "Bearer sk-admin" },
      payload: { name: "Acme Corp", domain: null },
    });

    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.name).toBe("Acme Corp");
    expect(body.domain).toBeNull();
  });
});
