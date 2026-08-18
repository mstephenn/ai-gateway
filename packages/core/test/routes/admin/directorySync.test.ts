import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { createHash } from "node:crypto";
import Fastify from "fastify";
import { registerAdminDirectorySyncRoute } from "../../../src/routes/admin/directorySync";

function fakeDb(seed: {
  organizations?: any[];
  configs?: any[];
  runs?: any[];
  changes?: any[];
  users?: any[];
  memberships?: any[];
  apiKey?: { id: string; keyHash: string; isActive: boolean; isAdmin?: boolean };
} = {}) {
  const configs = seed.configs ?? [];
  const runs = seed.runs ?? [];
  const changes = seed.changes ?? [];
  const users = seed.users ?? [];
  const memberships = seed.memberships ?? [];

  return {
    apiKey: {
      findUnique: vi.fn().mockResolvedValue(seed.apiKey ?? null),
    },
    organization: {
      findUnique: vi.fn().mockImplementation((args: { where: { id: string } }) => {
        return Promise.resolve((seed.organizations ?? []).find((o) => o.id === args.where.id) ?? null);
      }),
    },
    directorySyncConfig: {
      findMany: vi.fn().mockResolvedValue(configs),
      findUnique: vi.fn().mockImplementation((args: { where: { id: string } }) => {
        return Promise.resolve(configs.find((c) => c.id === args.where.id) ?? null);
      }),
      create: vi.fn().mockImplementation((args: { data: any }) => {
        const created = { id: "config-1", ...args.data, createdAt: new Date().toISOString(), updatedAt: new Date().toISOString() };
        configs.push(created);
        return Promise.resolve(created);
      }),
      update: vi.fn().mockImplementation((args: { where: { id: string }; data: any }) => {
        const idx = configs.findIndex((c) => c.id === args.where.id);
        if (idx !== -1) {configs[idx] = { ...configs[idx], ...args.data };}
        return Promise.resolve(configs[idx] ?? null);
      }),
    },
    directorySyncRun: {
      create: vi.fn().mockImplementation((args: { data: any }) => {
        const created = { id: "run-1", ...args.data, createdAt: new Date().toISOString(), summary: {} };
        runs.push(created);
        return Promise.resolve(created);
      }),
      findUnique: vi.fn().mockImplementation((args: { where: { id: string } }) => {
        return Promise.resolve(runs.find((r) => r.id === args.where.id) ?? null);
      }),
      update: vi.fn().mockImplementation((args: { where: { id: string }; data: any }) => {
        const idx = runs.findIndex((r) => r.id === args.where.id);
        if (idx !== -1) {runs[idx] = { ...runs[idx], ...args.data };}
        return Promise.resolve(runs[idx] ?? null);
      }),
    },
    directorySyncChange: {
      findMany: vi.fn().mockResolvedValue(changes),
      create: vi.fn().mockImplementation((args: { data: any }) => {
        const created = { id: `change-${changes.length + 1}`, ...args.data, createdAt: new Date().toISOString() };
        changes.push(created);
        return Promise.resolve(created);
      }),
    },
    user: {
      findMany: vi.fn().mockResolvedValue(users),
      findUnique: vi.fn().mockImplementation((args: { where: { email?: string; id?: string } }) => {
        if (args.where.email) {return Promise.resolve(users.find((u) => u.email === args.where.email) ?? null);}
        return Promise.resolve(users.find((u) => u.id === args.where.id) ?? null);
      }),
      create: vi.fn().mockImplementation((args: { data: any }) => {
        const created = { id: `user-${users.length + 1}`, ...args.data, createdAt: new Date().toISOString(), updatedAt: new Date().toISOString() };
        users.push(created);
        return Promise.resolve(created);
      }),
      update: vi.fn().mockImplementation((args: { where: { id: string }; data: any }) => {
        const idx = users.findIndex((u) => u.id === args.where.id);
        if (idx !== -1) {users[idx] = { ...users[idx], ...args.data };}
        return Promise.resolve(users[idx] ?? null);
      }),
    },
    membership: {
      findUnique: vi.fn().mockResolvedValue(null),
      upsert: vi.fn().mockImplementation((args: any) => {
        const existing = memberships.find(
          (m) => m.userId === args.where.userId_orgUnitId.userId && m.orgUnitId === args.where.userId_orgUnitId.orgUnitId,
        );
        if (existing) {
          existing.roleId = args.update.roleId;
          return Promise.resolve(existing);
        }
        const created = { id: `mem-${memberships.length + 1}`, ...args.create, createdAt: new Date().toISOString(), updatedAt: new Date().toISOString() };
        memberships.push(created);
        return Promise.resolve(created);
      }),
    },
  } as any;
}

function adminToken() {
  return createHash("sha256").update("sk-admin").digest("hex");
}

