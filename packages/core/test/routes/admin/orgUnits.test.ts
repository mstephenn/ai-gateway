import { describe, it, expect, vi } from "vitest";
import { createHash } from "node:crypto";
import Fastify from "fastify";
import { registerAdminOrgUnitsRoute } from "../../../src/routes/admin/orgUnits";

function fakeDb(seed: {
  organizations?: any[];
  orgUnits?: any[];
  teams?: any[];
  memberships?: any[];
  apiKey?: { id: string; keyHash: string; isActive: boolean; isAdmin?: boolean };
} = {}) {
  const organizations = seed.organizations ?? [];
  const orgUnits = seed.orgUnits ?? [];
  const teams = seed.teams ?? [];
  const memberships = seed.memberships ?? [];

  return {
    apiKey: {
      findUnique: vi.fn().mockResolvedValue(seed.apiKey ?? null),
    },
    organization: {
      findFirst: vi.fn().mockImplementation(() => Promise.resolve(organizations[0] ?? null)),
      findUnique: vi.fn().mockImplementation((args: { where: { id: string } }) => {
        return Promise.resolve(organizations.find((o) => o.id === args.where.id) ?? null);
      }),
    },
    orgUnit: {
      findMany: vi.fn().mockResolvedValue(orgUnits),
      findFirst: vi.fn().mockImplementation((args: { where?: any } = {}) => {
        const found = orgUnits.find((u) => {
          if (args.where?.id && u.id !== args.where.id) {return false;}
          if (args.where?.organizationId && u.organizationId !== args.where.organizationId) {return false;}
          if (args.where?.type && u.type !== args.where.type) {return false;}
          if (args.where?.parentId !== undefined && u.parentId !== args.where.parentId) {return false;}
          return true;
        });
        return Promise.resolve(found ?? null);
      }),
      findUnique: vi.fn().mockImplementation((args: { where: { id: string } }) => {
        return Promise.resolve(orgUnits.find((u) => u.id === args.where.id) ?? null);
      }),
      create: vi.fn().mockImplementation((args: { data: any }) => {
        const created = { id: "unit-new", ...args.data, createdAt: new Date().toISOString(), updatedAt: new Date().toISOString() };
        orgUnits.push(created);
        return Promise.resolve(created);
      }),
      update: vi.fn().mockImplementation((args: { where: { id: string }; data: any }) => {
        const idx = orgUnits.findIndex((u) => u.id === args.where.id);
        if (idx !== -1) {orgUnits[idx] = { ...orgUnits[idx], ...args.data };}
        return Promise.resolve(orgUnits[idx] ?? null);
      }),
      delete: vi.fn().mockImplementation((args: { where: { id: string } }) => {
        const idx = orgUnits.findIndex((u) => u.id === args.where.id);
        if (idx !== -1) {orgUnits.splice(idx, 1);}
        return Promise.resolve(null);
      }),
      count: vi.fn().mockImplementation((args: { where?: any } = {}) => {
        if (args.where?.parentId) {
          return Promise.resolve(orgUnits.filter((u) => u.parentId === args.where.parentId).length);
        }
        return Promise.resolve(0);
      }),
    },
    team: {
      findUnique: vi.fn().mockImplementation((args: { where: { id: string } }) => {
        return Promise.resolve(teams.find((t) => t.id === args.where.id) ?? null);
      }),
    },
    membership: {
      count: vi.fn().mockImplementation((args: { where?: any } = {}) => {
        if (args.where?.orgUnitId) {
          return Promise.resolve(memberships.filter((m) => m.orgUnitId === args.where.orgUnitId).length);
        }
        return Promise.resolve(0);
      }),
    },
  } as any;
}

function adminToken() {
  return createHash("sha256").update("sk-admin").digest("hex");
}

describe("GET /admin/org-units", () => {
  it("returns 401 without a bearer token", async () => {
    const app = Fastify();
    registerAdminOrgUnitsRoute(app, { db: fakeDb() });

    const res = await app.inject({ method: "GET", url: "/admin/org-units" });
    expect(res.statusCode).toBe(401);
  });

  it("lists org units as a tree", async () => {
    const db = fakeDb({
      apiKey: { id: "key-1", keyHash: adminToken(), isActive: true, isAdmin: true },
      organizations: [{ id: "org-1", name: "Acme" }],
      orgUnits: [
        { id: "root-1", organizationId: "org-1", type: "root", name: "Acme", parentId: null, teamId: null, externalId: null, createdAt: new Date().toISOString(), updatedAt: new Date().toISOString() },
        { id: "bu-1", organizationId: "org-1", type: "business_unit", name: "Engineering", parentId: "root-1", teamId: null, externalId: null, createdAt: new Date().toISOString(), updatedAt: new Date().toISOString() },
      ],
    });
    const app = Fastify();
    registerAdminOrgUnitsRoute(app, { db });

    const res = await app.inject({
      method: "GET",
      url: "/admin/org-units?format=tree",
      headers: { authorization: "Bearer sk-admin" },
    });

    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.format).toBe("tree");
    expect(body.data).toHaveLength(1);
    expect(body.data[0].children).toHaveLength(1);
  });

  it("returns 403 for a valid non-admin key", async () => {
    const db = fakeDb({ apiKey: { id: "key-1", keyHash: adminToken(), isActive: true } });
    const app = Fastify();
    registerAdminOrgUnitsRoute(app, { db });

    const res = await app.inject({
      method: "GET",
      url: "/admin/org-units",
      headers: { authorization: "Bearer sk-admin" },
    });

    expect(res.statusCode).toBe(403);
  });
});

