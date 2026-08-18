import { describe, it, expect, vi } from "vitest";
import { createAzureOpenAIProvider } from "../../src/providers/azure-open-ai";
import type { HttpClient } from "../../src/http/httpClient";
import type { Deployment } from "../../src/types/deployment";

const deployment: Deployment = {
  id: "d1",
  modelName: "text-embedding-3-small",
  provider: "azure-openai",
  providerModelId: "my-embedding-deployment",
  credentialsRef: "unused-in-test",
  weight: 1,
  isActive: true,
};

const config = {
  apiKey: "azure-key",
  resourceName: "test-resource",
  apiVersion: "2024-02-01",
};

describe("createAzureOpenAIProvider embeddings", () => {
  it("posts to the Azure embeddings deployment endpoint", async () => {
    const fakeResponse = {
      object: "list",
      data: [{ object: "embedding", embedding: [0.1, 0.2, 0.3], index: 0 }],
      model: "text-embedding-3-small",
      usage: { prompt_tokens: 2, total_tokens: 2 },
    };
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(JSON.stringify(fakeResponse), { status: 200, headers: { "content-type": "application/json" } }),
    );
    const httpClient: HttpClient = { fetch: fetchMock };
    const provider = createAzureOpenAIProvider(httpClient, config);

    const result = await provider.embeddings!(
      { model: "text-embedding-3-small", input: ["hello", "world"], encoding_format: "float" },
      deployment,
    );

    expect(result).toEqual(fakeResponse);
    expect(fetchMock).toHaveBeenCalledWith(
      "https://test-resource.openai.azure.com/openai/deployments/my-embedding-deployment/embeddings?api-version=2024-02-01",
      expect.objectContaining({
        method: "POST",
        headers: expect.objectContaining({ "api-key": "azure-key" }),
      }),
    );
    const body = JSON.parse(fetchMock.mock.calls[0][1].body);
    expect(body.input).toEqual(["hello", "world"]);
    expect(body.encoding_format).toBe("float");
  });

  it("throws on a non-2xx response so the router's fallback logic can catch it", async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response("rate limited", { status: 429 }));
    const httpClient: HttpClient = { fetch: fetchMock };
    const provider = createAzureOpenAIProvider(httpClient, config);

    await expect(
      provider.embeddings!({ model: "text-embedding-3-small", input: "hello" }, deployment),
    ).rejects.toThrow();
  });
});
