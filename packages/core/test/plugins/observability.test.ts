import { describe, it, expect, vi } from "vitest";
import { createWebhookObservabilityMiddleware } from "../../src/plugins/observability";
import type { HttpClient } from "../../src/http/httpClient";
import type { RequestContext, GatewayResponse } from "@ai-gateway/plugin-sdk";

const requestCtx: RequestContext = {
  apiKeyId: "key-1",
  model: "gpt-4o",
  headers: { authorization: "Bearer sk-test" },
  body: { model: "gpt-4o", messages: [{ role: "user", content: "hello" }] },
};

describe("createWebhookObservabilityMiddleware", () => {
  it("POSTs request/response payload to the configured webhook", async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response("ok", { status: 200 }));
    const httpClient: HttpClient = { fetch: fetchMock };
    const middleware = createWebhookObservabilityMiddleware(httpClient, {
      url: "https://example.com/webhook",
      headers: { "x-api-key": "secret" },
    });

    const response: GatewayResponse = { status: 200, body: { choices: [] } };
    const result = await middleware.onResponse!(requestCtx, response);

    expect(result).toEqual(response);
    expect(fetchMock).toHaveBeenCalledWith(
      "https://example.com/webhook",
      expect.objectContaining({
        method: "POST",
        headers: expect.objectContaining({ "Content-Type": "application/json", "x-api-key": "secret" }),
        body: expect.any(String),
      }),
    );

    const payload = JSON.parse(fetchMock.mock.calls[0][1].body);
    expect(payload.apiKeyId).toBe("key-1");
    expect(payload.model).toBe("gpt-4o");
    expect(payload.responseStatus).toBe(200);
    expect(payload.requestBody).toEqual(requestCtx.body);
  });

  it("does not throw when the webhook returns an error", async () => {
    const fetchMock = vi.fn().mockRejectedValue(new Error("network error"));
    const httpClient: HttpClient = { fetch: fetchMock };
    const middleware = createWebhookObservabilityMiddleware(httpClient, { url: "https://example.com/webhook" });

    const response: GatewayResponse = { status: 200, body: { choices: [] } };
    const result = await middleware.onResponse!(requestCtx, response);

    expect(result).toEqual(response);
  });
});