describe("POST /admin/org-units", () => {
  it("returns 400 for missing fields", async () => {
    const db = fakeDb({ apiKey: { id: "key-1", keyHash: adminToken(), isActive: true, isAdmin: true } });
    const app = Fastify();
    registerAdminOrgUnitsRoute(app, { db });

    const res = await app.inject({
      method: "POST",
      url: "/admin/org-units",
      headers: { authorization: "Bearer sk-admin" },
      payload: {},
    });

    expect(res.statusCode).toBe(400);
  });

  it("creates a root org unit", async () => {
    const db = fakeDb({
      apiKey: { id: "key-1", keyHash: adminToken(), isActive: true, isAdmin: true },
      organizations: [{ id: "org-1", name: "Acme" }],
    });
    const app = Fastify();
    registerAdminOrgUnitsRoute(app, { db });

    const res = await app.inject({
      method: "POST",
      url: "/admin/org-units",
      headers: { authorization: "Bearer sk-admin" },
      payload: { organizationId: "org-1", type: "root", name: "Acme" },
    });

    expect(res.statusCode).toBe(201);
    expect(res.json().type).toBe("root");
  });

  it("rejects a second root org unit", async () => {
    const db = fakeDb({
      apiKey: { id: "key-1", keyHash: adminToken(), isActive: true, isAdmin: true },
      organizations: [{ id: "org-1", name: "Acme" }],
      orgUnits: [{ id: "root-1", organizationId: "org-1", type: "root", name: "Acme", parentId: null, teamId: null, externalId: null }],
    });
    const app = Fastify();
    registerAdminOrgUnitsRoute(app, { db });

    const res = await app.inject({
      method: "POST",
      url: "/admin/org-units",
      headers: { authorization: "Bearer sk-admin" },
      payload: { organizationId: "org-1", type: "root", name: "Acme 2" },
    });

    expect(res.statusCode).toBe(409);
  });

  it("rejects team org unit without a teamId", async () => {
    const db = fakeDb({
      apiKey: { id: "key-1", keyHash: adminToken(), isActive: true, isAdmin: true },
      organizations: [{ id: "org-1", name: "Acme" }],
    });
    const app = Fastify();
    registerAdminOrgUnitsRoute(app, { db });

    const res = await app.inject({
      method: "POST",
      url: "/admin/org-units",
      headers: { authorization: "Bearer sk-admin" },
      payload: { organizationId: "org-1", type: "team", name: "Platform" },
    });

    expect(res.statusCode).toBe(400);
  });
});

describe("DELETE /admin/org-units/:id", () => {
  it("returns 409 when children exist", async () => {
    const db = fakeDb({
      apiKey: { id: "key-1", keyHash: adminToken(), isActive: true, isAdmin: true },
      orgUnits: [
        { id: "root-1", organizationId: "org-1", type: "root", name: "Acme", parentId: null, teamId: null, externalId: null },
        { id: "bu-1", organizationId: "org-1", type: "business_unit", name: "Engineering", parentId: "root-1", teamId: null, externalId: null },
      ],
    });
    const app = Fastify();
    registerAdminOrgUnitsRoute(app, { db });

    const res = await app.inject({
      method: "DELETE",
      url: "/admin/org-units/root-1",
      headers: { authorization: "Bearer sk-admin" },
    });

    expect(res.statusCode).toBe(409);
  });

  it("deletes a leaf org unit", async () => {
    const db = fakeDb({
      apiKey: { id: "key-1", keyHash: adminToken(), isActive: true, isAdmin: true },
      orgUnits: [{ id: "bu-1", organizationId: "org-1", type: "business_unit", name: "Engineering", parentId: "root-1", teamId: null, externalId: null }],
    });
    const app = Fastify();
    registerAdminOrgUnitsRoute(app, { db });

    const res = await app.inject({
      method: "DELETE",
      url: "/admin/org-units/bu-1",
      headers: { authorization: "Bearer sk-admin" },
    });

    expect(res.statusCode).toBe(204);
  });
});
