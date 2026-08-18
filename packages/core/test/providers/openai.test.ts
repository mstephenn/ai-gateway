import { describe, it, expect, vi } from "vitest";
import { createOpenAIProvider } from "../../src/providers/openai";
import type { HttpClient } from "../../src/http/httpClient";
import type { Deployment } from "../../src/types/deployment";

const deployment: Deployment = {
  id: "d1",
  modelName: "gpt-4o",
  provider: "openai",
  providerModelId: "gpt-4o",
  credentialsRef: "unused-in-test",
  weight: 1,
  isActive: true,
};

describe("createOpenAIProvider", () => {
  it("passes the request through to OpenAI's API and returns the response unchanged in shape", async () => {
    const fakeResponse = {
      id: "chatcmpl-123",
      object: "chat.completion",
      model: "gpt-4o",
      choices: [{ index: 0, message: { role: "assistant", content: "hi" }, finish_reason: "stop" }],
      usage: { prompt_tokens: 5, completion_tokens: 2, total_tokens: 7 },
    };
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(JSON.stringify(fakeResponse), { status: 200, headers: { "content-type": "application/json" } }),
    );
    const httpClient: HttpClient = { fetch: fetchMock };
    const provider = createOpenAIProvider(httpClient, "sk-test");

    const result = await provider.chatCompletion(
      { model: "gpt-4o", messages: [{ role: "user", content: "hello" }] },
      deployment,
    );

    expect(result).toEqual(fakeResponse);
    expect(fetchMock).toHaveBeenCalledWith(
      "https://api.openai.com/v1/chat/completions",
      expect.objectContaining({
        method: "POST",
        headers: expect.objectContaining({ Authorization: "Bearer sk-test" }),
      }),
    );
  });

  it("passes tools and tool_choice through to OpenAI's API", async () => {
    const fakeResponse = {
      id: "chatcmpl-123",
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
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(JSON.stringify(fakeResponse), { status: 200, headers: { "content-type": "application/json" } }),
    );
    const httpClient: HttpClient = { fetch: fetchMock };
    const provider = createOpenAIProvider(httpClient, "sk-test");

    const tools = [{ type: "function" as const, function: { name: "get_weather", description: "Get weather", parameters: { type: "object" } } }];
    const result = await provider.chatCompletion(
      { model: "gpt-4o", messages: [{ role: "user", content: "weather?" }], tools, tool_choice: "auto" },
      deployment,
    );

    expect(result).toEqual(fakeResponse);
    const body = JSON.parse(fetchMock.mock.calls[0][1].body);
    expect(body.tools).toEqual(tools);
    expect(body.tool_choice).toBe("auto");
  });

  it("throws on a non-2xx response so the router's fallback logic can catch it", async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response("rate limited", { status: 429 }));
    const httpClient: HttpClient = { fetch: fetchMock };
    const provider = createOpenAIProvider(httpClient, "sk-test");

    await expect(
      provider.chatCompletion({ model: "gpt-4o", messages: [{ role: "user", content: "hi" }] }, deployment),
    ).rejects.toThrow();
  });
});
