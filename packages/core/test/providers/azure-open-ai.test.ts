import { describe, it, expect, vi } from "vitest";
import { createAzureOpenAIProvider } from "../../src/providers/azure-open-ai";
import type { HttpClient } from "../../src/http/httpClient";
import type { Deployment } from "../../src/types/deployment";

const deployment: Deployment = {
  id: "d1",
  modelName: "gpt-4o",
  provider: "azure-openai",
  providerModelId: "my-azure-deployment-name",
  credentialsRef: "unused-in-test",
  weight: 1,
  isActive: true,
};

describe("createAzureOpenAIProvider", () => {
  it("calls the Azure-specific URL shape with api-key header and returns the response unchanged", async () => {
    const fakeResponse = {
      id: "chatcmpl-azure-1",
      object: "chat.completion",
      model: "gpt-4o",
      choices: [{ index: 0, message: { role: "assistant", content: "hi" }, finish_reason: "stop" }],
      usage: { prompt_tokens: 5, completion_tokens: 2, total_tokens: 7 },
    };
    const fetchMock = vi.fn().mockResolvedValue(new Response(JSON.stringify(fakeResponse), { status: 200 }));
    const httpClient: HttpClient = { fetch: fetchMock };
    const provider = createAzureOpenAIProvider(httpClient, {
      apiKey: "azure-key",
      resourceName: "my-resource",
      apiVersion: "2024-06-01",
    });

    const result = await provider.chatCompletion(
      { model: "gpt-4o", messages: [{ role: "user", content: "hello" }] },
      deployment,
    );

    expect(result).toEqual(fakeResponse);
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe(
      "https://my-resource.openai.azure.com/openai/deployments/my-azure-deployment-name/chat/completions?api-version=2024-06-01",
    );
    expect(init.headers["api-key"]).toBe("azure-key");
  });

  it("forwards tools and tool_choice to the Azure deployment", async () => {
    const fakeResponse = {
      id: "chatcmpl-azure-1",
      object: "chat.completion",
      model: "gpt-4o",
      choices: [
        {
          index: 0,
          message: {
            role: "assistant",
            content: null,
            tool_calls: [
              { id: "call_1", type: "function", function: { name: "get_weather", arguments: '{"city":"NYC"}' } },
            ],
          },
          finish_reason: "tool_calls",
        },
      ],
      usage: { prompt_tokens: 5, completion_tokens: 2, total_tokens: 7 },
    };
    const fetchMock = vi.fn().mockResolvedValue(new Response(JSON.stringify(fakeResponse), { status: 200 }));
    const httpClient: HttpClient = { fetch: fetchMock };
    const provider = createAzureOpenAIProvider(httpClient, {
      apiKey: "azure-key",
      resourceName: "my-resource",
      apiVersion: "2024-06-01",
    });

    const tools = [{ type: "function" as const, function: { name: "get_weather", description: "Get weather", parameters: { type: "object" } } }];
    await provider.chatCompletion(
      { model: "gpt-4o", messages: [{ role: "user", content: "weather?" }], tools, tool_choice: "required" },
      deployment,
    );

    const body = JSON.parse(fetchMock.mock.calls[0][1].body);
    expect(body.tools).toEqual(tools);
    expect(body.tool_choice).toBe("required");
  });

  it("throws on a non-2xx response", async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response("bad request", { status: 400 }));
    const httpClient: HttpClient = { fetch: fetchMock };
    const provider = createAzureOpenAIProvider(httpClient, {
      apiKey: "azure-key",
      resourceName: "my-resource",
      apiVersion: "2024-06-01",
    });

    await expect(
      provider.chatCompletion({ model: "gpt-4o", messages: [{ role: "user", content: "hi" }] }, deployment),
    ).rejects.toThrow();
  });
});
