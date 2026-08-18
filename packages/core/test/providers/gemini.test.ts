import { describe, it, expect, vi } from "vitest";
import { createGeminiProvider } from "../../src/providers/gemini";
import type { HttpClient } from "../../src/http/httpClient";
import type { Deployment } from "../../src/types/deployment";

const deployment: Deployment = {
  id: "d1",
  modelName: "gemini-1.5-flash",
  provider: "gemini",
  providerModelId: "gemini-1.5-flash",
  credentialsRef: "unused-in-test",
  weight: 1,
  isActive: true,
};

describe("createGeminiProvider", () => {
  it("maps OpenAI messages to Gemini's generateContent shape and returns an OpenAI-shaped response", async () => {
    const fakeResponse = {
      candidates: [
        {
          content: { role: "model", parts: [{ text: "hi there" }] },
          finishReason: "STOP",
        },
      ],
      usageMetadata: { promptTokenCount: 2, candidatesTokenCount: 2, totalTokenCount: 4 },
    };
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(JSON.stringify(fakeResponse), { status: 200, headers: { "content-type": "application/json" } }),
    );
    const httpClient: HttpClient = { fetch: fetchMock };
    const provider = createGeminiProvider(httpClient, "gemini-key");

    const result = await provider.chatCompletion(
      {
        model: "gemini-1.5-flash",
        messages: [
          { role: "system", content: "be helpful" },
          { role: "user", content: "hello" },
        ],
        temperature: 0.5,
        max_tokens: 100,
      },
      deployment,
    );

    expect(result).toMatchObject({
      object: "chat.completion",
      model: "gemini-1.5-flash",
      choices: [{ index: 0, message: { role: "assistant", content: "hi there" }, finish_reason: "stop" }],
      usage: { prompt_tokens: 2, completion_tokens: 2, total_tokens: 4 },
    });

    expect(fetchMock).toHaveBeenCalledWith(
      expect.stringContaining("gemini-1.5-flash:generateContent"),
      expect.objectContaining({ method: "POST" }),
    );
    const body = JSON.parse(fetchMock.mock.calls[0][1].body);
    expect(body.contents).toEqual([{ role: "user", parts: [{ text: "hello" }] }]);
    expect(body.systemInstruction).toEqual({ role: "user", parts: [{ text: "be helpful" }] });
    expect(body.generationConfig).toEqual({ maxOutputTokens: 100, temperature: 0.5 });
  });

  it("yields OpenAI-shaped chunks from a Gemini stream", async () => {
    const chunks = [
      { candidates: [{ content: { role: "model", parts: [{ text: "hello " }] } }] },
      { candidates: [{ content: { role: "model", parts: [{ text: "world" }] }, finishReason: "STOP" }] },
    ];
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(chunks.map((c) => JSON.stringify(c)).join("\n"), {
        status: 200,
        headers: { "content-type": "application/json" },
      }),
    );
    const httpClient: HttpClient = { fetch: fetchMock };
    const provider = createGeminiProvider(httpClient, "gemini-key");

    const emitted: string[] = [];
    for await (const chunk of provider.chatCompletionStream(
      { model: "gemini-1.5-flash", messages: [{ role: "user", content: "hi" }] },
      deployment,
    )) {
      emitted.push(chunk.choices[0].delta.content ?? "");
      if (chunk.choices[0].finish_reason) {
        emitted.push(`finish:${chunk.choices[0].finish_reason}`);
      }
    }

    expect(emitted).toEqual(["hello ", "world", "finish:stop"]);
  });

  it("translates OpenAI tool format to Gemini function declarations and back", async () => {
    const fakeResponse = {
      candidates: [
        {
          content: { role: "model", parts: [{ functionCall: { name: "get_weather", args: { city: "NYC" } } }] },
          finishReason: "STOP",
        },
      ],
      usageMetadata: { promptTokenCount: 5, candidatesTokenCount: 3, totalTokenCount: 8 },
    };
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(JSON.stringify(fakeResponse), { status: 200, headers: { "content-type": "application/json" } }),
    );
    const httpClient: HttpClient = { fetch: fetchMock };
    const provider = createGeminiProvider(httpClient, "gemini-key");

    const tools = [
      { type: "function" as const, function: { name: "get_weather", description: "Get weather", parameters: { type: "object" } } },
    ];
    const result = await provider.chatCompletion(
      {
        model: "gemini-1.5-flash",
        messages: [{ role: "user", content: "weather?" }],
        tools,
        tool_choice: { type: "function", function: { name: "get_weather" } },
      },
      deployment,
    );

    expect(result.choices[0].message.content).toBeNull();
    expect(result.choices[0].message.tool_calls).toEqual([
      { id: "call_0", type: "function", function: { name: "get_weather", arguments: '{"city":"NYC"}' } },
    ]);
    expect(result.choices[0].finish_reason).toBe("tool_calls");

    const body = JSON.parse(fetchMock.mock.calls[0][1].body);
    expect(body.tools).toEqual([
      { functionDeclarations: [{ name: "get_weather", description: "Get weather", parameters: { type: "object" } }] },
    ]);
    expect(body.toolConfig).toEqual({
      functionCallingConfig: { mode: "ANY", allowedFunctionNames: ["get_weather"] },
    });
  });

  it("translates a tool result message back to a Gemini functionResponse part", async () => {
    const fakeResponse = {
      candidates: [{ content: { role: "model", parts: [{ text: "It is sunny." }] }, finishReason: "STOP" }],
      usageMetadata: { promptTokenCount: 6, candidatesTokenCount: 3, totalTokenCount: 9 },
    };
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(JSON.stringify(fakeResponse), { status: 200, headers: { "content-type": "application/json" } }),
    );
    const httpClient: HttpClient = { fetch: fetchMock };
    const provider = createGeminiProvider(httpClient, "gemini-key");

    await provider.chatCompletion(
      {
        model: "gemini-1.5-flash",
        messages: [
          { role: "user", content: "weather?" },
          {
            role: "assistant",
            content: null,
            tool_calls: [{ id: "call_0", type: "function", function: { name: "get_weather", arguments: '{"city":"NYC"}' } }],
          },
          { role: "tool", content: '{"temp":72}', tool_call_id: "get_weather" },
        ],
      },
      deployment,
    );

    const body = JSON.parse(fetchMock.mock.calls[0][1].body);
    expect(body.contents).toEqual([
      { role: "user", parts: [{ text: "weather?" }] },
      { role: "model", parts: [{ functionCall: { name: "get_weather", args: { city: "NYC" } } }] },
      { role: "user", parts: [{ functionResponse: { name: "get_weather", response: { result: '{"temp":72}' } } }] },
    ]);
  });

  it("throws on a non-2xx response so the router's fallback logic can catch it", async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response("rate limited", { status: 429 }));
    const httpClient: HttpClient = { fetch: fetchMock };
    const provider = createGeminiProvider(httpClient, "gemini-key");

    await expect(
      provider.chatCompletion({ model: "gemini-1.5-flash", messages: [{ role: "user", content: "hi" }] }, deployment),
    ).rejects.toThrow();
  });
});
