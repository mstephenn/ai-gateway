import type {
  GatewayResponse,
  MiddlewarePlugin,
  RequestContext,
} from "@ai-gateway/plugin-sdk";

import type { HttpClient } from "../http/httpClient.js";

export interface WebhookObservabilityConfig {
  url: string;
  headers?: Record<string, string>;
  timeoutMs?: number;
}

interface ObservabilityPayload {
  apiKeyId: string;
  model: string;
  requestHeaders: Record<string, string>;
  requestBody: unknown;
  responseStatus: number;
  responseBody: unknown;
  timestamp: string;
}

export function createWebhookObservabilityMiddleware(
  httpClient: HttpClient,
  config: WebhookObservabilityConfig,
): MiddlewarePlugin {
  return {
    name: "webhook-observability",
    async onResponse(
      ctx: RequestContext,
      response: GatewayResponse,
    ): Promise<GatewayResponse> {
      const payload: ObservabilityPayload = {
        apiKeyId: ctx.apiKeyId,
        model: ctx.model,
        requestHeaders: ctx.headers,
        requestBody: ctx.body,
        responseStatus: response.status,
        responseBody: response.body,
        timestamp: new Date().toISOString(),
      };

      const abortController = new AbortController();
      const timeout = setTimeout(
        () => abortController.abort(),
        config.timeoutMs ?? 5000,
      );

      try {
        await httpClient.fetch(config.url, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            ...config.headers,
          },
          body: JSON.stringify(payload),
          signal: abortController.signal,
        });
      } catch (err) {
        // Observability export failures must never break the request.
        console.error("Webhook observability export failed:", err);
      } finally {
        clearTimeout(timeout);
      }

      return response;
    },
  };
}
