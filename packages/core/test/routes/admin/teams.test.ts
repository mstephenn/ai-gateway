import { describe, it, expect, vi } from "vitest";
import { createHash } from "node:crypto";
import Fastify from "fastify";
import { registerAdminTeamsRoute } from "../../../src/routes/admin/teams";

function fakeDb(apiKey?: { id: string; keyHash: string; isActive: boolean; isAdmin?: boolean }, teams: { id: string; name: string; createdAt: Date }[] = []) {
  const allTeams = [...teams];
  return {
    apiKey: {
      findUnique: vi.fn().mockResolvedValue(apiKey ?? null),
    },
    team: {
      create: vi.fn().mockImplementation((args: { data: any }) => {
        const created = { id: "team-1", ...args.data, createdAt: new Date().toISOString() };
        allTeams.push(created);
        return Promise.resolve(created);
      }),
      findMany: vi.fn().mockResolvedValue(allTeams),
      findUnique: vi.fn().mockImplementation((args: { where: { id: string } }) => {
        return Promise.resolve(allTeams.find((t) => t.id === args.where.id) ?? null);
      }),
      update: vi.fn().mockImplementation((args: { where: { id: string }; data: any }) => {
        const idx = allTeams.findIndex((t) => t.id === args.where.id);
        if (idx !== -1) {allTeams[idx] = { ...allTeams[idx], ...args.data };}
        return Promise.resolve(allTeams[idx] ?? null);
      }),
    },
  } as any;
}

describe("POST /admin/teams", () => {
  it("returns 401 without a bearer token", async () => {
    const app = Fastify();
    registerAdminTeamsRoute(app, { db: fakeDb() });

    const res = await app.inject({ method: "POST", url: "/admin/teams", payload: { name: "Engineering" } });

    expect(res.statusCode).toBe(401);
  });

  it("returns 400 when name is missing", async () => {
    const hash = createHash("sha256").update("sk-admin").digest("hex");
    const db = fakeDb({ id: "key-1", keyHash: hash, isActive: true, isAdmin: true });
    const app = Fastify();
    registerAdminTeamsRoute(app, { db });

    const res = await app.inject({
      method: "POST",
      url: "/admin/teams",
      headers: { authorization: "Bearer sk-admin" },
      payload: {},
    });

    expect(res.statusCode).toBe(400);
  });

  it("creates and returns a team", async () => {
    const hash = createHash("sha256").update("sk-admin").digest("hex");
    const db = fakeDb({ id: "key-1", keyHash: hash, isActive: true, isAdmin: true });
    const app = Fastify();
    registerAdminTeamsRoute(app, { db });

    const res = await app.inject({
      method: "POST",
      url: "/admin/teams",
      headers: { authorization: "Bearer sk-admin" },
      payload: { name: "Engineering", budgetLimit: 100, allowedModels: ["gpt-4o"] },
    });

    expect(res.statusCode).toBe(201);
    expect(db.team.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ name: "Engineering", budgetLimit: 100, allowedModels: ["gpt-4o"] }),
      }),
    );
  });
});

describe("GET /admin/teams", () => {
  it("returns 401 without a bearer token", async () => {
    const app = Fastify();
    registerAdminTeamsRoute(app, { db: fakeDb() });

    const res = await app.inject({ method: "GET", url: "/admin/teams" });

    expect(res.statusCode).toBe(401);
  });

  it("lists teams", async () => {
    const hash = createHash("sha256").update("sk-admin").digest("hex");
    const teams = [{ id: "team-1", name: "Engineering", createdAt: new Date() }];
    const db = fakeDb({ id: "key-1", keyHash: hash, isActive: true, isAdmin: true }, teams);
    const app = Fastify();
    registerAdminTeamsRoute(app, { db });

    const res = await app.inject({
      method: "GET",
      url: "/admin/teams",
      headers: { authorization: "Bearer sk-admin" },
    });

    expect(res.statusCode).toBe(200);
    expect(res.json().data).toHaveLength(1);
  });

  it("returns 403 for a valid non-admin key", async () => {
    const hash = createHash("sha256").update("sk-admin").digest("hex");
    const db = fakeDb({ id: "key-1", keyHash: hash, isActive: true });
    const app = Fastify();
    registerAdminTeamsRoute(app, { db });

    const res = await app.inject({
      method: "GET",
      url: "/admin/teams",
      headers: { authorization: "Bearer sk-admin" },
    });

    expect(res.statusCode).toBe(403);
  });
});

describe("PATCH /admin/teams/:id", () => {
  it("updates a team", async () => {
    const hash = createHash("sha256").update("sk-admin").digest("hex");
    const db = fakeDb({ id: "key-1", keyHash: hash, isActive: true, isAdmin: true }, [
      { id: "team-1", name: "Engineering", createdAt: new Date() },
    ]);
    const app = Fastify();
    registerAdminTeamsRoute(app, { db });

    const res = await app.inject({
      method: "PATCH",
      url: "/admin/teams/team-1",
      headers: { authorization: "Bearer sk-admin" },
      payload: { name: "Eng", allowedModels: ["gpt-4o"] },
    });

    expect(res.statusCode).toBe(200);
    expect(res.json().name).toBe("Eng");
  });
});
