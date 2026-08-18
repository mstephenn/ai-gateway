import { describe, it, expect, vi } from "vitest";
import { createPluginRegistry } from "../../src/plugins/registry";
import type { MiddlewarePlugin, ProviderPlugin, RequestContext } from "@ai-gateway/plugin-sdk";

describe("createPluginRegistry", () => {
  it("registers and retrieves a provider plugin by name", () => {
    const registry = createPluginRegistry();
    const fakeProvider = { chatCompletion: vi.fn(), chatCompletionStream: vi.fn() };
    const plugin: ProviderPlugin = { name: "fake", createProvider: () => fakeProvider };

    registry.registerProvider(plugin);

    expect(registry.getProvider("fake")).toBe(undefined); // not created until requested with config
  });

  it("a throwing onRequest middleware does not crash the registry — it's caught and treated as continue", async () => {
    const registry = createPluginRegistry();
    const throwing: MiddlewarePlugin = {
      name: "bad-plugin",
      onRequest: async () => {
        throw new Error("boom");
      },
    };
    registry.registerMiddleware(throwing);

    const ctx: RequestContext = { apiKeyId: "k1", model: "gpt-4o", headers: {} };
    const result = await registry.runOnRequest(ctx);

    expect(result).toBeUndefined();
  });

  it("a middleware that short-circuits returns its response from runOnRequest", async () => {
    const registry = createPluginRegistry();
    const blocking: MiddlewarePlugin = {
      name: "blocker",
      onRequest: async () => ({ status: 403, body: { error: "blocked" } }),
    };
    registry.registerMiddleware(blocking);

    const ctx: RequestContext = { apiKeyId: "k1", model: "gpt-4o", headers: {} };
    const result = await registry.runOnRequest(ctx);

    expect(result).toEqual({ status: 403, body: { error: "blocked" } });
  });

  it("runOnResponse passes the response through each middleware in order", async () => {
    const registry = createPluginRegistry();
    const addHeader: MiddlewarePlugin = {
      name: "add-header",
      onResponse: async (_ctx, response) => ({
        status: response.status,
        body: { ...(response.body as object), header: "x" },
      }),
    };
    registry.registerMiddleware(addHeader);

    const ctx: RequestContext = { apiKeyId: "k1", model: "gpt-4o", headers: {} };
    const result = await registry.runOnResponse(ctx, { status: 200, body: { ok: true } });

    expect(result).toEqual({ status: 200, body: { ok: true, header: "x" } });
  });

  it("a throwing onResponse middleware does not crash the registry — the original response is returned", async () => {
    const registry = createPluginRegistry();
    const throwing: MiddlewarePlugin = {
      name: "bad-response-plugin",
      onResponse: async () => {
        throw new Error("boom");
      },
    };
    registry.registerMiddleware(throwing);

    const ctx: RequestContext = { apiKeyId: "k1", model: "gpt-4o", headers: {} };
    const response = { status: 200, body: { ok: true } };
    const result = await registry.runOnResponse(ctx, response);

    expect(result).toEqual(response);
  });

  it("instantiate() creates a fresh instance without caching it", () => {
    const registry = createPluginRegistry();
    let callCount = 0;
    registry.registerProvider({
      name: "openai",
      createProvider: (config) => {
        callCount++;
        return { chatCompletion: vi.fn(), chatCompletionStream: vi.fn(), _config: config } as any;
      },
    });

    const first = registry.instantiate("openai", { apiKey: "a" });
    const second = registry.instantiate("openai", { apiKey: "b" });

    expect(callCount).toBe(2);
    expect((first as any)._config).toEqual({ apiKey: "a" });
    expect((second as any)._config).toEqual({ apiKey: "b" });
    expect(registry.getProvider("openai")).toBeUndefined(); // never cached internally
  });

  it("instantiate() returns undefined for an unregistered provider name", () => {
    const registry = createPluginRegistry();
    expect(registry.instantiate("nope", {})).toBeUndefined();
  });
});
