import { createHash } from "node:crypto";
import { describe, it, expect, vi } from "vitest";
import { buildProviders, buildPluginRegistry, ensureBootstrapAdminKey, loadDbProviders } from "../src/bootstrap";
import { encryptConfig } from "../src/credentials/encryption";
import type { Deployment } from "../src/types/deployment";
import type { HttpClient } from "../src/http/httpClient";

const TEST_KEY = "0".repeat(64);

describe("buildProviders", () => {
  it("instantiates only the providers whose credentials are present, warning about the rest", () => {
    const logger = { warn: vi.fn() };
    const registry = buildPluginRegistry({}, { fetch: vi.fn() } as unknown as HttpClient);
    const providers = buildProviders(registry, { OPENAI_API_KEY: "sk-test" }, logger);

    expect(Array.from(providers.keys())).toEqual(["env:openai"]);
    expect(logger.warn).toHaveBeenCalledWith(expect.stringContaining("anthropic"));
    expect(logger.warn).toHaveBeenCalledWith(expect.stringContaining("bedrock"));
    expect(logger.warn).toHaveBeenCalledWith(expect.stringContaining("azure-openai"));
    expect(logger.warn).toHaveBeenCalledWith(expect.stringContaining("gemini"));
  });

  it("instantiates every provider when all credentials are present", () => {
    const logger = { warn: vi.fn() };
    const registry = buildPluginRegistry({}, { fetch: vi.fn() } as unknown as HttpClient);
    const providers = buildProviders(
      registry,
      {
        OPENAI_API_KEY: "sk-test",
        ANTHROPIC_API_KEY: "sk-ant",
        AWS_ACCESS_KEY_ID: "aki",
        AWS_SECRET_ACCESS_KEY: "sak",
        AWS_REGION: "us-east-1",
        AZURE_OPENAI_API_KEY: "azkey",
        AZURE_OPENAI_RESOURCE_NAME: "resource",
        AZURE_OPENAI_API_VERSION: "2024-01-01",
        GEMINI_API_KEY: "gemini-key",
      },
      logger,
    );

    expect(Array.from(providers.keys()).sort()).toEqual([
      "env:anthropic",
      "env:azure-openai",
      "env:bedrock",
      "env:gemini",
      "env:openai",
    ]);
    expect(logger.warn).not.toHaveBeenCalled();
  });

  it("returns an empty map instead of throwing when no provider has its credentials configured", () => {
    const registry = buildPluginRegistry({}, { fetch: vi.fn() } as unknown as HttpClient);
    const providers = buildProviders(registry, {}, { warn: vi.fn() });
    expect(providers.size).toBe(0);
  });

  it("skips bedrock when only some of its required env vars are present", () => {
    const logger = { warn: vi.fn() };
    const registry = buildPluginRegistry({}, { fetch: vi.fn() } as unknown as HttpClient);
    const providers = buildProviders(registry, { OPENAI_API_KEY: "sk-test", AWS_ACCESS_KEY_ID: "aki" }, logger);

    expect(providers.has("env:bedrock")).toBe(false);
    expect(logger.warn).toHaveBeenCalledWith(expect.stringContaining("bedrock"));
  });

  it("wires an injected HTTP client through to providers", async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(
        JSON.stringify({
          id: "chatcmpl-1",
          object: "chat.completion",
          model: "gpt-4o",
          choices: [{ index: 0, message: { role: "assistant", content: "hi" }, finish_reason: "stop" }],
          usage: { prompt_tokens: 1, completion_tokens: 1, total_tokens: 2 },
        }),
        { status: 200, headers: { "content-type": "application/json" } },
      ),
    );
    const httpClient: HttpClient = { fetch: fetchMock };
    const registry = buildPluginRegistry({}, httpClient);
    const providers = buildProviders(registry, { OPENAI_API_KEY: "sk-test" }, { warn: vi.fn() });

    const deployment: Deployment = {
      id: "d1",
      modelName: "gpt-4o",
      provider: "openai",
      providerModelId: "gpt-4o",
      credentialsRef: "ref",
      weight: 1,
      isActive: true,
    };
    const openai = providers.get("env:openai")!;
    await openai.chatCompletion({ model: "gpt-4o", messages: [{ role: "user", content: "hello" }] }, deployment);

    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
});

describe("loadDbProviders", () => {
  it("decrypts each credential row and instantiates a provider keyed by credential id", async () => {
    const registry = buildPluginRegistry({}, { fetch: vi.fn() } as unknown as HttpClient);
    const { ciphertext, iv, authTag } = encryptConfig({ apiKey: "sk-db" }, TEST_KEY);
    const db = {
      providerCredential: {
        findMany: vi.fn().mockResolvedValue([
          { id: "cred-1", provider: "openai", configCiphertext: ciphertext, configIv: iv, configAuthTag: authTag },
        ]),
      },
    } as any;

    const providers = await loadDbProviders(registry, db, TEST_KEY);

    expect(Array.from(providers.keys())).toEqual(["cred-1"]);
  });

  it("skips a row that fails to decrypt instead of throwing", async () => {
    const registry = buildPluginRegistry({}, { fetch: vi.fn() } as unknown as HttpClient);
    const db = {
      providerCredential: {
        findMany: vi.fn().mockResolvedValue([
          { id: "cred-bad", provider: "openai", configCiphertext: "garbage", configIv: "garbage", configAuthTag: "garbage" },
        ]),
      },
    } as any;

    const providers = await loadDbProviders(registry, db, TEST_KEY);

    expect(providers.size).toBe(0);
  });

  it("returns an empty map when keyHex is undefined, without querying the db", async () => {
    const registry = buildPluginRegistry({}, { fetch: vi.fn() } as unknown as HttpClient);
    const findMany = vi.fn();
    const db = { providerCredential: { findMany } } as any;

    const providers = await loadDbProviders(registry, db, undefined);

    expect(providers.size).toBe(0);
    expect(findMany).not.toHaveBeenCalled();
  });
});

describe("ensureBootstrapAdminKey", () => {
  it("does nothing when ADMIN_BOOTSTRAP_KEY is not set", async () => {
    const upsert = vi.fn();
    const db = { apiKey: { upsert } } as any;
    await ensureBootstrapAdminKey(db, {});
    expect(upsert).not.toHaveBeenCalled();
  });

  it("upserts an admin key by hash when ADMIN_BOOTSTRAP_KEY is set", async () => {
    const upsert = vi.fn().mockResolvedValue({});
    const db = { apiKey: { upsert } } as any;
    await ensureBootstrapAdminKey(db, { ADMIN_BOOTSTRAP_KEY: "sk-bootstrap" });

    const expectedHash = createHash("sha256").update("sk-bootstrap").digest("hex");
    expect(upsert).toHaveBeenCalledWith({
      where: { keyHash: expectedHash },
      update: { isAdmin: true, isActive: true },
      create: {
        keyHash: expectedHash,
        keyPrefix: "sk-boot",
        name: "bootstrap-admin",
        isAdmin: true,
        isActive: true,
      },
    });
  });
});

describe("buildPluginRegistry", () => {
  it("registers the webhook observability middleware when OBSERVABILITY_WEBHOOK_URL is set", () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response("ok", { status: 200 }));
    const registry = buildPluginRegistry(
      { OBSERVABILITY_WEBHOOK_URL: "https://example.com/webhook", OBSERVABILITY_WEBHOOK_HEADERS: '{"x-api-key":"secret"}' },
      { fetch: fetchMock } as unknown as HttpClient,
    );

    expect(registry.runOnResponse).toBeDefined();
  });
});
