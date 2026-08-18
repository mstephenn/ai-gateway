import { describe, it, expect, vi } from "vitest";
import { createHash } from "node:crypto";
import Fastify from "fastify";
import { registerAdminCredentialsRoute } from "../../../src/routes/admin/credentials";
import { encryptConfig } from "../../../src/credentials/encryption";
import { buildPluginRegistry } from "../../../src/bootstrap";
import type { HttpClient } from "../../../src/http/httpClient";

const TEST_KEY = "0".repeat(64);

function adminToken() {
  return createHash("sha256").update("sk-admin").digest("hex");
}

function fakeDb(seed: {
  apiKey?: { id: string; keyHash: string; isActive: boolean; isAdmin?: boolean };
  credentials?: { id: string; provider: string; name: string; configCiphertext: string; configIv: string; configAuthTag: string }[];
  deployments?: { id: string; credentialsRef: string }[];
} = {}) {
  const credentials = seed.credentials ?? [];
  return {
    apiKey: { findUnique: vi.fn().mockResolvedValue(seed.apiKey ?? null) },
    providerCredential: {
      findMany: vi.fn().mockResolvedValue(credentials),
      findUnique: vi.fn().mockImplementation((args: { where: { id: string } }) =>
        Promise.resolve(credentials.find((c) => c.id === args.where.id) ?? null),
      ),
      create: vi.fn().mockImplementation((args: { data: any }) => {
        const created = { id: "cred-new", createdAt: new Date(), updatedAt: new Date(), ...args.data };
        credentials.push(created);
        return Promise.resolve(created);
      }),
      update: vi.fn().mockImplementation((args: { where: { id: string }; data: any }) => {
        const idx = credentials.findIndex((c) => c.id === args.where.id);
        if (idx !== -1) {credentials[idx] = { ...credentials[idx], ...args.data };}
        return Promise.resolve(credentials[idx]);
      }),
      delete: vi.fn().mockImplementation((args: { where: { id: string } }) => {
        const idx = credentials.findIndex((c) => c.id === args.where.id);
        if (idx !== -1) {credentials.splice(idx, 1);}
        return Promise.resolve({});
      }),
    },
    deployment: {
      findMany: vi.fn().mockImplementation((args: { where: { credentialsRef: string } }) =>
        Promise.resolve((seed.deployments ?? []).filter((d) => d.credentialsRef === args.where.credentialsRef)),
      ),
    },
  } as any;
}

function fakeRegistry() {
  return buildPluginRegistry({}, { fetch: vi.fn() } as unknown as HttpClient);
}

describe("admin/credentials", () => {
  it("returns 401 without a bearer token", async () => {
    const app = Fastify();
    registerAdminCredentialsRoute(app, { db: fakeDb(), registry: fakeRegistry(), providers: new Map(), encryptionKey: TEST_KEY });
    const res = await app.inject({ method: "GET", url: "/admin/credentials" });
    expect(res.statusCode).toBe(401);
  });

  it("returns 403 for a valid non-admin key", async () => {
    const db = fakeDb({ apiKey: { id: "key-1", keyHash: adminToken(), isActive: true } });
    const app = Fastify();
    registerAdminCredentialsRoute(app, { db, registry: fakeRegistry(), providers: new Map(), encryptionKey: TEST_KEY });
    const res = await app.inject({ method: "GET", url: "/admin/credentials", headers: { authorization: "Bearer sk-admin" } });
    expect(res.statusCode).toBe(403);
  });

  it("creates a credential, never returning the secret, and adds it to the live providers map", async () => {
    const db = fakeDb({ apiKey: { id: "key-1", keyHash: adminToken(), isActive: true, isAdmin: true } });
    const providers = new Map();
    const app = Fastify();
    registerAdminCredentialsRoute(app, { db, registry: fakeRegistry(), providers, encryptionKey: TEST_KEY });

    const res = await app.inject({
      method: "POST",
      url: "/admin/credentials",
      headers: { authorization: "Bearer sk-admin" },
      payload: { provider: "openai", name: "Prod OpenAI", config: { apiKey: "sk-secret" } },
    });

    expect(res.statusCode).toBe(201);
    const body = res.json();
    expect(body).not.toHaveProperty("config");
    expect(body).not.toHaveProperty("configCiphertext");
    expect(providers.has("cred-new")).toBe(true);
  });

  it("lists credentials without secret material", async () => {
    const { ciphertext, iv, authTag } = encryptConfig({ apiKey: "x" }, TEST_KEY);
    const db = fakeDb({
      apiKey: { id: "key-1", keyHash: adminToken(), isActive: true, isAdmin: true },
      credentials: [{ id: "cred-1", provider: "openai", name: "Prod", configCiphertext: ciphertext, configIv: iv, configAuthTag: authTag }],
    });
    const app = Fastify();
    registerAdminCredentialsRoute(app, { db, registry: fakeRegistry(), providers: new Map(), encryptionKey: TEST_KEY });

    const res = await app.inject({ method: "GET", url: "/admin/credentials", headers: { authorization: "Bearer sk-admin" } });
    expect(res.json().data).toEqual([{ id: "cred-1", provider: "openai", name: "Prod" }]);
  });

  it("returns 409 when deleting a credential still referenced by a deployment", async () => {
    const { ciphertext, iv, authTag } = encryptConfig({ apiKey: "x" }, TEST_KEY);
    const db = fakeDb({
      apiKey: { id: "key-1", keyHash: adminToken(), isActive: true, isAdmin: true },
      credentials: [{ id: "cred-1", provider: "openai", name: "Prod", configCiphertext: ciphertext, configIv: iv, configAuthTag: authTag }],
      deployments: [{ id: "dep-1", credentialsRef: "cred-1" }],
    });
    const app = Fastify();
    registerAdminCredentialsRoute(app, { db, registry: fakeRegistry(), providers: new Map(), encryptionKey: TEST_KEY });

    const res = await app.inject({ method: "DELETE", url: "/admin/credentials/cred-1", headers: { authorization: "Bearer sk-admin" } });
    expect(res.statusCode).toBe(409);
  });

  it("deletes an unreferenced credential and removes it from the live providers map", async () => {
    const { ciphertext, iv, authTag } = encryptConfig({ apiKey: "x" }, TEST_KEY);
    const db = fakeDb({
      apiKey: { id: "key-1", keyHash: adminToken(), isActive: true, isAdmin: true },
      credentials: [{ id: "cred-1", provider: "openai", name: "Prod", configCiphertext: ciphertext, configIv: iv, configAuthTag: authTag }],
    });
    const providers = new Map([["cred-1", {} as any]]);
    const app = Fastify();
    registerAdminCredentialsRoute(app, { db, registry: fakeRegistry(), providers, encryptionKey: TEST_KEY });

    const res = await app.inject({ method: "DELETE", url: "/admin/credentials/cred-1", headers: { authorization: "Bearer sk-admin" } });
    expect(res.statusCode).toBe(204);
    expect(providers.has("cred-1")).toBe(false);
  });

  it("rejects a config missing required keys for the provider", async () => {
    const db = fakeDb({ apiKey: { id: "key-1", keyHash: adminToken(), isActive: true, isAdmin: true } });
    const app = Fastify();
    registerAdminCredentialsRoute(app, { db, registry: fakeRegistry(), providers: new Map(), encryptionKey: TEST_KEY });

    const res = await app.inject({
      method: "POST",
      url: "/admin/credentials",
      headers: { authorization: "Bearer sk-admin" },
      payload: { provider: "bedrock", name: "Bad", config: { apiKey: "not-what-bedrock-needs" } },
    });
    expect(res.statusCode).toBe(400);
  });
});
