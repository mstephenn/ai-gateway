import { describe, it, expect, vi } from "vitest";
import { createBedrockProvider } from "../../src/providers/bedrock";
import type { HttpClient } from "../../src/http/httpClient";
import type { Deployment } from "../../src/types/deployment";

const deployment: Deployment = {
  id: "d1",
  modelName: "claude-sonnet-4-5",
  provider: "bedrock",
  providerModelId: "us.anthropic.claude-sonnet-4-5-20250929-v1:0",
  credentialsRef: "unused-in-test",
  weight: 1,
  isActive: true,
};

describe("createBedrockProvider", () => {
  it("translates Bedrock's Anthropic-shaped response into OpenAI shape", async () => {
    const bedrockResponse = {
      content: [{ type: "text", text: "hi from bedrock" }],
      stop_reason: "end_turn",
      usage: { input_tokens: 4, output_tokens: 3 },
    };
    const fetchMock = vi.fn().mockResolvedValue(new Response(JSON.stringify(bedrockResponse), { status: 200 }));
    const httpClient: HttpClient = { fetch: fetchMock };
    const provider = createBedrockProvider(httpClient, {
      accessKeyId: "AKIA_TEST",
      secretAccessKey: "secret",
      region: "us-east-1",
    });

    const result = await provider.chatCompletion(
      { model: "claude-sonnet-4-5", messages: [{ role: "user", content: "hello" }] },
      deployment,
    );

    expect(result.choices[0].message.content).toBe("hi from bedrock");
    expect(result.usage).toEqual({ prompt_tokens: 4, completion_tokens: 3, total_tokens: 7 });
    const [url] = fetchMock.mock.calls[0];
    expect(url).toContain(encodeURIComponent(deployment.providerModelId));
  });

  it("translates tool calls using the Anthropic-compatible shape", async () => {
    const bedrockResponse = {
      content: [{ type: "tool_use", id: "tu_1", name: "get_weather", input: { city: "NYC" } }],
      stop_reason: "tool_use",
      usage: { input_tokens: 10, output_tokens: 5 },
    };
    const fetchMock = vi.fn().mockResolvedValue(new Response(JSON.stringify(bedrockResponse), { status: 200 }));
    const httpClient: HttpClient = { fetch: fetchMock };
    const provider = createBedrockProvider(httpClient, {
      accessKeyId: "AKIA_TEST",
      secretAccessKey: "secret",
      region: "us-east-1",
    });

    const tools = [{ type: "function" as const, function: { name: "get_weather", description: "Get weather", parameters: { type: "object" } } }];
    const result = await provider.chatCompletion(
      {
        model: "claude-sonnet-4-5",
        messages: [{ role: "user", content: "weather?" }],
        tools,
        tool_choice: "required",
      },
      deployment,
    );

    expect(result.choices[0].message.tool_calls).toEqual([
      { id: "tu_1", type: "function", function: { name: "get_weather", arguments: '{"city":"NYC"}' } },
    ]);
    expect(result.choices[0].finish_reason).toBe("tool_calls");

    const [, init] = fetchMock.mock.calls[0];
    const sentBody = JSON.parse(init.body as string);
    expect(sentBody.tools).toEqual([
      { name: "get_weather", description: "Get weather", input_schema: { type: "object" } },
    ]);
    expect(sentBody.tool_choice).toEqual({ type: "any" });
  });

  it("throws on a non-2xx response", async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response("throttled", { status: 429 }));
    const httpClient: HttpClient = { fetch: fetchMock };
    const provider = createBedrockProvider(httpClient, {
      accessKeyId: "AKIA_TEST",
      secretAccessKey: "secret",
      region: "us-east-1",
    });

    await expect(
      provider.chatCompletion({ model: "claude-sonnet-4-5", messages: [{ role: "user", content: "hi" }] }, deployment),
    ).rejects.toThrow();
  });
});
