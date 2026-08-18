import { describe, it, expect, vi } from "vitest";
import { createOpenAIProvider } from "../../src/providers/openai";
import type { HttpClient } from "../../src/http/httpClient";
import type { Deployment } from "../../src/types/deployment";

const deployment: Deployment = {
  id: "d1",
  modelName: "text-embedding-3-small",
  provider: "openai",
  providerModelId: "text-embedding-3-small",
  credentialsRef: "unused-in-test",
  weight: 1,
  isActive: true,
};

describe("createOpenAIProvider embeddings", () => {
  it("passes the request through to OpenAI's embeddings endpoint", async () => {
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
    const provider = createOpenAIProvider(httpClient, "sk-test");

    const result = await provider.embeddings!(
      { model: "text-embedding-3-small", input: "hello", encoding_format: "float", dimensions: 3 },
      deployment,
    );

    expect(result).toEqual(fakeResponse);
    expect(fetchMock).toHaveBeenCalledWith(
      "https://api.openai.com/v1/embeddings",
      expect.objectContaining({
        method: "POST",
        headers: expect.objectContaining({ Authorization: "Bearer sk-test" }),
        body: expect.stringContaining("text-embedding-3-small"),
      }),
    );
    const body = JSON.parse(fetchMock.mock.calls[0][1].body);
    expect(body.input).toBe("hello");
    expect(body.encoding_format).toBe("float");
    expect(body.dimensions).toBe(3);
  });

  it("throws on a non-2xx response so the router's fallback logic can catch it", async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response("rate limited", { status: 429 }));
    const httpClient: HttpClient = { fetch: fetchMock };
    const provider = createOpenAIProvider(httpClient, "sk-test");

    await expect(
      provider.embeddings!({ model: "text-embedding-3-small", input: "hello" }, deployment),
    ).rejects.toThrow();
  });
});