describe("Directory sync admin routes", () => {
  let originalFetch: typeof fetch;

  beforeEach(() => {
    originalFetch = globalThis.fetch;
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
    delete process.env.AZURE_AD_SECRET;
  });

  it("creates and lists a directory sync config", async () => {
    const db = fakeDb({
      apiKey: { id: "key-1", keyHash: adminToken(), isActive: true, isAdmin: true },
      organizations: [{ id: "org-1", name: "Acme" }],
    });
    const app = Fastify();
    registerAdminDirectorySyncRoute(app, { db });

    const createRes = await app.inject({
      method: "POST",
      url: "/admin/directory-sync/config",
      headers: { authorization: "Bearer sk-admin" },
      payload: {
        organizationId: "org-1",
        provider: "azure_ad",
        tenantId: "tenant-1",
        clientId: "client-1",
        clientSecretRef: "AZURE_AD_SECRET",
        syncMode: "preview",
        groupMappings: {
          "group-1": { orgUnitId: "unit-1", roleId: "role-1" },
        },
      },
    });

    expect(createRes.statusCode).toBe(201);
    const created = createRes.json();
    expect(created.provider).toBe("azure_ad");

    const listRes = await app.inject({
      method: "GET",
      url: "/admin/directory-sync/config",
      headers: { authorization: "Bearer sk-admin" },
    });

    expect(listRes.statusCode).toBe(200);
    expect(listRes.json().data).toHaveLength(1);
  });

  it("runs a directory sync preview and returns changes", async () => {
    process.env.AZURE_AD_SECRET = "super-secret";

    const mockFetch = vi.fn().mockImplementation((url: string | URL) => {
      const urlString = String(url);
      if (urlString.includes("oauth2/v2.0/token")) {
        return Promise.resolve(
          new Response(JSON.stringify({ access_token: "token-1" }), { status: 200, headers: { "content-type": "application/json" } }),
        );
      }
      if (urlString.includes("/users")) {
        return Promise.resolve(
          new Response(
            JSON.stringify({
              value: [
                { id: "dir-user-1", displayName: "Alice", mail: "alice@example.com", userPrincipalName: "alice@example.com" },
              ],
            }),
            { status: 200, headers: { "content-type": "application/json" } },
          ),
        );
      }
      if (urlString.includes("/groups?")) {
        return Promise.resolve(
          new Response(JSON.stringify({ value: [{ id: "group-1", displayName: "Engineering" }] }), {
            status: 200,
            headers: { "content-type": "application/json" },
          }),
        );
      }
      if (urlString.includes("/members")) {
        return Promise.resolve(
          new Response(JSON.stringify({ value: [{ id: "dir-user-1" }] }), {
            status: 200,
            headers: { "content-type": "application/json" },
          }),
        );
      }
      return Promise.resolve(new Response(JSON.stringify({}), { status: 200 }));
    });
    globalThis.fetch = mockFetch as any;

    const db = fakeDb({
      apiKey: { id: "key-1", keyHash: adminToken(), isActive: true, isAdmin: true },
      organizations: [{ id: "org-1", name: "Acme" }],
      configs: [
        {
          id: "config-1",
          organizationId: "org-1",
          provider: "azure_ad",
          tenantId: "tenant-1",
          clientId: "client-1",
          clientSecretRef: "AZURE_AD_SECRET",
          syncMode: "preview",
          groupMappings: { "group-1": { orgUnitId: "unit-1", roleId: "role-1" } },
        },
      ],
    });
    const app = Fastify();
    registerAdminDirectorySyncRoute(app, { db });

    const runRes = await app.inject({
      method: "POST",
      url: "/admin/directory-sync/config/config-1/run",
      headers: { authorization: "Bearer sk-admin" },
    });

    expect(runRes.statusCode).toBe(200);
    const runBody = runRes.json();
    expect(runBody.status).toBe("completed");
    expect(runBody.changesCount).toBeGreaterThan(0);

    const changesRes = await app.inject({
      method: "GET",
      url: `/admin/directory-sync/runs/${runBody.runId}/changes`,
      headers: { authorization: "Bearer sk-admin" },
    });

    expect(changesRes.statusCode).toBe(200);
    expect(changesRes.json().data.length).toBe(runBody.changesCount);
  });

  it("returns 403 for a valid non-admin key", async () => {
    const db = fakeDb({ apiKey: { id: "key-1", keyHash: adminToken(), isActive: true } });
    const app = Fastify();
    registerAdminDirectorySyncRoute(app, { db });

    const res = await app.inject({
      method: "GET",
      url: "/admin/directory-sync/config",
      headers: { authorization: "Bearer sk-admin" },
    });

    expect(res.statusCode).toBe(403);
  });
});
