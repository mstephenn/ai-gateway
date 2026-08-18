import { Readable } from "node:stream";

import type { RequestContext } from "@ai-gateway/plugin-sdk";
import type { FastifyInstance, FastifyReply } from "fastify";

import { authenticate } from "../auth/authenticate.js";
import type { BudgetChecker } from "../budget/budget.js";
import type { ResponseCache } from "../cache/responseCache.js";
import type { DbClient } from "../db/client.js";
import {
  statusForError,
  UnauthorizedError,
  ModelAccessDeniedError,
} from "../errors.js";
import type { PluginRegistry } from "../plugins/registry.js";
import type { RateLimiter } from "../rateLimiter/rateLimiter.js";
import type { Router } from "../router/router.js";
import type {
  ChatCompletionChunk,
  ChatCompletionRequest,
} from "../types/chat.js";

export interface ChatCompletionsRouteDeps {
  db: DbClient;
  router: Router;
  pluginRegistry: PluginRegistry;
  cache?: ResponseCache;
  rateLimiter?: RateLimiter;
  budgetChecker?: BudgetChecker;
}

interface LogFields {
  apiKeyId: string;
  modelName: string;
  latencyMs: number;
  status: number;
  inputTokens?: number;
  outputTokens?: number;
  cacheHit: boolean;
  stream: boolean;
}

function sseEvent(chunk: ChatCompletionChunk): string {
  return `data: ${JSON.stringify(chunk)}\n\n`;
}

function sendError(reply: FastifyReply, err: unknown): FastifyReply {
  const status = statusForError(err);
  return reply
    .status(status)
    .send({ error: err instanceof Error ? err.message : "internal_error" });
}

function estimateInputTokens(req: ChatCompletionRequest): number {
  const chars = req.messages.reduce(
    (sum, m) => sum + (m.content?.length ?? 0),
    0,
  );
  return Math.ceil(chars / 4);
}

function estimateRequestTokens(req: ChatCompletionRequest): number {
  return estimateInputTokens(req) + (req.max_tokens ?? 4096);
}

function isModelAllowed(
  modelName: string,
  allowedModels: string[] | undefined,
): boolean {
  if (!allowedModels || allowedModels.length === 0) {
    return true;
  }
  return allowedModels.includes(modelName);
}

export function registerChatCompletionsRoute(
  app: FastifyInstance,
  deps: ChatCompletionsRouteDeps,
): void {
  app.post("/v1/chat/completions", async (request, reply) => {
    const authHeader = request.headers.authorization;
    const bearerToken = authHeader?.startsWith("Bearer ")
      ? authHeader.slice("Bearer ".length)
      : undefined;

    const auth = await authenticate(deps.db, bearerToken);
    if (!auth) {
      return sendError(reply, new UnauthorizedError("invalid_api_key"));
    }

    const body = request.body as ChatCompletionRequest;

    const keyAllowed = isModelAllowed(body.model, auth.allowedModels);
    const teamAllowed = isModelAllowed(body.model, auth.teamAllowedModels);
    if (!keyAllowed || !teamAllowed) {
      return sendError(reply, new ModelAccessDeniedError(body.model));
    }

    const requestCtx: RequestContext = {
      apiKeyId: auth.apiKeyId,
      model: body.model,
      headers: request.headers as Record<string, string>,
      body,
    };

    const pluginResponse = await deps.pluginRegistry.runOnRequest(requestCtx);
    if (pluginResponse) {
      return await reply
        .status(pluginResponse.status)
        .send(pluginResponse.body);
    }

    const startedAt = Date.now();

    const log = (
      fields: Omit<LogFields, "apiKeyId" | "modelName" | "latencyMs">,
    ) =>
      deps.db.requestLog.create({
        data: {
          apiKeyId: auth.apiKeyId,
          modelName: body.model,
          latencyMs: Date.now() - startedAt,
          ...fields,
        },
      });

    try {
      await deps.rateLimiter?.checkAndRecord(auth.apiKeyId, auth.rpmLimit);
      await deps.rateLimiter?.checkTokens(
        auth.apiKeyId,
        estimateRequestTokens(body),
        auth.tpmLimit,
      );

      if (body.stream === true) {
        const iterator = deps.router
          .executeStream(body)
          [Symbol.asyncIterator]();
        // Pull the first chunk before committing to SSE so an upstream failure
        // still surfaces as a normal JSON error response with a real status.
        const first = await iterator.next();

        async function* sseBody(): AsyncGenerator<string> {
          let outputTokens = 0;
          try {
            for (let next = first; !next.done; next = await iterator.next()) {
              const content = next.value.choices[0]?.delta?.content;
              if (content) {
                outputTokens += Math.ceil(content.length / 4);
              }
              yield sseEvent(next.value);
            }
            yield "data: [DONE]\n\n";
            await deps.rateLimiter?.recordTokens(auth!.apiKeyId, outputTokens);
            await deps.budgetChecker?.checkAndSpend(
              auth!.apiKeyId,
              body.model,
              estimateInputTokens(body),
              outputTokens,
              auth!.budgetLimit,
              auth!.teamId,
              auth!.teamBudgetLimit,
            );
            await log({ status: 200, cacheHit: false, stream: true });
          } catch (err) {
            await log({
              status: statusForError(err),
              cacheHit: false,
              stream: true,
            });
          }
        }

        return await reply
          .status(200)
          .header("content-type", "text/event-stream")
          .header("cache-control", "no-cache")
          .header("connection", "keep-alive")
          .send(Readable.from(sseBody()));
      }

      if (deps.cache) {
        const cached = await deps.cache.get(body);
        if (cached) {
          await log({
            status: 200,
            inputTokens: cached.usage.prompt_tokens,
            outputTokens: cached.usage.completion_tokens,
            cacheHit: true,
            stream: false,
          });
          const finalResponse = await deps.pluginRegistry.runOnResponse(
            requestCtx,
            { status: 200, body: cached },
          );
          return await reply
            .status(finalResponse.status)
            .send(finalResponse.body);
        }
      }

      const response = await deps.router.execute(body);

      await deps.cache?.set(body, response);
      await deps.rateLimiter?.recordTokens(
        auth.apiKeyId,
        response.usage.total_tokens,
      );
      await deps.budgetChecker?.checkAndSpend(
        auth.apiKeyId,
        body.model,
        response.usage.prompt_tokens,
        response.usage.completion_tokens,
        auth.budgetLimit,
        auth.teamId,
        auth.teamBudgetLimit,
      );

      await log({
        status: 200,
        inputTokens: response.usage.prompt_tokens,
        outputTokens: response.usage.completion_tokens,
        cacheHit: false,
        stream: false,
      });

      const finalResponse = await deps.pluginRegistry.runOnResponse(
        requestCtx,
        { status: 200, body: response },
      );
      return await reply.status(finalResponse.status).send(finalResponse.body);
    } catch (err) {
      await log({
        status: statusForError(err),
        cacheHit: false,
        stream: body.stream === true,
      });
      return sendError(reply, err);
    }
  });
}
