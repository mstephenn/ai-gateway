import { describe, it, expect, vi } from "vitest";
import { createAnthropicProvider } from "../../src/providers/anthropic";
import type { HttpClient } from "../../src/http/httpClient";
import type { Deployment } from "../../src/types/deployment";

const deployment: Deployment = {
  id: "d1",
  modelName: "claude-sonnet-4-5",
  provider: "anthropic",
  providerModelId: "claude-sonnet-4-5-20250929",
  credentialsRef: "unused-in-test",
  weight: 1,
  isActive: true,
};

describe("createAnthropicProvider", () => {
  it("extracts system messages and translates Anthropic's response into OpenAI shape", async () => {
    const anthropicResponse = {
      id: "msg_123",
      content: [{ type: "text", text: "hi there" }],
      stop_reason: "end_turn",
      usage: { input_tokens: 10, output_tokens: 3 },
    };
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(JSON.stringify(anthropicResponse), { status: 200 }),
    );
    const httpClient: HttpClient = { fetch: fetchMock };
    const provider = createAnthropicProvider(httpClient, "sk-ant-test");

    const result = await provider.chatCompletion(
      {
        model: "claude-sonnet-4-5",
        messages: [
          { role: "system", content: "be terse" },
          { role: "user", content: "hello" },
        ],
      },
      deployment,
    );

    expect(result.choices[0].message).toEqual({ role: "assistant", content: "hi there" });
    expect(result.choices[0].finish_reason).toBe("stop");
    expect(result.usage).toEqual({ prompt_tokens: 10, completion_tokens: 3, total_tokens: 13 });

    const [, init] = fetchMock.mock.calls[0];
    const sentBody = JSON.parse(init.body as string);
    expect(sentBody.system).toBe("be terse");
    expect(sentBody.messages).toEqual([{ role: "user", content: "hello" }]);
  });

  it("translates OpenAI tool format to Anthropic and back", async () => {
    const anthropicResponse = {
      id: "msg_456",
      content: [{ type: "tool_use", id: "tu_1", name: "get_weather", input: { city: "NYC" } }],
      stop_reason: "tool_use",
      usage: { input_tokens: 15, output_tokens: 8 },
    };
    const fetchMock = vi.fn().mockResolvedValue(new Response(JSON.stringify(anthropicResponse), { status: 200 }));
    const httpClient: HttpClient = { fetch: fetchMock };
    const provider = createAnthropicProvider(httpClient, "sk-ant-test");

    const tools = [{ type: "function" as const, function: { name: "get_weather", description: "Get weather", parameters: { type: "object" } } }];
    const result = await provider.chatCompletion(
      {
        model: "claude-sonnet-4-5",
        messages: [{ role: "user", content: "weather?" }],
        tools,
        tool_choice: { type: "function", function: { name: "get_weather" } },
      },
      deployment,
    );

    expect(result.choices[0].message.role).toBe("assistant");
    expect(result.choices[0].message.content).toBeNull();
    expect(result.choices[0].message.tool_calls).toEqual([
      { id: "tu_1", type: "function", function: { name: "get_weather", arguments: '{"city":"NYC"}' } },
    ]);
    expect(result.choices[0].finish_reason).toBe("tool_calls");

    const [, init] = fetchMock.mock.calls[0];
    const sentBody = JSON.parse(init.body as string);
    expect(sentBody.tools).toEqual([
      { name: "get_weather", description: "Get weather", input_schema: { type: "object" } },
    ]);
    expect(sentBody.tool_choice).toEqual({ type: "tool", name: "get_weather" });
  });

  it("translates tool result messages back to Anthropic tool_result blocks", async () => {
    const anthropicResponse = {
      id: "msg_789",
      content: [{ type: "text", text: "It is sunny." }],
      stop_reason: "end_turn",
      usage: { input_tokens: 20, output_tokens: 3 },
    };
    const fetchMock = vi.fn().mockResolvedValue(new Response(JSON.stringify(anthropicResponse), { status: 200 }));
    const httpClient: HttpClient = { fetch: fetchMock };
    const provider = createAnthropicProvider(httpClient, "sk-ant-test");

    const result = await provider.chatCompletion(
      {
        model: "claude-sonnet-4-5",
        messages: [
          { role: "user", content: "weather?" },
          {
            role: "assistant",
            content: null,
            tool_calls: [{ id: "tu_1", type: "function", function: { name: "get_weather", arguments: '{"city":"NYC"}' } }],
          },
          { role: "tool", content: '{"temp":72}', tool_call_id: "tu_1" },
        ],
      },
      deployment,
    );

    expect(result.choices[0].message.content).toBe("It is sunny.");
    const [, init] = fetchMock.mock.calls[0];
    const sentBody = JSON.parse(init.body as string);
    expect(sentBody.messages).toEqual([
      { role: "user", content: "weather?" },
      {
        role: "assistant",
        content: [{ type: "tool_use", id: "tu_1", name: "get_weather", input: { city: "NYC" } }],
      },
      { role: "user", content: [{ type: "tool_result", tool_use_id: "tu_1", content: '{"temp":72}' }] },
    ]);
  });

  it("throws on a non-2xx response", async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response("overloaded", { status: 529 }));
    const httpClient: HttpClient = { fetch: fetchMock };
    const provider = createAnthropicProvider(httpClient, "sk-ant-test");

    await expect(
      provider.chatCompletion({ model: "claude-sonnet-4-5", messages: [{ role: "user", content: "hi" }] }, deployment),
    ).rejects.toThrow();
  });
});
