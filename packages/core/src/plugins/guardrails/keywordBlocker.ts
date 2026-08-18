import type {
  GatewayResponse,
  MiddlewarePlugin,
  RequestContext,
} from "@ai-gateway/plugin-sdk";

import type { ChatCompletionRequest } from "../../types/chat.js";

export interface KeywordBlockConfig {
  keywords: string[];
  caseSensitive?: boolean;
}

export function createKeywordBlockerMiddleware(
  ruleName: string,
  config: KeywordBlockConfig,
): MiddlewarePlugin {
  const keywords = config.keywords.map((keyword) =>
    config.caseSensitive ? keyword : keyword.toLowerCase(),
  );

  return {
    name: `guardrail-keyword-block:${ruleName}`,
    async onRequest(ctx: RequestContext): Promise<GatewayResponse | undefined> {
      const body = ctx.body as ChatCompletionRequest | undefined;
      if (!body || !Array.isArray(body.messages)) {
        return undefined;
      }

      const blocked: string[] = [];
      for (const message of body.messages) {
        if (typeof message.content !== "string") {
          continue;
        }
        const text = config.caseSensitive
          ? message.content
          : message.content.toLowerCase();
        for (const keyword of keywords) {
          if (text.includes(keyword)) {
            blocked.push(keyword);
          }
        }
      }

      if (blocked.length === 0) {
        return undefined;
      }

      return {
        status: 400,
        body: {
          error: "guardrail_keyword_blocked",
          message: `Request blocked by guardrail rule "${ruleName}"`,
          blockedTerms: [...new Set(blocked)],
        },
      };
    },
  };
}
