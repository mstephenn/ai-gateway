import { describe, it, expect, vi } from "vitest";
import { createHash } from "node:crypto";
import Fastify from "fastify";
import { registerAdminMeRoute } from "../../../src/routes/admin/me";

function fakeDb(apiKey?: { id: string; keyHash: string; isActive: boolean; isAdmin?: boolean; teamId?: string; allowedModels?: string[] }) {
  return {
    apiKey: {
      findUnique: vi.fn().mockResolvedValue(apiKey ?? null),
    },
  } as any;
}

function token() {
  return createHash("sha256").update("sk-test").digest("hex");
}

describe("GET /admin/me", () => {
  it("returns 401 without a bearer token", async () => {
    const app = Fastify();
    registerAdminMeRoute(app, { db: fakeDb() });

    const res = await app.inject({ method: "GET", url: "/admin/me" });
    expect(res.statusCode).toBe(401);
  });

  it("returns the caller's identity for a valid non-admin key", async () => {
    const db = fakeDb({ id: "key-1", keyHash: token(), isActive: true, isAdmin: false, teamId: "team-1" });
    const app = Fastify();
    registerAdminMeRoute(app, { db });

    const res = await app.inject({ method: "GET", url: "/admin/me", headers: { authorization: "Bearer sk-test" } });

    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ apiKeyId: "key-1", isAdmin: false, teamId: "team-1", allowedModels: [] });
  });

  it("returns isAdmin true for an admin key", async () => {
    const db = fakeDb({ id: "key-1", keyHash: token(), isActive: true, isAdmin: true });
    const app = Fastify();
    registerAdminMeRoute(app, { db });

    const res = await app.inject({ method: "GET", url: "/admin/me", headers: { authorization: "Bearer sk-test" } });

    expect(res.json().isAdmin).toBe(true);
  });
});
